"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface AiStatus {
  active: { kind: "builtin" | "api" | "demo"; label: string; model: string } | null;
  preference: "auto" | "builtin" | "api";
  builtin: { available: boolean; label: string; busyFor: number };
  api: { baseUrl: string; model: string; hasKey: boolean; keyHint: string; envConfigured: boolean };
  demo: boolean;
}

const PRESETS = [
  { id: "groq", label: "Groq (free)", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", needsKey: true },
  { id: "gemini", label: "Gemini (free)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", needsKey: true },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", needsKey: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", needsKey: true },
  { id: "ollama", label: "Ollama (this PC)", baseUrl: "http://localhost:11434/v1", model: "qwen3:4b", needsKey: false },
];

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
    try {
      const r = await api<{ ok: boolean; label: string; ms: number; error?: string }>("/api/ai/test", { method: "POST" });
      setMsg(`${r.label} answered in ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      setMsg(`Test failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
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
        {choice("auto", "Automatic", "Your own key if you add one, otherwise Quizy AI")}
        {choice("builtin", "Quizy AI", st.builtin.available ? "Free, nothing to set up" : "Not in this version", !st.builtin.available)}
        {choice("api", "Your own key", "Groq, Gemini, OpenAI, Ollama…")}
      </div>

      {/* Quizy AI */}
      <div className="mt-5 rounded-xl border border-line p-4">
        <p className="text-sm font-medium">Quizy AI</p>
        <p className="mt-0.5 text-xs text-dim">
          {st.builtin.available
            ? st.builtin.busyFor > 0
              ? "Busy right now because lots of people are using it. It frees up again shortly."
              : "Ready. Free for everyone, with nothing to set up."
            : "Not included in this version of Quizy."}
        </p>
        <p className="mt-2 text-[11px] text-faint">
          Quizy AI runs on Groq&apos;s servers, so the text of the section being turned into cards is sent there. Your decks and
          files stay on this computer. Everyone shares its free limit; if it&apos;s busy, add your own free key below.
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
          <p className="text-sm font-medium">Your own API key (optional)</p>
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
              placeholder={st.api.hasKey ? "Leave blank to keep the saved key" : "Paste your key (not needed for Ollama)"}
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
