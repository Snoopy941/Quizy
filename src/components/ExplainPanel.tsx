"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * "Explain this" tutor panel: the AI explains the card using the section of
 * the source it came from; the student can ask follow-up questions.
 */
export function ExplainPanel({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const ask = async (question?: string) => {
    setBusy(true);
    setError(null);
    const history = turns;
    if (question) setTurns((t) => [...t, { role: "user", content: question }]);
    try {
      const res = await api<{ answer: string }>(`/api/cards/${cardId}/explain`, {
        method: "POST",
        body: JSON.stringify({ question, history }),
      });
      setTurns((t) => [...t, { role: "assistant", content: res.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get an explanation");
      if (question) setTurns((t) => t.slice(0, -1));
    }
    setBusy(false);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  return (
    <div className="card mt-4 p-5" onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Explain this</h3>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={onClose} aria-label="Close explanation">
          ✕
        </button>
      </div>
      <div ref={scrollRef} className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === "assistant"
                ? "whitespace-pre-wrap text-sm leading-relaxed text-ink"
                : "ml-auto w-fit max-w-[85%] rounded-xl bg-surface2 px-3 py-2 text-sm text-dim"
            }
          >
            {t.content}
          </div>
        ))}
        {busy ? <div className="skeleton h-16 w-full" /> : null}
        {error ? <p className="text-sm text-dim">{error}</p> : null}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          if (!q || busy) return;
          setDraft("");
          void ask(q);
        }}
      >
        <input
          className="input py-2 text-sm"
          placeholder="Ask a follow-up… (e.g. give me an example)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          maxLength={1000}
        />
        <button className="btn-secondary shrink-0 px-3 py-2 text-xs" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
