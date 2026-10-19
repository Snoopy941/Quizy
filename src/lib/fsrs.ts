/**
 * FSRS-5 spaced repetition scheduler (Free Spaced Repetition Scheduler).
 *
 * Replaces SM-2. FSRS models each card's memory with two numbers:
 *   - stability S: days until recall probability drops to 90%
 *   - difficulty D: 1 (easy) … 10 (hard)
 * and schedules the next review for when predicted recall hits the target
 * retention (90% by default). It needs noticeably fewer reviews than SM-2
 * for the same retention.
 *
 * Formulas and default weights follow the published FSRS-5 algorithm
 * (open-spaced-repetition/fsrs4anki wiki, "The Algorithm").
 *
 * Pure module — no imports — so it can be unit-tested directly.
 */

export type Grade = "again" | "hard" | "good" | "easy";

export const STATE = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type FsrsStateNum = 0 | 1 | 2 | 3;

/** FSRS-5 default parameters (trained on ~20k Anki users). */
export const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // 0.9^(1/DECAY) - 1
const MAX_INTERVAL = 36500;
const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Short same-day steps for cards that are new or being relearned. */
const LEARNING_STEPS_MIN = { again: 1, hard: 5, good: 10 };
const RELEARNING_STEP_MIN = 10;

export interface FsrsCard {
  state: FsrsStateNum;
  stability: number; // days
  difficulty: number; // 1..10
  lastReview: Date | null;
  reps: number;
  lapses: number;
}

export interface ScheduleResult extends FsrsCard {
  due: Date;
  /** Days until the next review (fractional for same-day learning steps). */
  intervalDays: number;
  /** Whether this review counts as a correct recall. */
  correct: boolean;
}

const G: Record<Grade, number> = { again: 1, hard: 2, good: 3, easy: 4 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Interval (days) at which predicted recall equals `retention`. */
export function nextIntervalDays(stability: number, retention = 0.9): number {
  const raw = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, MAX_INTERVAL);
}

function initStability(g: number, w = DEFAULT_W): number {
  return Math.max(w[g - 1], 0.1);
}

function initDifficulty(g: number, w = DEFAULT_W): number {
  return w[4] - Math.exp(w[5] * (g - 1)) + 1;
}

function nextDifficulty(d: number, g: number, w = DEFAULT_W): number {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9; // linear damping
  const reverted = w[7] * initDifficulty(4, w) + (1 - w[7]) * damped; // mean reversion
  return clamp(reverted, 1, 10);
}

function recallStability(d: number, s: number, r: number, g: number, w = DEFAULT_W): number {
  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  return (
    s *
    (1 +
      Math.exp(w[8]) *
        (11 - d) *
        Math.pow(s, -w[9]) *
        (Math.exp((1 - r) * w[10]) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function forgetStability(d: number, s: number, r: number, w = DEFAULT_W): number {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.min(sf, s);
}

function shortTermStability(s: number, g: number, w = DEFAULT_W): number {
  return s * Math.exp(w[17] * (g - 3 + w[18]));
}

export function newCard(): FsrsCard {
  return { state: STATE.New, stability: 0, difficulty: 0, lastReview: null, reps: 0, lapses: 0 };
}

/**
 * Apply one review. `now` defaults to the current time.
 * Again on a review card is a lapse (back to relearning, short step).
 */
export function review(card: FsrsCard, grade: Grade, now: Date = new Date(), retention = 0.9): ScheduleResult {
  const g = G[grade];
  const correct = g > 1;
  let { state, stability: s, difficulty: d, reps, lapses } = card;
  reps += 1;

  const minutes = (m: number) => ({ due: new Date(now.getTime() + m * MIN), intervalDays: m / 1440 });
  const days = (n: number) => ({ due: new Date(now.getTime() + n * DAY), intervalDays: n });

  if (state === STATE.New) {
    s = initStability(g);
    d = clamp(initDifficulty(g), 1, 10);
    if (grade === "easy") {
      const iv = nextIntervalDays(s, retention);
      return { state: STATE.Review, stability: s, difficulty: d, lastReview: now, reps, lapses, correct, ...days(iv) };
    }
    return {
      state: STATE.Learning,
      stability: s,
      difficulty: d,
      lastReview: now,
      reps,
      lapses,
      correct,
      ...minutes(LEARNING_STEPS_MIN[grade]),
    };
  }

  if (state === STATE.Learning || state === STATE.Relearning) {
    s = shortTermStability(Math.max(s, 0.1), g);
    d = nextDifficulty(d, g);
    if (grade === "again" || grade === "hard") {
      const step = grade === "again" ? (state === STATE.Learning ? 5 : RELEARNING_STEP_MIN) : 10;
      return { state, stability: s, difficulty: d, lastReview: now, reps, lapses, correct, ...minutes(step) };
    }
    const good = nextIntervalDays(s, retention);
    const iv = grade === "easy" ? Math.max(good + 1, nextIntervalDays(s * 1.3, retention)) : good;
    return { state: STATE.Review, stability: s, difficulty: d, lastReview: now, reps, lapses, correct, ...days(iv) };
  }

  // Review state
  const elapsed = card.lastReview ? Math.max(0, (now.getTime() - card.lastReview.getTime()) / DAY) : 0;
  const r = retrievability(elapsed, s);
  if (grade === "again") {
    const sf = forgetStability(d, s, r);
    return {
      state: STATE.Relearning,
      stability: sf,
      difficulty: nextDifficulty(d, g),
      lastReview: now,
      reps,
      lapses: lapses + 1,
      correct,
      ...minutes(RELEARNING_STEP_MIN),
    };
  }
  // Compute all three so intervals stay ordered hard < good < easy.
  const sHard = recallStability(d, s, r, 2);
  const sGood = recallStability(d, s, r, 3);
  const sEasy = recallStability(d, s, r, 4);
  let ivHard = nextIntervalDays(sHard, retention);
  let ivGood = nextIntervalDays(sGood, retention);
  let ivEasy = nextIntervalDays(sEasy, retention);
  ivHard = Math.min(ivHard, ivGood);
  ivGood = Math.max(ivGood, ivHard + 1);
  ivEasy = Math.max(ivEasy, ivGood + 1);
  const pick = grade === "hard" ? [sHard, ivHard] : grade === "good" ? [sGood, ivGood] : [sEasy, ivEasy];
  return {
    state: STATE.Review,
    stability: pick[0],
    difficulty: nextDifficulty(d, g),
    lastReview: now,
    reps,
    lapses,
    correct,
    ...days(Math.min(pick[1], MAX_INTERVAL)),
  };
}

/** Fields of a stored card needed to rebuild FSRS state (FSRS or legacy SM-2). */
export interface StoredSchedule {
  fsrsState: number | null;
  stability: number | null;
  fsrsDifficulty: number | null;
  lastReviewAt: Date | null;
  easeFactor: number;
  intervalDays: number;
  dueDate: Date;
  reps: number;
  lapses: number;
  timesSeen: number;
}

/**
 * Convert a stored card to FSRS state. Cards reviewed under the old SM-2
 * scheduler are mapped over: their current interval becomes stability
 * (FSRS schedules at S days for 90% retention) and ease maps to difficulty.
 */
export function fromStored(c: StoredSchedule): FsrsCard {
  if (c.fsrsState !== null && c.fsrsState !== undefined) {
    return {
      state: clamp(Math.round(c.fsrsState), 0, 3) as FsrsStateNum,
      stability: c.stability ?? 0,
      difficulty: c.fsrsDifficulty ?? 5,
      lastReview: c.lastReviewAt,
      reps: c.reps,
      lapses: c.lapses,
    };
  }
  if (c.timesSeen === 0 && c.reps === 0) return { ...newCard(), lapses: c.lapses };
  const difficulty = clamp(5 + (2.5 - c.easeFactor) * 3.5, 1, 10);
  if (c.intervalDays >= 1) {
    const lastReview = new Date(c.dueDate.getTime() - c.intervalDays * DAY);
    return { state: STATE.Review, stability: c.intervalDays, difficulty, lastReview, reps: c.reps, lapses: c.lapses };
  }
  // Seen but still in a same-day step (SM-2 "again" = 10 minutes)
  return {
    state: c.lapses > 0 ? STATE.Relearning : STATE.Learning,
    stability: DEFAULT_W[0],
    difficulty,
    lastReview: new Date(c.dueDate.getTime() - 10 * MIN),
    reps: c.reps,
    lapses: c.lapses,
  };
}

/** Mastery threshold: next review more than 21 days out. */
export const MASTERY_INTERVAL = 21;

export function isMastered(intervalDays: number): boolean {
  return intervalDays > MASTERY_INTERVAL;
}

/** Human preview of what each grade would schedule ("10m", "3d", "2mo"). */
export function previewIntervals(card: FsrsCard, now: Date = new Date()): Record<Grade, string> {
  const out = {} as Record<Grade, string>;
  for (const g of ["again", "hard", "good", "easy"] as Grade[]) {
    out[g] = formatInterval(review(card, g, now).intervalDays);
  }
  return out;
}

export function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
}
