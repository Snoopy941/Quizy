import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { extractDocxText, extractPptxText } from "../src/lib/office";
import { chunkDocument } from "../src/lib/chunk";
import { readZip, writeZip } from "../src/lib/zip";

const fx = (f: string) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", f));

test("zip round trip (store + deflate)", () => {
  const big = Buffer.from("hello ".repeat(1000));
  const tiny = Buffer.from("x");
  const z = readZip(writeZip([{ name: "a/big.txt", data: big }, { name: "tiny.bin", data: tiny }]));
  assert.deepEqual(z.get("a/big.txt")!.read(), big);
  assert.deepEqual(z.get("tiny.bin")!.read(), tiny);
});

test("Word: headings become sections, entities decoded", () => {
  const pages = extractDocxText(fx("notes.docx"));
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /^# Photosynthesis$/m);
  assert.match(pages[0].text, /stroma & fixes CO2 <carbon>/);
  const chunks = chunkDocument(pages, 30);
  assert.deepEqual([...new Set(chunks.map((c) => c.heading))], ["Photosynthesis", "Cellular Respiration"]);
});

test("PowerPoint: one page per slide, titles as headings, speaker notes kept", () => {
  const pages = extractPptxText(fx("slides.pptx"));
  assert.deepEqual(pages.map((p) => p.num), [1, 2, 3]);
  assert.match(pages[0].text, /^# The Cell Membrane/);
  assert.match(pages[0].text, /Selectively permeable/);
  assert.match(pages[0].text, /Notes: The membrane controls/);
  assert.doesNotMatch(pages[1].text, /Notes:/);
  const chunks = chunkDocument(pages);
  const mito = chunks.find((c) => c.heading === "Mitochondria")!;
  assert.equal(mito.pageStart, 3);
});
