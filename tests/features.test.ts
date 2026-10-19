import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { rankPassages } from "../src/lib/retrieve";
import { createLimiter } from "../src/lib/rate-limit";
import { localCardIssues } from "../src/lib/quality";
import { newRecoveryCode, normalizeRecoveryCode } from "../src/lib/recovery";
import { downscale, extractPptxFigures, looksLikeFigure } from "../src/lib/figures";
import { cleanTranscript } from "../src/lib/voice";
import { encodeWav } from "../src/lib/audio";
import { languageLine } from "../src/lib/ai";

test("retrieval ranks the section that answers the question", () => {
  const passages = [
    { id: "a", heading: "Photosynthesis", text: "Chloroplasts capture light energy and make glucose from carbon dioxide and water." },
    { id: "b", heading: "Cellular respiration", text: "Mitochondria break down glucose to release ATP. Glycolysis happens in the cytoplasm." },
    { id: "c", heading: "Cell membrane", text: "The phospholipid bilayer is selectively permeable." },
  ];
  const r = rankPassages("Where does glycolysis happen?", passages, 2);
  assert.equal(r[0].passage.id, "b");
  assert.equal(rankPassages("chloroplasts light", passages)[0].passage.id, "a");
  assert.deepEqual(rankPassages("quantum chromodynamics", passages), []);
});

test("rate limiter locks after max failures and unlocks after the window", () => {
  const l = createLimiter(3, 1000);
  for (let i = 0; i < 3; i++) l.fail("k", 0);
  assert.ok(l.retryAfter("k", 10) > 0);
  assert.equal(l.retryAfter("k", 1001), 0);
  l.fail("x", 0);
  l.reset("x");
  assert.equal(l.retryAfter("x", 1), 0);
});

test("local quality checks flag duplicates, give-aways and long answers", () => {
  const issues = localCardIssues([
    { id: "1", front: "What organelle produces ATP in cells?", back: "Mitochondria", type: "definition" },
    { id: "2", front: "Which organelle produces ATP in the cell?", back: "Mitochondria", type: "definition" },
    { id: "3", front: "What does the mitochondria produce, ATP?", back: "ATP", type: "short-answer" },
    { id: "4", front: "Describe glycolysis fully", back: "x".repeat(300), type: "short-answer" },
  ]);
  const by = (id: string) => issues.filter((i) => i.cardId === id).map((i) => i.problem).join(" | ");
  assert.match(by("2"), /Nearly the same/);
  assert.match(by("3"), /gives away/);
  assert.match(by("4"), /long/);
  assert.equal(by("1"), "");
});

test("recovery codes are long, readable and normalize what users type", () => {
  const c = newRecoveryCode();
  assert.match(c, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  assert.equal(normalizeRecoveryCode(` ${c.toLowerCase().replace(/-/g, " ")} `), c.replace(/-/g, ""));
});

test("figure helpers: downscale and figure detection", () => {
  const w = 2000, h = 1000, ch = 3;
  const px = new Uint8Array(w * h * ch).map((_, i) => (i * 7) % 256);
  const s = downscale(px, w, h, ch, 500);
  assert.equal(s.width, 500);
  assert.equal(s.height, 250);
  assert.equal(s.data.length, 500 * 250 * 3);
  assert.ok(looksLikeFigure(px, w, h, ch));
  assert.ok(!looksLikeFigure(new Uint8Array(400 * 400 * 3).fill(255), 400, 400, 3), "blank image");
  assert.ok(!looksLikeFigure(px, 100, 100, 3), "icon-sized");
});

test("PowerPoint figures: largest picture per slide, repeated logos skipped", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "figs-"));
  const map = extractPptxFigures(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "figures.pptx")), "deck1", out);
  assert.deepEqual(Object.keys(map).sort(), ["1", "3"]);
  assert.match(map["1"], /^\/api\/images\/fig-deck1-p1\.png$/);
  assert.ok(fs.statSync(path.join(out, "fig-deck1-p1.png")).size > 8000);
});

test("voice: transcripts are cleaned of timestamps and noise tags", () => {
  assert.equal(cleanTranscript("[00:00.000 --> 00:02.000]  The mitochondria\n[BLANK_AUDIO]\n (coughs)\n makes ATP.\n"), "The mitochondria makes ATP.");
});

test("WAV encoder writes a valid 16-bit mono header", async () => {
  const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  const b = Buffer.from(await blob.arrayBuffer());
  assert.equal(b.subarray(0, 4).toString(), "RIFF");
  assert.equal(b.readUInt32LE(24), 16000);
  assert.equal(b.readUInt16LE(22), 1);
  assert.equal(b.length, 44 + 8);
  assert.equal(b.readInt16LE(46), Math.round(0.5 * 0x7fff) | 0);
});

test("language instruction for prompts", () => {
  assert.match(languageLine("es"), /Spanish/);
  assert.match(languageLine("auto"), /same language/);
  assert.match(languageLine("xx"), /same language/);
});
