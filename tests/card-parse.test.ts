import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeCards, isNearDuplicate, parseCards, validateCard } from "../src/lib/card-parse";

test("parses JSON wrapped in code fences and chatter", () => {
  const cards = parseCards(
    'Sure! ```json\n{"cards":[{"front":"What is ATP?","back":"The cell\'s energy currency","type":"definition","options":[],"difficulty":"easy","source":"ATP is the energy currency"}]}\n```',
    "Energy"
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].category, "Energy");
  assert.equal(cards[0].source, "ATP is the energy currency");
  assert.equal(cards[0].options, undefined);
});

test("multiple choice: answer must be one of 4 options", () => {
  const ok = validateCard({ front: "Q?", back: "b) Mitochondria", type: "mc", options: ["A) Nucleus", "B) Mitochondria", "C) Ribosome", "D) Golgi"] }, "x");
  assert.equal(ok?.type, "mc");
  assert.equal(ok?.back, "Mitochondria");
  assert.deepEqual(ok?.options, ["Nucleus", "Mitochondria", "Ribosome", "Golgi"]);
  const letter = validateCard({ front: "Q?", back: "C", type: "mc", options: ["w", "x", "y", "z"] }, "x");
  assert.equal(letter?.back, "y");
  const bad = validateCard({ front: "Which organelle makes ATP?", back: "Mitochondria", type: "mc", options: ["Nucleus", "Ribosome", "Golgi", "Lysosome"] }, "x");
  assert.equal(bad?.type, "short-answer", "answer missing from options → degrade");
  const dupes = validateCard({ front: "Q?", back: "a", type: "mc", options: ["a", "A", "b", "c"] }, "x");
  assert.equal(dupes?.type, "short-answer", "duplicate options → degrade");
});

test("true/false and fill-blank are normalized or degraded", () => {
  assert.equal(validateCard({ front: "Cells are alive.", back: "true.", type: "true-false" }, "x")?.back, "True");
  assert.equal(validateCard({ front: "Cells are alive.", back: "Yes", type: "true-false" }, "x")?.type, "short-answer");
  assert.equal(validateCard({ front: "The ____ makes ATP.", back: "mitochondrion", type: "fill-blank" }, "x")?.front, "The ___ makes ATP.");
  assert.equal(validateCard({ front: "What makes ATP?", back: "mitochondrion", type: "fill-blank" }, "x")?.type, "short-answer");
});

test("rejects empty or self-answering cards", () => {
  assert.equal(validateCard({ front: "", back: "x" }, "x"), null);
  assert.equal(validateCard({ front: "Osmosis", back: "osmosis." }, "x"), null);
  assert.throws(() => parseCards('{"cards":[]}', "x"));
});

test("near-duplicate detection", () => {
  assert.ok(isNearDuplicate({ front: "What is the function of the mitochondria?", back: "Make ATP" }, { front: "What is the function of mitochondria?", back: "Produce ATP" }));
  assert.ok(!isNearDuplicate({ front: "Where does glycolysis occur?", back: "Cytoplasm" }, { front: "Where does the Krebs cycle occur?", back: "Mitochondrial matrix" }));
  const kept = dedupeCards(
    [
      { front: "Where does glycolysis occur?", back: "In the cytoplasm" },
      { front: "Where does glycolysis take place?", back: "In the cytoplasm" },
      { front: "What does glycolysis produce?", back: "Two pyruvate" },
    ],
    [{ front: "What does glycolysis produce in the cell?", back: "Two pyruvate" }]
  );
  assert.deepEqual(kept.map((k) => k.front), ["Where does glycolysis occur?"]);
});
