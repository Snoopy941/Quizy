import { test } from "node:test";
import assert from "node:assert/strict";
import { fromStored, newCard, nextIntervalDays, retrievability, review, previewIntervals, STATE } from "../src/lib/fsrs";

const DAY = 86_400_000;
const t0 = new Date("2026-01-01T09:00:00Z");

test("retrievability is 90% after exactly S days", () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.equal(nextIntervalDays(10), 10);
});

test("new card: again/hard/good stay in short learning steps, easy graduates", () => {
  const c = newCard();
  const again = review(c, "again", t0);
  assert.equal(again.state, STATE.Learning);
  assert.equal(again.due.getTime() - t0.getTime(), 60_000);
  assert.equal(again.correct, false);
  const good = review(c, "good", t0);
  assert.equal(good.state, STATE.Learning);
  assert.equal(good.due.getTime() - t0.getTime(), 10 * 60_000);
  const easy = review(c, "easy", t0);
  assert.equal(easy.state, STATE.Review);
  assert.ok(easy.intervalDays >= 10, `easy interval ${easy.intervalDays}`);
});

test("good → good graduates to a multi-day interval and keeps growing", () => {
  let c = review(newCard(), "good", t0);
  c = review(c, "good", new Date(t0.getTime() + 10 * 60_000));
  assert.equal(c.state, STATE.Review);
  assert.ok(c.intervalDays >= 2 && c.intervalDays <= 6, `first interval ${c.intervalDays}`);
  let now = c.due;
  let prev = c.intervalDays;
  for (let i = 0; i < 4; i++) {
    c = review(c, "good", now);
    assert.ok(c.intervalDays > prev, `interval should grow: ${prev} → ${c.intervalDays}`);
    prev = c.intervalDays;
    now = c.due;
  }
  assert.ok(prev > 30, `after 6 good reviews interval is ${prev}d`);
});

test("review intervals are ordered hard < good < easy", () => {
  let c = review(review(newCard(), "good", t0), "good", new Date(t0.getTime() + 600_000));
  const at = c.due;
  const h = review(c, "hard", at).intervalDays;
  const g = review(c, "good", at).intervalDays;
  const e = review(c, "easy", at).intervalDays;
  assert.ok(h < g && g < e, `${h} ${g} ${e}`);
});

test("again on a review card is a lapse with lower stability", () => {
  let c = review(review(newCard(), "good", t0), "good", new Date(t0.getTime() + 600_000));
  const lapse = review(c, "again", c.due);
  assert.equal(lapse.state, STATE.Relearning);
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.stability < c.stability);
  assert.ok(lapse.difficulty > c.difficulty);
  assert.equal(lapse.correct, false);
  const back = review(lapse, "good", lapse.due);
  assert.equal(back.state, STATE.Review);
});

test("legacy SM-2 cards convert to FSRS review state", () => {
  const due = new Date(t0.getTime() + 15 * DAY);
  const c = fromStored({
    fsrsState: null, stability: null, fsrsDifficulty: null, lastReviewAt: null,
    easeFactor: 2.5, intervalDays: 15, dueDate: due, reps: 3, lapses: 0, timesSeen: 3,
  });
  assert.equal(c.state, STATE.Review);
  assert.equal(c.stability, 15);
  assert.equal(c.lastReview!.getTime(), t0.getTime());
  const fresh = fromStored({
    fsrsState: null, stability: null, fsrsDifficulty: null, lastReviewAt: null,
    easeFactor: 2.5, intervalDays: 0, dueDate: t0, reps: 0, lapses: 0, timesSeen: 0,
  });
  assert.equal(fresh.state, STATE.New);
  // Reviewing on schedule with Good extends the interval beyond 15 days
  assert.ok(review(c, "good", due).intervalDays > 15);
});

test("previews format intervals", () => {
  const p = previewIntervals(newCard(), t0);
  assert.equal(p.again, "1m");
  assert.equal(p.good, "10m");
  assert.match(p.easy, /^\d+d$/);
});
