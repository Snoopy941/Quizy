"use client";

import { useRouter } from "next/navigation";
import { fmtDuration } from "@/lib/client";
import { Icon } from "@/components/Icon";

export interface Summary {
  reviewed: number;
  graded: number;
  correct: number;
  accuracy: number;
  timeSpentSeconds: number;
  weakest: { category: string; seen: number; accuracy: number }[];
}

export function SessionSummary({
  summary,
  deckId,
  timed,
}: {
  summary: Summary;
  deckId: string | null;
  timed: boolean;
}) {
  const router = useRouter();

  return (
    <div className="card anim-rise mx-auto max-w-md p-8 text-center">
      <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
        <span className="ring-pulse absolute inset-0 rounded-full text-ink/40" />
        <Icon name={summary.accuracy >= 80 ? "trophy" : summary.accuracy >= 50 ? "muscle" : "books"} className="anim-pop h-10 w-10" strokeWidth={1.6} />
      </div>
      <h2 className="mt-3 text-xl font-bold">Session complete</h2>
      <p className="mt-1 text-sm text-dim">{timed ? "Time's up — nice work." : "Nice work!"}</p>

      <div className="stagger mt-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-line p-4">
          <div className="text-2xl font-extrabold tabular-nums">{summary.reviewed}</div>
          <div className="text-[11px] text-dim">reviewed</div>
        </div>
        <div className="rounded-xl border border-line p-4">
          <div className="text-2xl font-extrabold tabular-nums">{summary.accuracy}%</div>
          <div className="text-[11px] text-dim">accuracy</div>
        </div>
        <div className="rounded-xl border border-line p-4">
          <div className="text-2xl font-extrabold tabular-nums">{fmtDuration(summary.timeSpentSeconds)}</div>
          <div className="text-[11px] text-dim">time</div>
        </div>
      </div>

      {summary.weakest.length > 0 ? (
        <div className="mt-6 text-left">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Weakest categories</p>
          <ul className="space-y-1.5">
            {summary.weakest.map((w) => (
              <li key={w.category} className="flex items-center justify-between gap-4 text-sm">
                <span className="truncate text-dim">{w.category}</span>
                <span className="tabular-nums">{w.accuracy}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex justify-center gap-2">
        <button
          className="btn-secondary"
          onClick={() => {
            if (deckId) localStorage.removeItem(`quizy-active-${deckId}`);
            router.push(deckId ? `/deck/${deckId}` : "/");
          }}
        >
          Back
        </button>
        {summary.accuracy < 100 && summary.graded > 0 ? (
          <button
            className="btn-secondary"
            onClick={() => (window.location.href = deckId ? `/deck/${deckId}/study?mode=weak` : "/review?mode=weak")}
          >
            Practice weak spots
          </button>
        ) : null}
        <button className="btn-primary" onClick={() => window.location.reload()}>
          Study again
        </button>
      </div>
    </div>
  );
}
