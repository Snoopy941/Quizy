/**
 * Find the document sections most relevant to a question (BM25 over words).
 * Pure module so it can be unit-tested directly.
 */
import { normalizeText } from "./card-parse";

const STOP = new Set(
  "a an the of to in on for and or is are was were be by with as at from that this which what who whom how why when where does do did it its into than then their there these those i you we they he she me my your our can could would should will about explain tell".split(
    " "
  )
);

export function terms(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Very light stemming so "cells"/"cell", "dividing"/"divide" match. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

export interface Passage {
  id: string;
  heading: string;
  text: string;
}

export function rankPassages<T extends Passage>(question: string, passages: T[], k = 4): { passage: T; score: number }[] {
  const q = [...new Set(terms(question))];
  if (!q.length || !passages.length) return [];
  const docs = passages.map((p) => terms(`${p.heading} ${p.heading} ${p.text}`));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    return { passage: passages[i], score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
