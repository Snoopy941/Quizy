import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, findQuoteRange, looksLikeHeading, pageForQuote } from "../src/lib/chunk";

test("heading detection uses context", () => {
  assert.ok(looksLikeHeading("Cell Theory", "Chapter 4: Introduction to Cell Biology", "Cell theory is one of the foundational principles."));
  assert.ok(looksLikeHeading("2.1 The Plasma Membrane", "Previous paragraph ends here.", "The membrane is..."));
  assert.ok(looksLikeHeading("# Explicit Heading", "anything", "anything"));
  // Wrapped sentence line in Title Case is not a heading
  assert.ok(!looksLikeHeading("Golgi Apparatus Modifies And", "The endoplasmic reticulum synthesizes proteins, the", "packages proteins."));
  assert.ok(!looksLikeHeading("Robert Hooke First Observed Cells", "In 1665 the English scientist", "in cork."));
  assert.ok(!looksLikeHeading("This is a sentence.", null, null));
  assert.ok(!looksLikeHeading("12", "x.", "Y"));
});

test("chunks keep page ranges and quotes map back to pages", () => {
  const filler = (w: string, n: number) => Array.from({ length: n }, (_, i) => `${w} sentence number ${i} explains a detail.`).join("\n");
  const pages = [
    { num: 1, text: `Intro To Cells\nCells are the basic unit of life.\n${filler("Alpha", 30)}` },
    { num: 2, text: `${filler("Beta", 20)}\nThe nucleus stores genetic material in eukaryotes.` },
    { num: 3, text: `Energy Systems\nMitochondria produce most of the ATP in the cell.\n${filler("Gamma", 25)}` },
  ];
  const chunks = chunkDocument(pages);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].heading, "Intro To Cells");
  assert.equal(chunks[0].pageStart, 1);
  const energy = chunks.find((c) => c.heading === "Energy Systems")!;
  assert.equal(energy.pageStart, 3);
  const first = chunks[0];
  const nucleusChunk = chunks.find((c) => c.text.includes("nucleus stores"))!;
  assert.equal(pageForQuote("The nucleus stores genetic material", nucleusChunk), 2);
  assert.equal(pageForQuote("cells are the basic unit of life", first), 1);
  assert.equal(pageForQuote(undefined, energy), 3);
  assert.equal(pageForQuote("this text does not appear anywhere at all", first), first.pageStart);
});

test("markdown headings split pasted notes; page-less sources have null pages", () => {
  const chunks = chunkDocument([{ num: null, text: "# Topic One\nSome text about the first topic that is long enough.\n\n# Topic Two\nMore text about the second topic here." }]);
  assert.deepEqual(chunks.map((c) => c.heading), ["Topic One", "Topic Two"]);
  assert.equal(chunks[0].pageStart, null);
});

test("quote highlighting range", () => {
  const text = "The plasma membrane is selectively permeable,\nmeaning it controls entry.";
  const r = findQuoteRange("selectively permeable, meaning it controls", text)!;
  assert.equal(text.slice(r[0], r[1]), "selectively permeable,\nmeaning it controls");
});
