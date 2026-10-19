/**
 * Figures (diagrams, charts, photos) from the source document, so cards can
 * show the picture from the page they were written from.
 *
 * - PDF: the largest embedded image on each page (via pdf.js), skipping
 *   small icons and logos repeated across pages; downscaled and saved as PNG.
 * - PowerPoint: the largest picture on each slide (original file bytes).
 *
 * Result: { [page]: "/api/images/<file>" }, stored on the deck.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { encodePng } from "./ocr";
import { readZip } from "./zip";
import { num, slideOrder } from "./office";

const MIN_SIDE = 150;
const MIN_AREA = 60_000;
const MAX_WIDTH = 1100;
const MAX_PAGES = 200;

export type FigureMap = Record<string, string>;

/** Nearest-neighbour downscale of raw pixels so figures stay small on disk. */
export function downscale(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
  maxWidth = MAX_WIDTH
): { data: Uint8Array; width: number; height: number } {
  if (width <= maxWidth) return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height };
  const scale = maxWidth / width;
  const w = maxWidth;
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const si = (sy * width + sx) * channels;
      const di = (y * w + x) * channels;
      for (let c = 0; c < channels; c++) out[di + c] = data[si + c];
    }
  }
  return { data: out, width: w, height: h };
}

/** Rough "is this a real figure" test: not tiny, not a flat single colour. */
export function looksLikeFigure(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): boolean {
  if (width < MIN_SIDE || height < MIN_SIDE || width * height < MIN_AREA) return false;
  // sample pixels: require some variation
  let min = 255;
  let max = 0;
  const step = Math.max(1, Math.floor((width * height) / 400));
  for (let i = 0; i < width * height; i += step) {
    const v = data[i * channels];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min > 40;
}

function fingerprint(data: Uint8Array | Uint8ClampedArray, w: number, h: number): string {
  const sample = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 4096));
  return crypto.createHash("sha1").update(`${w}x${h}`).update(sample).digest("hex");
}

export async function extractPdfFigures(filePath: string, deckId: string, outDir: string): Promise<FigureMap> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await fs.promises.readFile(filePath)));
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  const candidates: { page: number; img: { data: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 }; fp: string }[] = [];
  const seen = new Map<string, number>();
  for (let p = 1; p <= pages; p++) {
    const imgs = await extractImages(pdf, p).catch(() => []);
    const good = imgs.filter((i) => looksLikeFigure(i.data, i.width, i.height, i.channels));
    if (!good.length) continue;
    const biggest = good.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const fp = fingerprint(biggest.data, biggest.width, biggest.height);
    seen.set(fp, (seen.get(fp) ?? 0) + 1);
    candidates.push({ page: p, img: biggest, fp });
  }
  const scanned = candidates.length >= pages * 0.8 && pages > 2; // every page is one big image: a scan, not figures
  if (scanned) return {};
  const map: FigureMap = {};
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of candidates) {
    if ((seen.get(c.fp) ?? 0) >= 3) continue; // logo / header repeated on many pages
    const small = downscale(c.img.data, c.img.width, c.img.height, c.img.channels);
    const name = `fig-${deckId}-p${c.page}.png`;
    fs.writeFileSync(path.join(outDir, name), encodePng(small.data, small.width, small.height, c.img.channels));
    map[String(c.page)] = `/api/images/${name}`;
  }
  return map;
}

export function extractPptxFigures(buf: Buffer, deckId: string, outDir: string): FigureMap {
  const zip = readZip(buf);
  const slides = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b));
  const order = slideOrder(zip);
  const ordered = order.length ? order.filter((n) => zip.has(n)) : slides;
  const map: FigureMap = {};
  const seen = new Map<string, number>();
  const picks: { page: number; media: string }[] = [];
  ordered.forEach((slide, i) => {
    const rels = zip.get(slide.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"))?.read().toString("utf8") ?? "";
    const xml = zip.get(slide)!.read().toString("utf8");
    const targets = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = m[1].match(/Id="([^"]+)"/)?.[1];
      const target = m[1].match(/Target="([^"]+)"/)?.[1];
      if (id && target && /\/media\//.test(target)) targets.set(id, "ppt/" + target.replace(/^\.\.\//, ""));
    }
    let best: string | null = null;
    let bestSize = 0;
    for (const m of xml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
      const media = targets.get(m[1]);
      const entry = media ? zip.get(media) : undefined;
      if (!media || !entry || !/\.(png|jpe?g|gif|bmp)$/i.test(media)) continue;
      if (entry.size > bestSize) {
        best = media;
        bestSize = entry.size;
      }
    }
    if (best && bestSize > 8_000) {
      seen.set(best, (seen.get(best) ?? 0) + 1);
      picks.push({ page: i + 1, media: best });
    }
  });
  fs.mkdirSync(outDir, { recursive: true });
  for (const p of picks) {
    if ((seen.get(p.media) ?? 0) >= 3) continue; // template logo / background
    const ext = path.extname(p.media).toLowerCase().replace(".jpeg", ".jpg");
    const name = `fig-${deckId}-p${p.page}${ext}`;
    fs.writeFileSync(path.join(outDir, name), zip.get(p.media)!.read());
    map[String(p.page)] = `/api/images/${name}`;
  }
  return map;
}

export function parseFigures(json: string | null | undefined): FigureMap {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as FigureMap) : {};
  } catch {
    return {};
  }
}
