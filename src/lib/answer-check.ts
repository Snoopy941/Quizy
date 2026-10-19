/**
 * Local (no-AI) checking of typed answers. Pure module.
 *
 * Fill-in-the-blank answers are checked here entirely (typos forgiven).
 * Short answers get a quick local verdict; when it isn't confident the
 * server asks the AI to judge meaning instead of wording.
 */
import { normalizeText, tokenSet } from "./card-parse";

export type Verdict = "correct" | "partial" | "incorrect";

export interface LocalCheck {
  verdict: Verdict;
  /** True when the local check is sure enough that no AI judgement is needed. */
  confident: boolean;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x && !y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Share of the expected answer's key words present in the given answer. */
export function keywordRecall(expected: string, given: string): number {
  const exp = tokenSet(expected);
  if (!exp.size) return similarity(expected, given);
  const got = tokenSet(given);
  let hit = 0;
  for (const w of exp) {
    if (got.has(w)) {
      hit++;
      continue;
    }
    // tolerate small typos / plurals on longer words
    for (const g of got) {
      if (w.length >= 5 && g.length >= 4 && similarity(w, g) >= 0.8) {
        hit++;
        break;
      }
    }
  }
  return hit / exp.size;
}

export function checkAnswer(type: string, expected: string, given: string): LocalCheck {
  const g = normalizeText(given);
  const e = normalizeText(expected);
  if (!g) return { verdict: "incorrect", confident: true };
  if (g === e) return { verdict: "correct", confident: true };

  if (type === "fill-blank") {
    const sim = similarity(expected, given);
    if (sim >= 0.85) return { verdict: "correct", confident: true };
    if (keywordRecall(expected, given) >= 1 && g.split(" ").length <= e.split(" ").length + 2) {
      return { verdict: "correct", confident: true };
    }
    if (sim >= 0.6) return { verdict: "partial", confident: true };
    return { verdict: "incorrect", confident: true };
  }

  // short-answer / definition: meaning matters more than wording
  const recall = keywordRecall(expected, given);
  if (similarity(expected, given) >= 0.9 || recall >= 0.9) return { verdict: "correct", confident: true };
  if (recall >= 0.6) return { verdict: "correct", confident: false };
  if (recall >= 0.3) return { verdict: "partial", confident: false };
  return { verdict: "incorrect", confident: false };
}

/** Suggested self-grade for a verdict. */
export function gradeForVerdict(v: Verdict): "again" | "hard" | "good" {
  return v === "correct" ? "good" : v === "partial" ? "hard" : "again";
}
