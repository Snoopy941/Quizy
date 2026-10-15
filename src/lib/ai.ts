/**
 * AI card generation adapter — OpenAI-compatible chat completions.
 * Works with OpenAI, OpenRouter, Together, Ollama, etc.
 * Falls back to a deterministic mock generator when MOCK_AI=1 or no key is set,
 * or when the API call fails (so the pipeline never dead-ends).
 */

export interface GeneratedCard {
  front: string;
  back: string;
  type: "definition" | "fill-blank" | "mc" | "true-false" | "short-answer";
  options?: string[];
  difficulty: "easy" | "medium" | "hard";
  category: string;
}

export interface GenerateParams {
  text: string;
  heading: string;
  count: number;
  instructions?: string;
}

const SYSTEM_PROMPT = `You are an expert flashcard writer creating study cards from educational text.
Return ONLY valid JSON — no markdown fences, no commentary — matching this shape:
{"cards":[{"front":"...","back":"...","type":"definition|fill-blank|mc|true-false|short-answer","options":["A","B","C","D"],"difficulty":"easy|medium|hard"}]}
Rules:
- "mc" cards MUST include exactly 4 options; the back is the correct option text (verbatim from options).
- "fill-blank" fronts use "___" for the blank; the back is the missing word/phrase.
- "true-false" backs are exactly "True" or "False".
- Mix card types across the set. Test understanding, not trivia.
- difficulty reflects how hard the card is for a student.
- Never invent facts that are not supported by the text.`;

function userPrompt({ text, heading, count, instructions }: GenerateParams): string {
  const parts = [
    `Create exactly ${count} flashcards from the following text.`,
    heading ? `The section heading is "${heading}" — use it as the category.` : "",
    instructions ? `Extra instructions from the student: ${instructions}` : "",
    `Text:\n"""\n${text.slice(0, 6000)}\n"""`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function aiEnabled(): boolean {
  return process.env.MOCK_AI !== "1" && Boolean(process.env.OPENAI_API_KEY);
}

export async function generateCards(params: GenerateParams): Promise<GeneratedCard[]> {
  if (!aiEnabled()) return mockCards(params);
  try {
    return await callOpenAI(params);
  } catch (err) {
    console.error("[ai] generation failed, using mock fallback:", err);
    return mockCards(params);
  }
}

async function callOpenAI(params: GenerateParams): Promise<GeneratedCard[]> {
  const base = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(params) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseCards(content, params);
}

export function parseCards(content: string, params: GenerateParams): GeneratedCard[] {
  // Strip potential markdown fences
  const cleaned = content.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI returned no JSON object");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { cards?: unknown };
  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const TYPES = new Set(["definition", "fill-blank", "mc", "true-false", "short-answer"]);
  const cards: GeneratedCard[] = [];
  for (const rc of rawCards) {
    if (!rc || typeof rc !== "object") continue;
    const c = rc as Record<string, unknown>;
    const front = typeof c.front === "string" ? c.front.trim() : "";
    const back = typeof c.back === "string" ? c.back.trim() : "";
    if (!front || !back) continue;
    const type: GeneratedCard["type"] =
      typeof c.type === "string" && TYPES.has(c.type)
        ? (c.type as GeneratedCard["type"])
        : "definition";
    const options = Array.isArray(c.options)
      ? c.options.filter((o): o is string => typeof o === "string").slice(0, 4)
      : undefined;
    const difficulty =
      c.difficulty === "easy" || c.difficulty === "hard" ? c.difficulty : "medium";
    cards.push({
      front,
      back,
      type,
      options: type === "mc" && options?.length === 4 ? options : undefined,
      difficulty,
      category: params.heading || "General",
    });
  }
  if (!cards.length) throw new Error("AI returned no usable cards");
  return cards;
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

export function mockCards({ text, heading, count }: GenerateParams): GeneratedCard[] {
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
    cards.push({ front, back, type, options, difficulty: difficulty as GeneratedCard["difficulty"], category });
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
