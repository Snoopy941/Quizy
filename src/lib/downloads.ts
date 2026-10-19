/**
 * On-demand downloads of large optional assets, kept in the user's models
 * folder (survives app updates; not in the roaming profile):
 *   - built-in AI models (GGUF) — the lite installer ships without one
 *   - Whisper speech recognition (whisper.cpp CLI + model) for voice answers
 *   - Tesseract language data for OCR in other languages
 *
 * Downloads resume after interruption (HTTP Range) and report progress.
 */
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { readZip } from "./zip";

export type AssetKind = "llm" | "whisper" | "ocr";

export interface Asset {
  id: string;
  kind: AssetKind;
  label: string;
  description: string;
  /** Approximate download size in bytes (for the UI). */
  size: number;
  /** Files to fetch: url → path relative to the models folder. Zips are extracted. */
  files: { url: string; dest: string; zip?: { pick: RegExp; into: string } }[];
  /** Relative path whose presence means "installed". */
  marker: string;
  recommendedRamGb?: number;
}

const HF = "https://huggingface.co";

export const LLM_MODELS: Asset[] = [
  {
    id: "qwen3-4b-q3",
    kind: "llm",
    label: "Standard",
    description: "Qwen3-4B Instruct, compact. Good cards on most PCs (needs ~4 GB free RAM).",
    size: 1_890_000_000,
    files: [
      {
        url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q3_K_S.gguf`,
        dest: "Qwen3-4B-Instruct-2507-Q3_K_S.gguf",
      },
    ],
    marker: "Qwen3-4B-Instruct-2507-Q3_K_S.gguf",
    recommendedRamGb: 8,
  },
  {
    id: "qwen3-4b-q6",
    kind: "llm",
    label: "Higher quality",
    description: "Same model at higher precision — noticeably better cards and explanations. Best with 16 GB RAM or a graphics card.",
    size: 3_310_000_000,
    files: [
      {
        url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q6_K.gguf`,
        dest: "Qwen3-4B-Instruct-2507-Q6_K.gguf",
      },
    ],
    marker: "Qwen3-4B-Instruct-2507-Q6_K.gguf",
    recommendedRamGb: 16,
  },
];

export const WHISPER: Asset = {
  id: "whisper",
  kind: "whisper",
  label: "Voice answers",
  description: "Offline speech recognition (whisper.cpp, multilingual base model).",
  size: 155_000_000,
  files: [
    {
      url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip",
      dest: "whisper/whisper-bin-x64.zip",
      zip: { pick: /\.(exe|dll)$/i, into: "whisper/bin" },
    },
    { url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`, dest: "whisper/ggml-base.bin" },
  ],
  marker: "whisper/ggml-base.bin",
};

/** Tesseract languages offered for OCR (code → name). */
export const OCR_LANGUAGES: Record<string, string> = {
  eng: "English",
  spa: "Spanish",
  fra: "French",
  deu: "German",
  ita: "Italian",
  por: "Portuguese",
  nld: "Dutch",
  pol: "Polish",
  tur: "Turkish",
  rus: "Russian",
  ukr: "Ukrainian",
  ara: "Arabic",
  hin: "Hindi",
  chi_sim: "Chinese (Simplified)",
  chi_tra: "Chinese (Traditional)",
  jpn: "Japanese",
  kor: "Korean",
  vie: "Vietnamese",
  ind: "Indonesian",
  tgl: "Filipino",
};

export function ocrAsset(lang: string): Asset {
  return {
    id: `ocr-${lang}`,
    kind: "ocr",
    label: `OCR: ${OCR_LANGUAGES[lang] ?? lang}`,
    description: `Read scanned pages and photos in ${OCR_LANGUAGES[lang] ?? lang}.`,
    size: 4_000_000,
    files: [{ url: `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`, dest: `ocr/${lang}.traineddata` }],
    marker: `ocr/${lang}.traineddata`,
  };
}

export function findAsset(id: string): Asset | null {
  if (id.startsWith("ocr-")) {
    const lang = id.slice(4);
    return OCR_LANGUAGES[lang] ? ocrAsset(lang) : null;
  }
  return [...LLM_MODELS, WHISPER].find((a) => a.id === id) ?? null;
}

/* ---------------- locations ---------------- */

export function modelsDir(): string {
  const dir = process.env.QUIZY_MODELS_DIR || path.join(process.cwd(), "data", "models");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isInstalled(a: Asset): boolean {
  return fs.existsSync(path.join(modelsDir(), a.marker));
}

/* ---------------- download state ---------------- */

export interface DownloadState {
  id: string;
  status: "downloading" | "done" | "error";
  received: number;
  total: number;
  error: string | null;
}

const g = globalThis as unknown as { __quizyDownloads?: Map<string, DownloadState> };
const states: Map<string, DownloadState> = (g.__quizyDownloads ??= new Map());

export function downloadState(id: string): DownloadState | null {
  return states.get(id) ?? null;
}

/** Start (or join) a download. Resolves when finished; progress is in downloadState(). */
export function startDownload(asset: Asset): Promise<void> {
  const existing = states.get(asset.id);
  if (existing?.status === "downloading") return waitFor(asset.id);
  const st: DownloadState = { id: asset.id, status: "downloading", received: 0, total: asset.size, error: null };
  states.set(asset.id, st);
  const run = (async () => {
    const root = modelsDir();
    let base = 0;
    for (const f of asset.files) {
      const dest = path.join(root, f.dest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const extractedAlready = f.zip && fs.existsSync(path.join(root, f.zip.into));
      if (extractedAlready) continue;
      if (!fs.existsSync(dest)) {
        await fetchToFile(f.url, dest, (n) => {
          st.received = base + n;
        });
      }
      base += fs.statSync(dest).size;
      st.received = base;
      if (f.zip) {
        const zip = readZip(fs.readFileSync(dest));
        const into = path.join(root, f.zip.into);
        fs.mkdirSync(into, { recursive: true });
        let n = 0;
        for (const [name, entry] of zip) {
          if (!f.zip.pick.test(name)) continue;
          fs.writeFileSync(path.join(into, path.basename(name)), entry.read());
          n++;
        }
        if (!n) throw new Error(`Nothing usable found in ${path.basename(dest)}`);
        fs.rmSync(dest, { force: true }); // keep only the extracted files
      }
    }
    st.total = st.received;
    st.status = "done";
  })().catch((err) => {
    st.status = "error";
    st.error = err instanceof Error ? err.message : String(err);
    throw err;
  });
  return run;
}

function waitFor(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      const s = states.get(id);
      if (!s || s.status === "done") {
        clearInterval(t);
        resolve();
      } else if (s.status === "error") {
        clearInterval(t);
        reject(new Error(s.error ?? "Download failed"));
      }
    }, 500);
  });
}

/** Download `url` to `dest`, resuming from `dest.part` if present. */
async function fetchToFile(url: string, dest: string, onBytes: (n: number) => void): Promise<void> {
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: "follow" });
  if (res.status === 416) {
    // Already complete
    fs.renameSync(part, dest);
    return;
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${path.basename(dest)}`);
  if (have && res.status !== 206) have = 0; // server ignored Range: start over
  const out = fs.createWriteStream(part, { flags: have ? "a" : "w" });
  let n = have;
  onBytes(n);
  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      n += chunk.length;
      onBytes(n);
    });
    body.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
    body.pipe(out);
  });
  const expected = Number(res.headers.get("content-length") || 0) + (res.status === 206 ? have : 0);
  if (expected && fs.statSync(part).size < expected) throw new Error("Download was interrupted — try again to resume.");
  fs.renameSync(part, dest);
}

/** Remove an optional download (models, voice). */
export function removeAsset(a: Asset) {
  const root = modelsDir();
  for (const f of a.files) {
    fs.rmSync(path.join(root, f.dest), { force: true });
    fs.rmSync(path.join(root, `${f.dest}.part`), { force: true });
    if (f.zip) fs.rmSync(path.join(root, f.zip.into), { recursive: true, force: true });
  }
  states.delete(a.id);
}
