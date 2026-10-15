"use client";

import { useRouter } from "next/navigation";
import { fmtDuration } from "@/lib/client";

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
    <div className="card mx-auto max-w-md p-8 text-center">
      <div className="text-4xl">{summary.accuracy >= 80 ? "🏆" : summary.accuracy >= 50 ? "💪" : "📚"}</div>
      <h2 className="mt-3 text-xl font-bold">Session complete</h2>
      <p className="mt-1 text-sm text-dim">{timed ? "Time's up — nice work." : "Nice work!"}</p>

      <div className="mt-6 grid grid-cols-3 gap-2">
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
        <button className="btn-primary" onClick={() => window.location.reload()}>
          Study again
        </button>
      </div>
    </div>
  );
}
