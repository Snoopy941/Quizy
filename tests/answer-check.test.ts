import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, gradeForVerdict } from "../src/lib/answer-check";

test("fill-blank forgives typos and case", () => {
  assert.equal(checkAnswer("fill-blank", "mitochondria", "Mitochondria").verdict, "correct");
  assert.equal(checkAnswer("fill-blank", "mitochondria", "mitocondria").verdict, "correct");
  assert.equal(checkAnswer("fill-blank", "chlorophyll", "ribosome").verdict, "incorrect");
  assert.equal(checkAnswer("fill-blank", "x", "").verdict, "incorrect");
});

test("short answers: confident when clear, defer to AI when not", () => {
  const exact = checkAnswer("short-answer", "It controls what enters and leaves the cell", "it controls what enters and leaves the cell");
  assert.deepEqual(exact, { verdict: "correct", confident: true });
  const vague = checkAnswer("short-answer", "Selectively permeable phospholipid bilayer", "a bilayer of lipids");
  assert.equal(vague.confident, false);
  assert.equal(gradeForVerdict("partial"), "hard");
});
