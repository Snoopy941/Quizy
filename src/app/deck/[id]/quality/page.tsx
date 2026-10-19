"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface Issue {
  cardId: string;
  front: string;
  back: string;
  problem: string;
  source: "check" | "ai";
  suggestion: { front: string; back: string } | null;
}

/** Card quality checker: local checks + AI review in batches, with one-click fixes. */
export default function DeckQualityPage() {
  const { id } = useParams<{ id: string }>();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deckName, setDeckName] = useState("");
  const [handled, setHandled] = useState<Record<string, "fixed" | "dismissed">>({});
  const stop = useRef(false);

  const run = async () => {
    stop.current = false;
    setRunning(true);
    setIssues([]);
    setHandled({});
    setError(null);
    let offset: number | null = 0;
    while (offset !== null && !stop.current) {
      try {
        const r: { issues: Issue[]; nextOffset: number | null; total: number } = await api(`/api/decks/${id}/review`, {
          method: "POST",
          body: JSON.stringify({ offset }),
        });
        setIssues((list) => [...list, ...r.issues]);
        setProgress({ done: r.nextOffset ?? r.total, total: r.total });
        offset = r.nextOffset;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Review failed");
        break;
      }
    }
    setRunning(false);
  };

  useEffect(() => {
    api<{ deck: { name: string } }>(`/api/decks/${id}`)
      .then((d) => setDeckName(d.deck.name))
      .catch(() => {});
    void run();
    return () => {
      stop.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const key = (i: Issue, n: number) => `${i.cardId}:${n}`;
  const apply = async (i: Issue, n: number) => {
    if (!i.suggestion) return;
    try {
      await api(`/api/cards/${i.cardId}`, { method: "PATCH", body: JSON.stringify(i.suggestion) });
      setHandled((h) => ({ ...h, [key(i, n)]: "fixed" }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't update the card");
    }
  };
  const open = issues.filter((i, n) => !handled[key(i, n)]).length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/deck/${id}`} className="text-xs text-faint hover:text-dim">
        ← {deckName || "Deck"}
      </Link>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Card quality check</h1>
          <p className="mt-1 text-sm text-dim">
            {running
              ? `Reviewing… ${progress ? `${progress.done} of ${progress.total} cards` : ""}`
              : progress
                ? `Checked ${progress.total} cards · ${open} suggestion${open === 1 ? "" : "s"} left`
                : ""}
          </p>
        </div>
        {running ? (
          <button className="btn-ghost shrink-0" onClick={() => (stop.current = true)}>
            Stop
          </button>
        ) : (
          <button className="btn-secondary shrink-0" onClick={() => void run()}>
            Check again
          </button>
        )}
      </div>
      {progress && running ? (
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
        </div>
      ) : null}
      {error ? <p className="mb-4 text-sm text-dim">{error}</p> : null}
      {!running && progress && !issues.length ? (
        <div className="card p-10 text-center text-sm text-dim">No problems found — these cards look good. 🎉</div>
      ) : null}
      <div className="space-y-3">
        {issues.map((i, n) => {
          const state = handled[key(i, n)];
          return (
            <div key={key(i, n)} className={`card p-5 ${state ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{i.problem}</p>
                <span className="badge shrink-0 text-[10px]">{i.source === "ai" ? "AI review" : "check"}</span>
              </div>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-line p-3">
                  <p className="text-[11px] uppercase tracking-wide text-faint">Now</p>
                  <p className="mt-1">{i.front}</p>
                  <p className="mt-1 text-dim">{i.back}</p>
                </div>
                {i.suggestion ? (
                  <div className="rounded-xl border border-accent/40 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-faint">Suggested</p>
                    <p className="mt-1">{i.suggestion.front}</p>
                    <p className="mt-1 text-dim">{i.suggestion.back}</p>
                  </div>
                ) : null}
              </div>
              {!state ? (
                <div className="mt-3 flex justify-end gap-2">
                  <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setHandled((h) => ({ ...h, [key(i, n)]: "dismissed" }))}>
                    Dismiss
                  </button>
                  {i.suggestion ? (
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void apply(i, n)}>
                      Apply fix
                    </button>
                  ) : (
                    <Link href={`/deck/${id}`} className="btn-secondary px-3 py-1.5 text-xs">
                      Edit in deck
                    </Link>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-right text-xs text-faint">{state === "fixed" ? "Fixed ✓" : "Dismissed"}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
