/**
 * In-memory limiter for sign-in style endpoints: after `max` failures for a
 * key within `windowMs`, the key is locked until the window passes.
 * Pure module (no imports) so it can be unit-tested directly.
 */
export interface Limiter {
  /** ms until the key may try again, or 0 if allowed now. */
  retryAfter(key: string, now?: number): number;
  fail(key: string, now?: number): void;
  reset(key: string): void;
}

export function createLimiter(max: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>();
  const prune = (key: string, now: number) => {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };
  return {
    retryAfter(key, now = Date.now()) {
      const list = prune(key, now);
      if (list.length < max) return 0;
      return windowMs - (now - list[list.length - max]);
    },
    fail(key, now = Date.now()) {
      const list = prune(key, now);
      list.push(now);
      hits.set(key, list);
      if (hits.size > 10_000) hits.delete(hits.keys().next().value as string);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

const g = globalThis as unknown as { __quizyLimiters?: Record<string, Limiter> };
const limiters = (g.__quizyLimiters ??= {
  // 5 wrong passwords per account per 15 minutes; 30 per client address.
  account: createLimiter(5, 15 * 60_000),
  client: createLimiter(30, 15 * 60_000),
});

export const authLimiter = limiters;

export function clientKey(headers: Headers): string {
  return (headers.get("x-forwarded-for")?.split(",")[0] || headers.get("x-real-ip") || "local").trim();
}

export function tooManyMessage(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}
