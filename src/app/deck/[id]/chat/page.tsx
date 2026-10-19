"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: { heading: string; where: string | null }[];
}

const STARTERS = ["Summarize the main ideas", "What are the key terms I should know?", "Explain the hardest concept simply", "Quiz me with one question"];

export default function DeckChatPage() {
  const { id } = useParams<{ id: string }>();
  const [deckName, setDeckName] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ deck: { name: string } }>(`/api/decks/${id}`)
      .then((d) => setDeckName(d.deck.name))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setDraft("");
    setError(null);
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setBusy(true);
    try {
      const r = await api<{ answer: string; sources: Turn["sources"] }>(`/api/decks/${id}/chat`, {
        method: "POST",
        body: JSON.stringify({ question, history }),
      });
      setTurns((t) => [...t, { role: "assistant", content: r.answer, sources: r.sources }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setTurns((t) => t.slice(0, -1));
      setDraft(question);
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link href={`/deck/${id}`} className="text-xs text-faint hover:text-dim">
            ← {deckName || "Deck"}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Ask your document</h1>
          <p className="mt-1 text-sm text-dim">Answers come only from your material, with page references.</p>
        </div>
        {turns.length ? (
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setTurns([])}>
            New chat
          </button>
        ) : null}
      </div>

      <div className="space-y-4">
        {!turns.length ? (
          <div className="card p-6">
            <p className="text-sm text-dim">Try one of these:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} className="badge py-1.5 hover:text-ink" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-surface2 px-4 py-2.5 text-sm">
              {t.content}
            </div>
          ) : (
            <div key={i} className="card p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.content}</p>
              {t.sources?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                  <span className="text-[11px] text-faint">From:</span>
                  {t.sources.map((s, j) => (
                    <span key={j} className="badge text-[11px]">
                      {s.heading}
                      {s.where ? ` · ${s.where}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )
        )}
        {busy ? <div className="skeleton h-24 w-full" /> : null}
        {error ? <p className="text-sm text-dim">{error}</p> : null}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-20 mt-6 flex gap-2 rounded-2xl border border-line bg-bg/95 p-2 backdrop-blur md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <input
          className="input border-0 bg-transparent"
          placeholder="Ask anything about this material…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          maxLength={1000}
          autoFocus
        />
        <button className="btn-primary shrink-0 px-4" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
