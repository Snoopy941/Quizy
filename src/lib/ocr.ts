/**
 * OCR for scanned PDFs and photos of notes, fully offline.
 *
 * Uses tesseract.js (WebAssembly Tesseract) with the English model bundled
 * next to the app (ocr/eng.traineddata, fetched by the build script). In dev,
 * if the bundled model is missing, tesseract.js downloads it once.
 *
 * Scanned PDFs: each page's embedded scan image is pulled out with pdf.js
 * (unpdf.extractImages), encoded as PNG and recognised.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { crc32 } from "./zip";
import { modelsDir, ocrAsset, startDownload } from "./downloads";
import type { SourcePage } from "./chunk";

export const MAX_OCR_PAGES = 150;

/* ---------- PNG encoding (raw pixels from pdf.js → PNG for Tesseract) ---------- */

export function encodePng(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4): Buffer {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- Tesseract ---------- */

type TesseractWorker = {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/** Folders that may hold the bundled English model (desktop build: app/ocr). */
function bundledEngDirs(): string[] {
  return [process.env.QUIZY_OCR_DIR, path.join(process.cwd(), "ocr"), path.join(process.cwd(), "public", "ocr")].filter(
    Boolean
  ) as string[];
}

/** Make sure every requested language's model is in the models/ocr folder; return that folder. */
export async function ensureOcrLanguages(langs: string[]): Promise<string | null> {
  const dir = path.join(modelsDir(), "ocr");
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of langs) {
    const file = path.join(dir, `${lang}.traineddata`);
    if (fs.existsSync(file)) continue;
    if (lang === "eng") {
      const src = bundledEngDirs().map((d) => path.join(d, "eng.traineddata")).find((f) => fs.existsSync(f));
      if (src) {
        fs.copyFileSync(src, file);
        continue;
      }
    }
    try {
      await startDownload(ocrAsset(lang));
    } catch (err) {
      if (lang === "eng") return null; // dev without bundled model: let tesseract.js fetch it
      throw new Error(`Couldn't download the ${lang} OCR language: ${err instanceof Error ? err.message : err}`);
    }
  }
  return dir;
}

async function createOcrWorker(langs: string[]): Promise<TesseractWorker> {
  let mod: { createWorker: (langs: string, oem: number, options: Record<string, unknown>) => Promise<TesseractWorker> };
  try {
    // Loaded at runtime (server-external package); not bundled by Next.
    mod = (await import("tesseract.js")) as unknown as typeof mod;
  } catch {
    throw new Error("OCR isn't available in this build (tesseract.js missing). Run npm install and rebuild.");
  }
  const list = langs.length ? langs : ["eng"];
  const langDir = await ensureOcrLanguages(list);
  const options: Record<string, unknown> = langDir
    ? { langPath: langDir, gzip: false, cacheMethod: "none" }
    : { cachePath: path.join(modelsDir(), "ocr-cache") };
  return mod.createWorker(list.join("+"), 1, options);
}

/** "eng+spa" → ["eng", "spa"] (unknown codes dropped). */
export function parseOcrLanguages(spec: string | null | undefined): string[] {
  const out = (spec || "eng").split(/[+,\s]+/).filter((l) => /^[a-z_]{3,8}$/.test(l));
  return out.length ? [...new Set(out)] : ["eng"];
}

/** OCR a list of images (PNG/JPEG/WebP/BMP buffers). Calls onPage(i, total) as it goes. */
export async function ocrImages(
  images: Buffer[],
  onPage?: (done: number, total: number) => void | Promise<void>,
  langs: string[] = ["eng"]
): Promise<string[]> {
  if (!images.length) return [];
  const worker = await createOcrWorker(langs);
  try {
    const out: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const { data } = await worker.recognize(images[i]);
      out.push(cleanOcrText(data.text || ""));
      await onPage?.(i + 1, images.length);
    }
    return out;
  } finally {
    await worker.terminate().catch(() => {});
  }
}

export function cleanOcrText(t: string): string {
  return t
    .replace(/\r/g, "")
    .replace(/[|]{2,}/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * OCR a scanned PDF: for each page, recognise its largest embedded image.
 * Pages that already have a text layer keep their text.
 */
export async function ocrScannedPdf(
  filePath: string,
  textPages: string[],
  onProgress?: (done: number, total: number) => void | Promise<void>,
  langs: string[] = ["eng"]
): Promise<SourcePage[]> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const buffer = await fs.promises.readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const total = Math.min(pdf.numPages, MAX_OCR_PAGES);
  const worker = await createOcrWorker(langs);
  const pages: SourcePage[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      const existing = (textPages[i - 1] ?? "").trim();
      if (existing.replace(/\s/g, "").length > 200) {
        pages.push({ num: i, text: existing });
      } else {
        const images = await extractImages(pdf, i).catch(() => []);
        const biggest = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (biggest && biggest.width >= 200 && biggest.height >= 200) {
          const png = encodePng(biggest.data, biggest.width, biggest.height, biggest.channels);
          const { data } = await worker.recognize(png);
          pages.push({ num: i, text: cleanOcrText(data.text || "") });
        } else if (existing) {
          pages.push({ num: i, text: existing });
        }
      }
      await onProgress?.(i, total);
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return pages;
}
