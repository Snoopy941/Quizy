/**
 * "Quizy AI": the free AI that works with no setup.
 *
 * Quizy ships with one Groq API key (saved as ai-key.txt next to the app; it is
 * kept out of git). Every copy of Quizy shares that key's free limits, so the
 * models are tried in order: when one is rate-limited, Quizy moves on to the
 * next one for a while. Each model has its own daily allowance on Groq.
 * Anyone can still use their own key instead (Settings, then AI).
 */
import fs from "fs";
import path from "path";

export const QUIZY_AI_BASE = "https://api.groq.com/openai/v1";
/** Best first. Each has its own free-tier allowance. */
export const QUIZY_AI_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
export const QUIZY_VOICE_MODEL = "whisper-large-v3-turbo";
export const QUIZY_AI_LABEL = "Quizy AI (free)";

let cachedKey: string | null | undefined;

/** The shared key: QUIZY_AI_KEY, or the first line of ai-key.txt. */
export function quizyAiKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  const env = process.env.QUIZY_AI_KEY?.trim();
  if (env) return (cachedKey = env);
  const candidates = [
    process.env.QUIZY_AI_KEY_FILE,
    path.join(process.cwd(), "ai-key.txt"),
    process.env.QUIZY_DATA_DIR ? path.join(process.env.QUIZY_DATA_DIR, "ai-key.txt") : undefined,
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const key = fs.readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
      if (key) return (cachedKey = key);
    } catch {
      /* try the next one */
    }
  }
  return (cachedKey = null);
}

/** For tests. */
export function resetQuizyAiKey() {
  cachedKey = undefined;
  cooling.clear();
}

/* ---------------- rate-limit rotation ---------------- */

const cooling = new Map<string, number>(); // model -> usable again at (ms)

/** Models to try, in order: available ones first, then the one that frees up soonest. */
export function modelsToTry(now = Date.now()): string[] {
  const ready = QUIZY_AI_MODELS.filter((m) => (cooling.get(m) ?? 0) <= now);
  if (ready.length) return ready;
  return [...QUIZY_AI_MODELS].sort((a, b) => (cooling.get(a) ?? 0) - (cooling.get(b) ?? 0)).slice(0, 1);
}

/** How long to rest a model after a 429, from Groq's headers and message. */
export function cooldownMs(retryAfter: string | null, body: string): number {
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 6 * 3600) * 1000;
  // "Please try again in 1m30.5s" / "in 12.3s" / "in 2h5m"
  const m = /try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(body);
  if (m && (m[1] || m[2] || m[3])) {
    const total = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    if (total > 0) return Math.min(total, 6 * 3600) * 1000;
  }
  // Daily caps (requests or tokens per day) last much longer than per-minute ones.
  if (/per day|\bRPD\b|\bTPD\b/i.test(body)) return 3600 * 1000;
  return 60 * 1000;
}

export function coolDown(model: string, ms: number, now = Date.now()) {
  cooling.set(model, Math.max(cooling.get(model) ?? 0, now + ms));
}

/** Seconds until any model is usable again (0 = one is free now). */
export function secondsUntilFree(now = Date.now()): number {
  const soonest = Math.min(...QUIZY_AI_MODELS.map((m) => cooling.get(m) ?? 0));
  return Math.max(0, Math.ceil((soonest - now) / 1000));
}
