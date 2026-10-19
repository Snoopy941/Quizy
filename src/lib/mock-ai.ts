/**
 * Deterministic demo generator — only used when MOCK_AI=1 (development and
 * automated tests). Builds simple cards from sentences in the text so the
 * pipeline can be exercised without any AI. Never used as a silent fallback.
 */
import type { GeneratedCard } from "./card-parse";

interface MockParams {
  text: string;
  heading: string;
  count: number;
}

/* ---------- deterministic mock generator (no API key needed) ---------- */

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 6);
}

function keyTerm(sentence: string): string {
  const words = sentence.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z-]{3,}$/.test(w));
  const stop = new Set(["this","that","with","from","which","their","there","these","those","because","through","between","such","also","more","most","when","while","where","after","before","other","than","then","into","only","very","some","both","each","been","have","has","will","would","could","should","must","might","being","about","over","under"]);
  const candidates = words.filter((w) => !stop.has(w.toLowerCase()));
  return candidates[candidates.length - 1] ?? candidates[0] ?? "it";
}

export function mockCards({ text, heading, count }: MockParams): GeneratedCard[] {
  const sents = sentences(text);
  const cards: GeneratedCard[] = [];
  const category = heading || "General";
  const types: GeneratedCard["type"][] = ["definition", "fill-blank", "mc", "true-false", "short-answer"];
  for (let i = 0; i < count && i < sents.length; i++) {
    const s = sents[i];
    const term = keyTerm(s);
    const type = types[i % types.length];
    let front = "";
    let back = "";
    let options: string[] | undefined;
    switch (type) {
      case "definition":
        front = `What does the text say about "${term}"?`;
        back = s;
        break;
      case "fill-blank": {
        const re = new RegExp(`\\b${term}\\b`, "i");
        front = s.replace(re, "___");
        back = term;
        if (!front.includes("___")) { front = `Complete: ${s}`; back = term; }
        break;
      }
      case "mc": {
        front = `Which statement matches the text regarding "${term}"?`;
        back = s;
        const otherSents = sents.filter((x) => x !== s).slice(0, 3);
        while (otherSents.length < 3) otherSents.push("The text does not discuss this.");
        options = shuffleStable([s, ...otherSents], i);
        break;
      }
      case "true-false": {
        const flip = i % 2 === 1;
        front = flip ? negate(s) : s;
        back = flip ? "False" : "True";
        break;
      }
      case "short-answer":
        front = `In one short answer: what point does this sentence make about ${term}?`;
        back = s.replace(/^[A-Z]/, (m) => m.toLowerCase()).replace(/\.$/, "");
        break;
    }
    const difficulty = i % 3 === 0 ? "easy" : i % 3 === 1 ? "medium" : "hard";
    cards.push({ front, back, type, options, difficulty: difficulty as GeneratedCard["difficulty"], category, source: s.split(/\s+/).slice(0, 12).join(" ") });
  }
  return cards;
}

function negate(s: string): string {
  if (/\bis\b/i.test(s)) return s.replace(/\bis\b/i, "is not");
  if (/\bcan\b/i.test(s)) return s.replace(/\bcan\b/i, "cannot");
  if (/\ball\b/i.test(s)) return s.replace(/\ball\b/i, "no");
  return `It is false that ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

/** Deterministic shuffle so mock MC options vary by card index but stay stable. */
function shuffleStable<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
