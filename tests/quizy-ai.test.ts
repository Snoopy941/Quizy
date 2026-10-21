import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { QUIZY_AI_MODELS, coolDown, cooldownMs, modelsToTry, quizyAiKey, resetQuizyAiKey, secondsUntilFree } from "../src/lib/quizy-ai";
import { chat, resolveAiFromSettings } from "../src/lib/ai";

const settings = (o: Partial<{ aiProvider: string; aiBaseUrl: string; aiApiKey: string; aiModel: string }> = {}) => ({
  aiProvider: "auto",
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "",
  ...o,
});

function withKeyFile<T>(contents: string, fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizy-key-"));
  const file = path.join(dir, "ai-key.txt");
  fs.writeFileSync(file, contents);
  const prev = process.env.QUIZY_AI_KEY_FILE;
  process.env.QUIZY_AI_KEY_FILE = file;
  delete process.env.QUIZY_AI_KEY;
  resetQuizyAiKey();
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.QUIZY_AI_KEY_FILE;
    else process.env.QUIZY_AI_KEY_FILE = prev;
  }
}

test("the shared key is read from ai-key.txt (first line, trimmed)", () => {
  withKeyFile("  gsk_test123  \r\nignored\n", () => {
    assert.equal(quizyAiKey(), "gsk_test123");
  });
});

test("Automatic uses Quizy AI unless the user added their own key", () => {
  withKeyFile("gsk_shared", () => {
    const auto = resolveAiFromSettings(settings());
    assert.equal(auto?.kind, "builtin");
    assert.equal(auto?.apiKey, "gsk_shared");
    const own = resolveAiFromSettings(settings({ aiApiKey: "sk-mine", aiBaseUrl: "https://api.openai.com/v1" }));
    assert.equal(own?.kind, "api");
    assert.equal(own?.apiKey, "sk-mine");
    assert.equal(resolveAiFromSettings(settings({ aiProvider: "builtin", aiApiKey: "sk-mine" }))?.kind, "builtin");
  });
});

test("cooldown is read from Groq's retry-after header and message", () => {
  assert.equal(cooldownMs("7", ""), 7000);
  assert.equal(cooldownMs(null, "Rate limit reached ... Please try again in 1m30.5s."), 90500);
  assert.equal(cooldownMs(null, "Please try again in 12.25s"), 12250);
  assert.equal(cooldownMs(null, "Limit 200000, Used 199999 tokens per day (TPD)"), 3600_000);
  assert.equal(cooldownMs(null, "slow down"), 60_000);
});

test("rate-limited models are skipped until they cool down", () => {
  resetQuizyAiKey();
  const now = 1_000_000;
  assert.deepEqual(modelsToTry(now), QUIZY_AI_MODELS);
  coolDown(QUIZY_AI_MODELS[0], 60_000, now);
  assert.deepEqual(modelsToTry(now), QUIZY_AI_MODELS.slice(1));
  for (const m of QUIZY_AI_MODELS.slice(1)) coolDown(m, 120_000, now);
  // All busy: try the one that frees up first.
  assert.deepEqual(modelsToTry(now), [QUIZY_AI_MODELS[0]]);
  assert.equal(secondsUntilFree(now), 60);
  assert.deepEqual(modelsToTry(now + 61_000), [QUIZY_AI_MODELS[0]]);
  resetQuizyAiKey();
});

test("chat moves to the next model when one is rate-limited", async () => {
  await withKeyFile("gsk_shared", async () => {
    const ai = resolveAiFromSettings(settings())!;
    const seen: { model: string; auth: string | null }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ model: body.model, auth: new Headers(init.headers).get("authorization") });
      if (body.model === QUIZY_AI_MODELS[0]) {
        return new Response('{"error":{"message":"Please try again in 20s"}}', { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await chat(ai, { messages: [{ role: "user", content: "hi" }] });
      assert.equal(out, "hello");
      assert.deepEqual(seen.map((s) => s.model), [QUIZY_AI_MODELS[0], QUIZY_AI_MODELS[1]]);
      assert.equal(seen[0].auth, "Bearer gsk_shared");
      // The busy model is rested: the next request goes straight to the second one.
      seen.length = 0;
      await chat(ai, { messages: [{ role: "user", content: "again" }] });
      assert.deepEqual(seen.map((s) => s.model), [QUIZY_AI_MODELS[1]]);
    } finally {
      globalThis.fetch = realFetch;
      resetQuizyAiKey();
    }
  });
});

test("when every model is busy the error says what to do", async () => {
  await withKeyFile("gsk_shared", async () => {
    const ai = resolveAiFromSettings(settings())!;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    try {
      await assert.rejects(
        chat(ai, { messages: [{ role: "user", content: "hi" }] }),
        /free AI is busy.*own free API key/,
      );
    } finally {
      globalThis.fetch = realFetch;
      resetQuizyAiKey();
    }
  });
});
