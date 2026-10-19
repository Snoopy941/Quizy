"use client";

export { fmtDate, timeAgo, fmtDuration, pageLabel, sourceKindLabel, CARD_LANGUAGES, OCR_LANGUAGE_NAMES, SPEECH_LANG } from "./format";

/** JSON fetch helper that throws on non-OK with the server's error message. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}
