/**
 * SM-2 spaced repetition algorithm (SuperMemo 2).
 *
 * Grades map to quality q: again=2 (fail), hard=3, good=4, easy=5.
 * Returns the updated scheduling fields; caller persists them.
 */
export type Grade = "again" | "hard" | "good" | "easy";

export interface SM2State {
  easeFactor: number; // >= 1.3
  intervalDays: number; // 0 = new/learning
  reps: number;
  lapses: number;
}

export interface SM2Result extends SM2State {
  dueDate: Date;
  /** Whether this repetition counted as correct (q >= 3). */
  correct: boolean;
}

function clampEase(e: number): number {
  return Math.max(1.3, e);
}

export function sm2(state: SM2State, grade: Grade, now: Date = new Date()): SM2Result {
  const q = grade === "again" ? 2 : grade === "hard" ? 3 : grade === "good" ? 4 : 5;
  let { easeFactor, intervalDays, reps, lapses } = state;

  if (q < 3) {
    // Failure: reset the repetition counter, shorten interval, ease takes a bigger hit
    lapses += 1;
    reps = 0;
    intervalDays = 0;
    easeFactor = clampEase(easeFactor - 0.2);
    // Learning step: due in 10 minutes (same-day re-review)
    const due = new Date(now.getTime() + 10 * 60 * 1000);
    return { easeFactor, intervalDays, reps, lapses, dueDate: due, correct: false };
  }

  // Ease update per SM-2: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  easeFactor = clampEase(easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  reps += 1;

  if (reps === 1) {
    intervalDays = grade === "easy" ? 3 : 1;
  } else if (reps === 2) {
    intervalDays = grade === "hard" ? 4 : grade === "easy" ? 8 : 6;
  } else {
    // Hard multiplies less aggressively
    const mult = grade === "hard" ? easeFactor - 0.15 : grade === "easy" ? easeFactor + 0.15 : easeFactor;
    intervalDays = Math.max(1, Math.round(intervalDays * mult));
  }

  const due = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return { easeFactor, intervalDays, reps, lapses, dueDate: due, correct: true };
}

/** Mastery threshold: interval longer than 21 days. */
export const MASTERY_INTERVAL = 21;

export function isMastered(intervalDays: number): boolean {
  return intervalDays > MASTERY_INTERVAL;
}
