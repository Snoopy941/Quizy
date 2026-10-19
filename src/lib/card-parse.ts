/**
 * Parsing, validation and de-duplication of AI-generated cards.
 * Pure module (no imports) so it can be unit-tested directly.
 */

export type CardType = "definition" | "fill-blank" | "mc" | "true-false" | "short-answer";
export type Difficulty = "easy" | "medium" | "hard";

export interface GeneratedCard {
  front: string;
  back: string;
  type: CardType;
  options?: string[];
  difficulty: Difficulty;
  category: string;
  /** Short verbatim snippet from the source that backs the answer. */
  source?: string;
}

export const CARD_TYPES: CardType[] = ["definition", "fill-blank", "mc", "true-false", "short-answer"];

/** JSON schema the model must follow (used for constrained decoding). */
export const CARDS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["front", "back", "type", "options", "difficulty", "source"],
        properties: {
          front: { type: "string" },
          back: { type: "string" },
          type: { type: "string", enum: CARD_TYPES },
          options: { type: "array", items: { type: "string" } },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          source: { type: "string" },
        },
      },
    },
  },
} as const;

const MAX_FRONT = 400;
const MAX_BACK = 600;

/** Pull the first JSON object out of a model reply (tolerates code fences / chatter). */
export function extractJsonObject(content: string): unknown {
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI returned no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Normalize for answer/option comparison: lowercase, no punctuation, single spaces. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate and repair one raw card. Returns null when unusable.
 * Repairs: MC whose answer isn't among the options, true/false with a
 * non-boolean back, fill-blank without a blank — each degrades to a plain
 * short-answer card rather than shipping a broken card.
 */
export function validateCard(raw: unknown, category: string): GeneratedCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  let front = typeof c.front === "string" ? squash(c.front) : "";
  let back = typeof c.back === "string" ? squash(c.back) : "";
  if (!front || !back) return null;
  if (front.length > MAX_FRONT) front = front.slice(0, MAX_FRONT - 1).trimEnd() + "…";
  if (back.length > MAX_BACK) back = back.slice(0, MAX_BACK - 1).trimEnd() + "…";
  if (normalizeText(front) === normalizeText(back)) return null;

  let type: CardType = CARD_TYPES.includes(c.type as CardType) ? (c.type as CardType) : "definition";
  const difficulty: Difficulty = c.difficulty === "easy" || c.difficulty === "hard" ? c.difficulty : "medium";
  const source = typeof c.source === "string" && c.source.trim() ? squash(c.source).slice(0, 300) : undefined;
  let options: string[] | undefined;

  if (type === "mc") {
    const raw = Array.isArray(c.options) ? c.options.filter((o): o is string => typeof o === "string") : [];
    const seen = new Set<string>();
    const opts: string[] = [];
    for (const o of raw) {
      const t = squash(o).replace(/^[A-Da-d][.)]\s+/, "");
      const k = normalizeText(t);
      if (!t || seen.has(k)) continue;
      seen.add(k);
      opts.push(t);
    }
    const backKey = normalizeText(back.replace(/^[A-Da-d][.)]\s+/, ""));
    let answer = opts.find((o) => normalizeText(o) === backKey);
    // "B" or "b)" as the back → resolve to that option
    if (!answer && /^[A-Da-d][.)]?$/.test(back.trim()) && opts.length === 4) {
      answer = opts["abcd".indexOf(back.trim()[0].toLowerCase())];
    }
    if (opts.length === 4 && answer) {
      options = opts;
      back = answer;
    } else {
      type = "short-answer";
    }
  }

  if (type === "true-false") {
    const b = normalizeText(back);
    if (b === "true" || b.startsWith("true ")) back = "True";
    else if (b === "false" || b.startsWith("false ")) back = "False";
    else type = "short-answer";
  }

  if (type === "fill-blank") {
    front = front.replace(/_{2,}|\[blank\]|\(blank\)|\{blank\}/gi, "___");
    if (!front.includes("___")) type = "short-answer";
  }

  return { front, back, type, options, difficulty, category, source };
}

/** Parse a model reply into validated cards. Throws when nothing usable came back. */
export function parseCards(content: string, category: string): GeneratedCard[] {
  const parsed = extractJsonObject(content) as { cards?: unknown };
  const rawCards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [];
  const cards: GeneratedCard[] = [];
  for (const rc of rawCards) {
    const v = validateCard(rc, category || "General");
    if (v) cards.push(v);
  }
  if (!cards.length) throw new Error("AI returned no usable cards");
  return cards;
}

/* ---------- near-duplicate detection ---------- */

const STOP = new Set(
  "a an the of to in on for and or is are was were be by with as at from that this which what who whom how why when where does do did it its into than then their there these those".split(
    " "
  )
);

export function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w))
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Two cards are near-duplicates when their questions are almost the same
 * (≥ 0.8 token overlap), or they share a specific answer and ask about the
 * same thing (some overlap in the question).
 */
export function isNearDuplicate(
  a: { front: string; back: string },
  b: { front: string; back: string },
  threshold = 0.8
): boolean {
  const fa = tokenSet(a.front);
  const fb = tokenSet(b.front);
  const frontSim = jaccard(fa, fb);
  if (frontSim >= threshold) return true;
  const back = normalizeText(a.back);
  const trivialBack = !back || back === "true" || back === "false";
  if (!trivialBack && back === normalizeText(b.back) && frontSim >= 0.25) return true;
  return false;
}

/** Drop cards that duplicate `existing` or each other. Order is preserved. */
export function dedupeCards<T extends { front: string; back: string }>(
  cards: T[],
  existing: { front: string; back: string }[] = []
): T[] {
  const kept: T[] = [];
  const pool = [...existing];
  for (const c of cards) {
    if (pool.some((e) => isNearDuplicate(c, e))) continue;
    kept.push(c);
    pool.push(c);
  }
  return kept;
}
