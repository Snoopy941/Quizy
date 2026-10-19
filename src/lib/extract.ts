/**
 * Turn an uploaded source file into page-tagged text, whatever its format:
 * PDF (with OCR fallback for scans), Word, PowerPoint, plain text, or an
 * image of notes (OCR).
 */
import fs from "fs";
import path from "path";
import type { SourcePage } from "./chunk";
import { extractPdfPages } from "./pdf-extract";
import { extractDocxText, extractPptxText } from "./office";
import { ocrImages, ocrScannedPdf, parseOcrLanguages } from "./ocr";

export type SourceType = "pdf" | "docx" | "pptx" | "text" | "image" | "anki";

export const SOURCE_EXTENSIONS: Record<string, SourceType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".bmp": "image",
  ".apkg": "anki",
  ".colpkg": "anki",
};

export const ACCEPT_ATTR = Object.keys(SOURCE_EXTENSIONS).join(",");

export function sourceTypeForName(name: string): SourceType | null {
  return SOURCE_EXTENSIONS[path.extname(name).toLowerCase()] ?? null;
}

/** Check the file really is what its extension says (magic bytes). */
export function looksLikeType(buf: Buffer, type: SourceType): boolean {
  const head = buf.subarray(0, 8);
  switch (type) {
    case "pdf":
      return buf.subarray(0, 1024).includes(Buffer.from("%PDF-"));
    case "docx":
    case "pptx":
    case "anki":
      return head[0] === 0x50 && head[1] === 0x4b; // "PK" zip
    case "image":
      return (
        (head[0] === 0x89 && head[1] === 0x50) || // png
        (head[0] === 0xff && head[1] === 0xd8) || // jpeg
        (head[0] === 0x42 && head[1] === 0x4d) || // bmp
        head.subarray(0, 4).toString("ascii") === "RIFF" // webp
      );
    case "text":
      return !buf.subarray(0, 4096).includes(0);
  }
}

export interface ExtractResult {
  pages: SourcePage[];
  ocr: boolean;
}

/** Share of pages that have almost no text layer — high means a scanned PDF. */
export function scannedRatio(pages: string[]): number {
  if (!pages.length) return 1;
  return pages.filter((p) => p.replace(/\s/g, "").length < 40).length / pages.length;
}

export async function extractSource(
  filePath: string,
  type: SourceType,
  onProgress?: (fraction: number, label: string) => void | Promise<void>,
  ocrLanguage = "eng"
): Promise<ExtractResult> {
  const langs = parseOcrLanguages(ocrLanguage);
  switch (type) {
    case "pdf": {
      const textPages = await extractPdfPages(filePath);
      if (scannedRatio(textPages) < 0.5) {
        return { pages: textPages.map((text, i) => ({ num: i + 1, text })), ocr: false };
      }
      await onProgress?.(0, "Scanned PDF — reading pages with OCR…");
      const pages = await ocrScannedPdf(filePath, textPages, (done, total) =>
        onProgress?.(done / total, `Reading scanned page ${done} of ${total}…`), langs
      );
      return { pages, ocr: true };
    }
    case "docx":
      return { pages: extractDocxText(await fs.promises.readFile(filePath)), ocr: false };
    case "pptx":
      return { pages: extractPptxText(await fs.promises.readFile(filePath)), ocr: false };
    case "text": {
      const text = (await fs.promises.readFile(filePath, "utf8")).replace(/^﻿/, "");
      return { pages: [{ num: null, text }], ocr: false };
    }
    case "image": {
      await onProgress?.(0, "Reading your image with OCR…");
      const [text] = await ocrImages([await fs.promises.readFile(filePath)], undefined, langs);
      return { pages: [{ num: null, text: text ?? "" }], ocr: true };
    }
    case "anki":
      throw new Error("Anki decks are imported directly — there is nothing to generate.");
  }
}
