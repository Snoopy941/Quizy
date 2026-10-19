/**
 * AI layer: one OpenAI-compatible chat interface over three providers.
 *
 *   builtin — the offline model bundled with the desktop app (no key needed)
 *   api     — any OpenAI-compatible endpoint: OpenAI, OpenRouter, Together,
 *             a local Ollama/LM Studio server… (key from Settings or env)
 *   demo    — deterministic sample generator, only when MOCK_AI=1 (dev/tests)
 *
 * There is NO silent fallback: if the configured AI fails, callers get a
 * clear error instead of quietly receiving placeholder cards.
 */
import { prisma } from "@/lib/db";
import { CARDS_JSON_SCHEMA, parseCards, type GeneratedCard } from "@/lib/card-parse";
import { ensureLocalServer, localAvailable, modelName, withLane, type Lane } from "@/lib/local-ai";
import { mockCards } from "@/lib/mock-ai";
import { CARD_LANGUAGES } from "@/lib/format";

export type { GeneratedCard } from "@/lib/card-parse";

export type ProviderKind = "builtin" | "api" | "demo";

export interface AiConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Human label for the UI, e.g. "Built-in AI (Qwen3-4B)" or "gpt-4o-mini via api.openai.com". */
  label: string;
  /** How many sections to generate in parallel. */
  concurrency: number;
  /** Max characters of source text per request (smaller for the local model's context). */
  maxSourceChars: number;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI isn't set up yet — open Settings → AI to turn on the built-in AI or add an API key.");
    this.name = "AiNotConfiguredError";
  }
}

export interface UserAiSettings {
  aiProvider: string; // auto | builtin | api
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
}

const DEFAULT_API_BASE = "https://api.openai.com/v1";

function apiConfig(s: UserAiSettings | null): AiConfig | null {
  const userBase = s?.aiBaseUrl.trim() || "";
  const userKey = s?.aiApiKey.trim() || "";
  const envKey = process.env.OPENAI_API_KEY?.trim() || "";
  const envBase = process.env.OPENAI_BASE_URL?.trim() || "";
  // User settings win over env; a base URL alone is enough for keyless local servers (Ollama).
  const useUser = Boolean(userKey || userBase);
  const baseUrl = (useUser ? userBase || DEFAULT_API_BASE : envBase || DEFAULT_API_BASE).replace(/\/$/, "");
  const apiKey = useUser ? userKey : envKey;
  if (!apiKey && !(useUser && userBase)) return null;
  const model = (useUser ? s?.aiModel.trim() : "") || process.env.OPENAI_MODEL || "gpt-4o-mini";
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {}
  return { kind: "api", baseUrl, apiKey, model, label: `${model} via ${host}`, concurrency: 3, maxSourceChars: 6000 };
}

function builtinConfig(): AiConfig | null {
  if (!localAvailable()) return null;
  return {
    kind: "builtin",
    baseUrl: "",
    apiKey: "",
    model: modelName(),
    label: `Built-in AI (${modelName()})`,
    concurrency: 1,
    maxSourceChars: 4000,
  };
}

const demoConfig: AiConfig = {
  kind: "demo",
  baseUrl: "",
  apiKey: "",
  model: "demo",
  label: "Demo generator (MOCK_AI=1)",
  concurrency: 4,
  maxSourceChars: 6000,
};

/** Pick the AI for a user from their settings, falling back through what's available. */
export function resolveAiFromSettings(s: UserAiSettings | null): AiConfig | null {
  const pref = s?.aiProvider ?? "auto";
  if (pref === "builtin") return builtinConfig();
  if (pref === "api") return apiConfig(s);
  // auto
  return builtinConfig() ?? apiConfig(s) ?? (process.env.MOCK_AI === "1" ? demoConfig : null);
}

export async function resolveAi(userId: string): Promise<AiConfig | null> {
  const s = await prisma.userSettings.findUnique({ where: { userId } });
  return resolveAiFromSettings(s);
}

export async function requireAi(userId: string): Promise<AiConfig> {
  const ai = await resolveAi(userId);
  if (!ai) throw new AiNotConfiguredError();
  return ai;
}

/* ---------------- chat core ---------------- */

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  /** JSON schema the reply must follow (constrained decoding where supported). */
  schema?: { name: string; schema: object };
  temperature?: number;
  maxTokens?: number;
  lane?: Lane;
  timeoutMs?: number;
}

/** Remember which structured-output mode each endpoint accepts. */
const formatSupport = new Map<string, "json_schema" | "json_object" | "none">();

export async function chat(ai: AiConfig, opts: ChatOptions): Promise<string> {
  if (ai.kind === "demo") throw new Error("The demo generator can't answer free-form questions.");
  const run = async () => {
    const baseUrl = ai.kind === "builtin" ? `${await ensureLocalServer()}/v1` : ai.baseUrl;
    let mode = opts.schema ? formatSupport.get(baseUrl) ?? "json_schema" : "none";
    for (;;) {
      const body: Record<string, unknown> = {
        model: ai.kind === "builtin" ? "local" : ai.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1500,
        stream: false,
      };
      if (ai.kind === "builtin") body.cache_prompt = true;
      if (opts.schema && mode === "json_schema") {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema },
        };
      } else if (opts.schema && mode === "json_object") {
        body.response_format = { type: "json_object" };
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (ai.apiKey) headers.Authorization = `Bearer ${ai.apiKey}`;
      if (ai.baseUrl.includes("openrouter.ai")) {
        headers["HTTP-Referer"] = "https://quizy.study";
        headers["X-Title"] = "Quizy";
      }
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? (ai.kind === "builtin" ? 300_000 : 90_000)),
        });
      } catch (err) {
        const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "couldn't be reached";
        throw new Error(ai.kind === "builtin" ? `The built-in AI ${reason}.` : `The AI service ${reason} (${ai.baseUrl}).`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Endpoint doesn't support this structured-output mode → step down and retry.
        if (res.status === 400 && opts.schema && mode !== "none" && /response_format|json_schema|schema|json_object/i.test(text)) {
          mode = mode === "json_schema" ? "json_object" : "none";
          formatSupport.set(baseUrl, mode);
          continue;
        }
        throw new Error(friendlyHttpError(res.status, text, ai));
      }
      if (opts.schema) formatSupport.set(baseUrl, mode);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";
      // Some reasoning models wrap output in <think>…</think>
      return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    }
  };
  return ai.kind === "builtin" ? withLane(opts.lane ?? "interactive", run) : run();
}

function friendlyHttpError(status: number, body: string, ai: AiConfig): string {
  if (status === 401 || status === 403) return "The AI service rejected the API key — check it in Settings → AI.";
  if (status === 404) return `Model “${ai.model}” wasn't found at ${ai.baseUrl} — check the model name in Settings → AI.`;
  if (status === 429) return "The AI service is rate-limiting or out of credit — try again in a minute.";
  return `AI request failed (${status}): ${body.slice(0, 200)}`;
}

/* ---------------- card generation ---------------- */

export interface GenerateParams {
  text: string;
  heading: string;
  count: number;
  instructions?: string;
  /** Existing card questions in this section — the model is told not to repeat them. */
  avoid?: string[];
  /** Card language code ("auto" = same as the material). */
  language?: string;
}

/** Instruction line telling the model which language to write in. */
export function languageLine(language?: string | null): string {
  if (!language || language === "auto" || !CARD_LANGUAGES[language]) {
    return "Write in the same language as the study material.";
  }
  return `Write the cards in ${CARD_LANGUAGES[language]}, even if the study material is in another language.`;
}

function replyLanguage(language?: string | null): string {
  if (!language || language === "auto" || !CARD_LANGUAGES[language]) return "Reply in the language the student writes in.";
  return `Reply in ${CARD_LANGUAGES[language]}.`;
}

const SYSTEM_PROMPT = `You are an expert teacher writing flashcards that help a student learn and remember the given study material.
Return ONLY JSON: {"cards":[{"front":"...","back":"...","type":"definition|fill-blank|mc|true-false|short-answer","options":[],"difficulty":"easy|medium|hard","source":"..."}]}

Quality rules:
- Each card tests ONE important idea: a key concept, cause/effect, process step, comparison, or definition. Skip trivia (dates, names) unless central to the material.
- The front must make sense on its own, months later, without the text. Never write "according to the text" or "the passage".
- The back is short and precise (usually under 25 words) and directly answers the front.
- Only use facts stated in the text. Never invent facts.
- "source" is a short phrase (8–25 words) copied EXACTLY from the text that supports the answer.
- Mix card types across the set.

Type rules:
- "mc": exactly 4 options; distractors are plausible, the same kind of thing as the answer, and similar in length. The back is the correct option, copied exactly.
- "fill-blank": the front is a sentence with "___" replacing one key term; the back is that term.
- "true-false": the front is a statement; the back is exactly "True" or "False". Make about half of them false by changing one key detail.
- "definition" / "short-answer": a direct question.
- For non-mc cards, "options" is [].`;

function userPrompt(p: GenerateParams, maxChars: number): string {
  const parts = [
    `Write exactly ${p.count} flashcards from the study material below.`,
    p.heading ? `Section: "${p.heading}".` : "",
    languageLine(p.language),
    p.instructions ? `The student asked: ${p.instructions}` : "",
    p.avoid?.length ? `Don't repeat these existing questions:\n${p.avoid.slice(0, 20).map((q) => `- ${q}`).join("\n")}` : "",
    `Study material:\n"""\n${p.text.slice(0, maxChars)}\n"""`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

export async function generateCards(ai: AiConfig, params: GenerateParams, lane: Lane = "generate"): Promise<GeneratedCard[]> {
  if (ai.kind === "demo") return mockCards(params);
  const category = params.heading || "General";
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat(ai, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(params, ai.maxSourceChars) },
      ],
      schema: { name: "flashcards", schema: CARDS_JSON_SCHEMA },
      temperature: attempt === 0 ? 0.3 : 0.5,
      maxTokens: Math.min(4000, 350 + params.count * 220),
      lane,
    });
    try {
      return parseCards(content, category).slice(0, Math.max(params.count, 1));
    } catch (err) {
      lastErr = err; // malformed JSON — retry once
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI returned no usable cards");
}

/* ---------------- answer judging ---------------- */

export interface Judgement {
  verdict: "correct" | "partial" | "incorrect";
  feedback: string;
}

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "feedback"],
  properties: {
    verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
    feedback: { type: "string" },
  },
};

export async function judgeAnswer(
  ai: AiConfig,
  card: { front: string; back: string },
  answer: string
): Promise<Judgement> {
  const content = await chat(ai, {
    messages: [
      {
        role: "system",
        content:
          'You grade a student\'s flashcard answer by MEANING, not wording. Ignore spelling and grammar. "correct": captures the key idea. "partial": on the right track but missing or confusing something important. "incorrect": wrong or empty. feedback: one short, encouraging sentence saying what was right or missing. Return JSON {"verdict":"...","feedback":"..."}.',
      },
      { role: "user", content: `Question: ${card.front}\nExpected answer: ${card.back}\nStudent answer: ${answer}` },
    ],
    schema: { name: "judgement", schema: JUDGE_SCHEMA },
    temperature: 0.1,
    maxTokens: 200,
    lane: "interactive",
    timeoutMs: 60_000,
  });
  const cleaned = content.replace(/```(?:json)?/g, "");
  const parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as Partial<Judgement>;
  const verdict = parsed.verdict === "correct" || parsed.verdict === "partial" ? parsed.verdict : "incorrect";
  return { verdict, feedback: String(parsed.feedback ?? "").slice(0, 300) };
}

/* ---------------- explain this card ---------------- */

export async function explainCard(
  ai: AiConfig,
  card: { front: string; back: string },
  sourceText: string | null,
  history: { role: "user" | "assistant"; content: string }[],
  question?: string,
  language?: string | null
): Promise<string> {
  const context = sourceText ? `\n\nStudy material this card came from:\n"""\n${sourceText.slice(0, ai.maxSourceChars)}\n"""` : "";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a patient tutor. Explain flashcards so a student truly understands them: the why behind the answer, an intuitive example or analogy, and how it connects to related ideas. Be concise (under 150 words unless asked for more), use plain language, and base facts on the study material when provided. Plain text only — no markdown headings. " + replyLanguage(language),
    },
    {
      role: "user",
      content: `Flashcard question: ${card.front}\nAnswer: ${card.back}${context}\n\nExplain this card to me.`,
    },
  ];
  // Follow-ups: `history` holds the turns after that first request
  // (assistant explanation, user follow-up, assistant reply, …).
  for (const h of history.slice(-8)) {
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content.slice(0, 2000) });
  }
  if (history.length && question?.trim()) messages.push({ role: "user", content: question.trim().slice(0, 1000) });
  else if (!history.length && question?.trim()) messages[1].content += `\n\nMy question: ${question.trim().slice(0, 1000)}`;
  return chat(ai, { messages, temperature: 0.4, maxTokens: 500, lane: "interactive", timeoutMs: 120_000 });
}

/** Quick round-trip used by the Settings "Test" button. */
export async function testAi(ai: AiConfig): Promise<{ ms: number; reply: string }> {
  const t = Date.now();
  if (ai.kind === "demo") return { ms: 0, reply: "demo generator ready" };
  const reply = await chat(ai, {
    messages: [{ role: "user", content: "Reply with exactly: ready" }],
    temperature: 0,
    maxTokens: 10,
    lane: "interactive",
  });
  return { ms: Date.now() - t, reply: reply.slice(0, 60) };
}

/* ---------------- chat with the document ---------------- */

export interface ChatPassage {
  heading: string;
  text: string;
  /** "p. 4" / "slide 4" / null */
  where: string | null;
}

export async function chatWithDocument(
  ai: AiConfig,
  question: string,
  passages: ChatPassage[],
  history: { role: "user" | "assistant"; content: string }[],
  language?: string | null
): Promise<string> {
  const per = Math.max(800, Math.floor((ai.maxSourceChars * 1.2) / Math.max(1, passages.length)));
  const context = passages
    .map((p, i) => `[${i + 1}] ${p.heading}${p.where ? ` (${p.where})` : ""}\n${p.text.slice(0, per)}`)
    .join("\n\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You answer a student's questions about their study material using ONLY the numbered excerpts provided. " +
        "After each fact, cite where it came from using the excerpt's location in brackets, like [p. 4] or [slide 2] (or [1] if it has no page). " +
        "If the excerpts don't contain the answer, say so plainly and suggest what to look for — never invent facts. " +
        "Be clear and concise (under 180 words unless asked for more). Plain text, short paragraphs or • bullets. " +
        replyLanguage(language),
    },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }) as ChatMessage),
    { role: "user", content: `Excerpts from the material:\n"""\n${context}\n"""\n\nQuestion: ${question.slice(0, 1000)}` },
  ];
  return chat(ai, { messages, temperature: 0.2, maxTokens: 700, lane: "interactive", timeoutMs: 180_000 });
}

/* ---------------- section summaries (cheat sheet) ---------------- */

export async function summarizeSection(ai: AiConfig, heading: string, text: string, language?: string | null): Promise<string> {
  const out = await chat(ai, {
    messages: [
      {
        role: "system",
        content:
          "You write compact cheat-sheet summaries of study material. Output 3–7 bullet points starting with '• ', each one short line " +
          "with the key fact, definition, formula or relationship. Bold nothing, no headings, no intro sentence. Only facts from the text. " +
          languageLine(language).replace("cards", "summary"),
      },
      { role: "user", content: `Section: ${heading || "Untitled"}\n"""\n${text.slice(0, ai.maxSourceChars)}\n"""` },
    ],
    temperature: 0.2,
    maxTokens: 450,
    lane: "generate",
  });
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[•\-*]\s*/.test(l) ? `• ${l.replace(/^[•\-*]\s*/, "")}` : `• ${l}`))
    .slice(0, 9)
    .join("\n");
}

/* ---------------- card quality review ---------------- */

export interface CardIssue {
  n: number; // index in the batch
  problem: string;
  front: string;
  back: string;
}

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "problem", "front", "back"],
        properties: {
          n: { type: "integer" },
          problem: { type: "string" },
          front: { type: "string" },
          back: { type: "string" },
        },
      },
    },
  },
};

/** Ask the AI to flag weak cards in a batch and suggest a rewrite for each. */
export async function reviewCards(
  ai: AiConfig,
  cards: { front: string; back: string; type: string }[],
  language?: string | null
): Promise<CardIssue[]> {
  const list = cards.map((c, i) => `${i + 1}. [${c.type}] Q: ${c.front}\n   A: ${c.back}`).join("\n");
  const content = await chat(ai, {
    messages: [
      {
        role: "system",
        content:
          "You review flashcards for quality. Flag ONLY cards with a real problem: vague or ambiguous question, answer doesn't match the question, " +
          "question gives away the answer, factually doubtful, too long to recall, or tests trivia instead of understanding. " +
          'For each flagged card return {"n": its number, "problem": one short sentence, "front": improved question, "back": improved answer}. ' +
          'Good cards are omitted. Return JSON {"issues": [...]}, possibly empty. ' +
          languageLine(language),
      },
      { role: "user", content: list },
    ],
    schema: { name: "card_review", schema: REVIEW_SCHEMA },
    temperature: 0.2,
    maxTokens: 1800,
    lane: "generate",
  });
  const cleaned = content.replace(/```(?:json)?/g, "");
  const parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as { issues?: unknown };
  const out: CardIssue[] = [];
  for (const raw of Array.isArray(parsed.issues) ? parsed.issues : []) {
    const r = raw as Record<string, unknown>;
    const n = Number(r.n);
    if (!Number.isInteger(n) || n < 1 || n > cards.length) continue;
    const front = String(r.front ?? "").trim();
    const back = String(r.back ?? "").trim();
    out.push({ n: n - 1, problem: String(r.problem ?? "").slice(0, 300), front: front || cards[n - 1].front, back: back || cards[n - 1].back });
  }
  return out;
}
