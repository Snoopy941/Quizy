import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { extractPdfPages } from "../src/lib/pdf-extract";
import { looksLikeType, scannedRatio, sourceTypeForName } from "../src/lib/extract";
import { chunkDocument } from "../src/lib/chunk";
import { encodePng } from "../src/lib/ocr";

const fx = (f: string) => path.join(process.cwd(), "tests", "fixtures", f);

test("text PDF: per-page text and page-tagged chunks", async () => {
  const pages = await extractPdfPages(fx("sample.pdf"));
  assert.equal(pages.length, 2);
  assert.ok(scannedRatio(pages) < 0.5);
  const chunks = chunkDocument(pages.map((text, i) => ({ num: i + 1, text })));
  const headings = chunks.map((c) => c.heading);
  assert.ok(headings.includes("Cell Theory"), headings.join(" | "));
  assert.ok(headings.includes("Photosynthesis"), headings.join(" | "));
  assert.equal(chunks.find((c) => c.heading === "Cell Theory")!.pageStart, 1);
  assert.equal(chunks.find((c) => c.heading === "Photosynthesis")!.pageStart, 2);
});

test("scanned PDF is detected as needing OCR", async () => {
  const pages = await extractPdfPages(fx("scanned.pdf"));
  assert.equal(scannedRatio(pages), 1);
});

test("file type detection checks magic bytes", () => {
  assert.equal(sourceTypeForName("Notes.DOCX"), "docx");
  assert.equal(sourceTypeForName("deck.apkg"), "anki");
  assert.equal(sourceTypeForName("virus.exe"), null);
  assert.ok(looksLikeType(fs.readFileSync(fx("sample.pdf")), "pdf"));
  assert.ok(!looksLikeType(Buffer.from("MZ\x90\x00"), "pdf"));
  assert.ok(looksLikeType(fs.readFileSync(fx("slides.pptx")), "pptx"));
});

test("PNG encoder writes a decodable image", () => {
  const w = 3, h = 2;
  const px = new Uint8Array([0, 0, 0, 255, 255, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  const png = encodePng(px, w, h, 3);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), w);
  assert.equal(png.readUInt32BE(20), h);
  const idatLen = png.readUInt32BE(33);
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (w * 3 + 1) * h);
  assert.deepEqual([...raw.subarray(1, 10)], [0, 0, 0, 255, 255, 255, 10, 20, 30]);
});
