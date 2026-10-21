"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface AiStatus {
  active: { kind: "builtin" | "api" | "demo"; label: string; model: string } | null;
  preference: "auto" | "builtin" | "api";
  builtin: { available: boolean; needsDownload?: boolean; model: string; status: string; error: string | null; gpu: boolean | null; busy: number };
  api: { baseUrl: string; model: string; hasKey: boolean; keyHint: string; envConfigured: boolean };
  demo: boolean;
}

const PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", needsKey: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", needsKey: true },
  { id: "ollama", label: "Ollama (this PC)", baseUrl: "http://localhost:11434/v1", model: "qwen3:4b", needsKey: false },
];

const STATUS_TEXT: Record<string, string> = {
  ready: "Running",
  starting: "Loading the model…",
  stopped: "Ready — starts automatically when needed",
  error: "Couldn't start",
  unavailable: "Not included in this install",
};

export function AiSettings() {
  const [st, setSt] = useState<AiStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<AiStatus>("/api/ai/status");
      setSt(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void load().then((s) => {
      if (!s) return;
      setBaseUrl(s.api.baseUrl);
      setModel(s.api.model);
    });
  }, [load]);

  // Poll while the built-in model is loading
  useEffect(() => {
    if (st?.builtin.status !== "starting") return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [st?.builtin.status, load]);

  const save = async (settings: Record<string, unknown>, note = "Saved") => {
    setSaving(true);
    setMsg(null);
    try {
      await api("/api/me", { method: "PATCH", body: JSON.stringify({ settings }) });
      await load();
      setMsg(note);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save");
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    const poll = setInterval(() => void load(), 1500);
    try {
      const r = await api<{ ok: boolean; label: string; ms: number; error?: string }>("/api/ai/test", { method: "POST" });
      setMsg(`${r.label} answered in ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      setMsg(`Test failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    clearInterval(poll);
    await load();
    setTesting(false);
  };

  if (!st) return <div className="skeleton h-48 w-full" />;

  const pref = st.preference;
  const choice = (id: "auto" | "builtin" | "api", title: string, hint: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled || saving}
      onClick={() => void save({ aiProvider: id })}
      className={`rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-40 ${
        pref === id ? "border-accent bg-surface2" : "border-line hover:border-faint"
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-[11px] text-faint">{hint}</div>
    </button>
  );

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">AI</h2>
          <p className="mt-1 text-xs text-dim">
            {st.active ? (
              <>
                Making cards with <span className="text-ink">{st.active.label}</span>
              </>
            ) : (
              "No AI set up yet — pick one below to start making cards."
            )}
          </p>
        </div>
        <button className="btn-secondary shrink-0 px-3 py-1.5 text-xs" onClick={() => void test()} disabled={testing || !st.active}>
          {testing ? "Testing…" : "Test"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {choice("auto", "Automatic", "Built-in if available, else your API key")}
        {choice("builtin", "Built-in (offline)", st.builtin.available ? "Free, private, no key" : "Not in this install", !st.builtin.available)}
        {choice("api", "API key", "Faster — OpenAI, OpenRouter, Ollama…")}
      </div>

      {/* Built-in */}
      <div className="mt-5 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Built-in AI · {st.builtin.model}</p>
            <p className="mt-0.5 text-xs text-dim">
              {STATUS_TEXT[st.builtin.status] ?? st.builtin.status}
              {st.builtin.status === "ready" && st.builtin.gpu !== null ? ` · ${st.builtin.gpu ? "using your GPU" : "using your CPU"}` : ""}
            </p>
          </div>
        </div>
        {st.builtin.error ? <p className="mt-2 text-xs text-dim">{st.builtin.error}</p> : null}
        {st.builtin.needsDownload ? (
          <p className="mt-2 text-xs text-ink">
            The AI engine is installed — download a model below under <b>Downloads</b> to turn it on (one time, then it works offline).
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-faint">
          Runs entirely on this computer — your documents never leave it. Expect about 20–60 seconds per section on a
          typical laptop (faster with a graphics card).
        </p>
      </div>

      {/* API */}
      <form
        className="mt-4 space-y-3 rounded-xl border border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const settings: Record<string, unknown> = { aiBaseUrl: baseUrl, aiModel: model };
          if (apiKey) settings.aiApiKey = apiKey;
          void save(settings).then(() => setApiKey(""));
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">API key (optional)</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="badge hover:text-ink"
                onClick={() => {
                  setBaseUrl(p.baseUrl);
                  setModel(p.model);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label !text-xs" htmlFor="ai-base">API URL</label>
          <input id="ai-base" className="input" placeholder="https://api.openai.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label !text-xs" htmlFor="ai-key">
              API key {st.api.hasKey ? <span className="text-faint">(saved {st.api.keyHint})</span> : null}
            </label>
            <input
              id="ai-key"
              className="input"
              type="password"
              autoComplete="off"
              placeholder={st.api.hasKey ? "Leave blank to keep the saved key" : "sk-…  (not needed for Ollama)"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div>
            <label className="label !text-xs" htmlFor="ai-model">Model</label>
            <input id="ai-model" className="input" placeholder="gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {st.api.hasKey ? (
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void save({ aiApiKey: "" }, "Key removed")}>
              Remove saved key
            </button>
          ) : null}
          <button className="btn-primary px-4 py-2 text-sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="text-[11px] text-faint">
          The key is stored only in Quizy&apos;s database on this computer and is never shown again or sent to the browser.
        </p>
      </form>

      {msg ? <p className="mt-3 text-sm text-dim">{msg}</p> : null}
      {st.demo ? <p className="mt-2 text-[11px] text-faint">Developer mode: MOCK_AI=1 enables the demo generator when nothing else is set up.</p> : null}
    </section>
  );
}
