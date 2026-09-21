"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { playFlip, playGrade, playChime } from "@/lib/sound";
import { celebrate } from "@/components/ConfettiHost";
import { DesktopBar, useInDesktopShell } from "@/components/DesktopBar";
import { SessionSummary, type Summary } from "./SessionSummary";

interface QueueCard {
  id: string;
  front: string;
  back: string;
  type: string;
  options: string[] | null;
  difficulty: string;
  category: string;
  deckId: string;
  deckName: string;
  reps: number;
}

const MINUTES_OPTIONS = [5, 10, 15, 30, 60];

export function StudySessionClient({
  deckId,
  timedMinutes,
}: {
  deckId: string | null;
  timedMinutes: number | null;
}) {
  const router = useRouter();
  const inShell = useInDesktopShell();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showAnswerAfterGrade, setShowAnswerAfterGrade] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [lastGrade, setLastGrade] = useState<null | { correct: boolean; label: string }>(null);
  const [minutes, setMinutes] = useState(timedMinutes ?? 10);
  const [started, setStarted] = useState(!timedMinutes);
  const [remaining, setRemaining] = useState((timedMinutes ?? 10) * 60);

  const card = cards[index];
  const timed = timedMinutes !== null;
  const cardStart = useRef<number>(Date.now());
  const easterEggFired = useRef(false);
  const gradingRef = useRef(false);
  const finishingRef = useRef(false);

  /* ---------- load queue ---------- */
  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (deckId) q.set("deckId", deckId);
      q.set("shuffle", shuffle ? "1" : "0");
      q.set("limit", "60");
      const d = await api<{ cards: QueueCard[]; dueCount: number; newCount: number }>(
        `/api/study/queue?${q.toString()}`
      );
      setCards(d.cards);
      setDueCount(d.dueCount);
      setNewCount(d.newCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cards");
    }
    setLoading(false);
  }, [deckId, shuffle]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  /* ---------- countdown (timed mode) ---------- */
  useEffect(() => {
    if (!timed || !started || summary) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(t);
          void finishRef.current?.(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timed, started, summary]);

  const finishRef = useRef<((markCompleted: boolean) => Promise<void>) | null>(null);

  /* ---------- finish ---------- */
  const finishSession = useCallback(
    async (markCompleted: boolean) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      const sid = sessionId;
      try {
        if (sid) {
          const res = await api<{ summary: Summary }>("/api/study/finish", {
            method: "POST",
            body: JSON.stringify({ sessionId: sid, abandon: !markCompleted }),
          });
          setSummary(res.summary);
        } else {
          setSummary({
            reviewed: reviewedCount,
            graded: reviewedCount,
            correct: correctCount,
            accuracy: reviewedCount ? Math.round((correctCount / reviewedCount) * 100) : 0,
            timeSpentSeconds: 0,
            weakest: [],
          });
        }
      } catch {
        setSummary({
          reviewed: reviewedCount,
          graded: reviewedCount,
          correct: correctCount,
          accuracy: reviewedCount ? Math.round((correctCount / reviewedCount) * 100) : 0,
          timeSpentSeconds: 0,
          weakest: [],
        });
      }
      if (deckId) localStorage.removeItem(`quizy-active-${deckId}`);
      playChime();
      celebrate();
    },
    [sessionId, reviewedCount, correctCount, deckId]
  );

  useEffect(() => {
    finishRef.current = finishSession;
  }, [finishSession]);

  /* ---------- resume prompt ---------- */
  useEffect(() => {
    if (loading || error || !deckId) return;
    if (cards.length === 0) return;
    if (sessionId) return;
    const raw = localStorage.getItem(`quizy-active-${deckId}`);
    if (!raw) return;
    try {
      const { index: idx } = JSON.parse(raw);
      if (idx > 0) {
        setIndex(Math.min(idx, cards.length - 1));
      }
      localStorage.removeItem(`quizy-active-${deckId}`);
    } catch {
      /* ignore */
    }
  }, [loading, error, cards.length, deckId, sessionId]);

  /* ---------- grade ---------- */
  const grade = useCallback(
    async (g: "again" | "hard" | "good" | "easy" | "skip") => {
      if (!card || gradingRef.current) return;
      gradingRef.current = true;
      const timeSpent = Math.round((Date.now() - cardStart.current) / 1000);

      if (g !== "skip") {
        try {
          const res = await api<{ sessionId: string }>("/api/study/grade", {
            method: "POST",
            body: JSON.stringify({
              cardId: card.id,
              grade: g,
              sessionId,
              timeSpentSeconds: timeSpent,
              timed,
              timerMinutes: timed ? minutes : undefined,
              deckId: deckId ?? undefined,
            }),
          });
          if (!sessionId) setSessionId(res.sessionId);
          if (deckId) {
            localStorage.setItem(
              `quizy-active-${deckId}`,
              JSON.stringify({ sessionId: res.sessionId, index: index + 1 })
            );
          }
        } catch (err) {
          console.error("grade failed", err);
        }
        const correct = g !== "again";
        setReviewedCount((n) => n + 1);
        if (correct) {
          setCorrectCount((n) => n + 1);
          setLastGrade({ correct: true, label: g });
          // easter egg: 50 correct in one session
          if (correctCount + 1 === 50 && !easterEggFired.current) {
            easterEggFired.current = true;
            celebrate({ burst: true });
          }
        } else {
          setLastGrade({ correct: false, label: g });
        }
        playGrade(correct);
      } else {
        setLastGrade({ correct: false, label: "skipped" });
      }

      if (g === "skip") {
        setCards((cs) => [...cs, card]);
      }

      setShowAnswerAfterGrade(true);
      setTimeout(() => {
        setShowAnswerAfterGrade(false);
        setFlipped(false);
        setLastGrade(null);
        setIndex((i) => i + 1);
        cardStart.current = Date.now();
        gradingRef.current = false;
      }, 850);
    },
    [card, sessionId, timed, minutes, deckId, index, correctCount]
  );

  /* ---------- end of queue: timed mode recycles, untimed mode finishes ---------- */
  useEffect(() => {
    if (!started || summary || cards.length === 0) return;
    if (index >= cards.length) {
      if (timed) {
        setIndex(0);
        setFlipped(false);
      } else {
        void finishSession(true);
      }
    }
  }, [index, cards.length, timed, started, summary, finishSession]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (summary || !started) return;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        if (!flipped && !showAnswerAfterGrade) {
          setFlipped(true);
          playFlip();
        }
      } else if (["1", "2", "3", "4"].includes(k)) {
        if (!flipped && !showAnswerAfterGrade) return;
        e.preventDefault();
        void grade(k === "1" ? "again" : k === "2" ? "hard" : k === "3" ? "good" : "easy");
      } else if (k === "s") {
        e.preventDefault();
        void grade("skip");
      } else if (k === "f") {
        setFocusMode((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, showAnswerAfterGrade, grade, started, summary]);

  /* ---------- render guards ---------- */
  if (summary) return <SessionSummary summary={summary} deckId={deckId} timed={timed} />;

  if (loading && cards.length === 0) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-9 w-full" />
        <div className="skeleton h-96 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-dim">{error}</p>
        <button className="btn-primary mt-4" onClick={() => void loadQueue()}>
          Retry
        </button>
      </div>
    );
  }

  if (!cards.length) {
    return (
      <div className="card mx-auto max-w-md p-10 text-center">
        <div className="text-4xl">🎉</div>
        <h2 className="mt-3 text-lg font-bold">All caught up!</h2>
        <p className="mt-1 text-sm text-dim">No cards are due right now.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                const q = new URLSearchParams();
                if (deckId) q.set("deckId", deckId);
                q.set("includeAll", "1");
                q.set("limit", "40");
                const d = await api<{ cards: QueueCard[] }>(`/api/study/queue?${q.toString()}`);
                setCards(d.cards);
                setStarted(true);
              } catch {
                /* ignore */
              }
            }}
          >
            Review ahead
          </button>
          <Link href={deckId ? `/deck/${deckId}` : "/library"} className="btn-ghost">
            Back
          </Link>
          <Link href="/library/new" className="btn-primary">
            + New deck
          </Link>
        </div>
      </div>
    );
  }

  if (!card) {
    // Past the end of the queue: the effect below either recycles (timed)
    // or finishes the session (untimed). Render a neutral placeholder
    // for this single frame instead of crashing on an undefined card.
    return (
      <div className="mx-auto max-w-2xl">
        <div className="skeleton h-96 w-full" />
      </div>
    );
  }

  if (!started) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h2 className="text-lg font-bold">Timed review</h2>
        <p className="mt-1 text-sm text-dim">
          {dueCount} due · {newCount} new · {cards.length} in queue
        </p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {MINUTES_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMinutes(m);
                setRemaining(m * 60);
              }}
              className={`rounded-xl border px-3 py-3 text-center ${
                minutes === m ? "border-accent bg-surface2" : "border-line hover:border-faint"
              }`}
            >
              <div className="text-lg font-bold tabular-nums">{m}</div>
              <div className="text-[11px] text-faint">min</div>
            </button>
          ))}
        </div>
        <button
          className="btn-primary mt-6 w-full"
          onClick={() => {
            cardStart.current = Date.now();
            setStarted(true);
          }}
        >
          Start {minutes}-minute session
        </button>
        <Link href={deckId ? `/deck/${deckId}` : "/"} className="btn-ghost mt-2 w-full">
          Cancel
        </Link>
      </div>
    );
  }

  const progressPct = Math.min(100, Math.round((index / Math.max(1, cards.length)) * 100));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className={`mx-auto max-w-2xl ${inShell ? "pt-10" : ""}`}>
      {inShell ? <DesktopBar /> : null}
      {/* top bar */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => router.back()}>
          ← Exit
        </button>
        {timed ? (
          <div className="text-center">
            <div className="text-2xl font-extrabold tabular-nums">
              {mm}:{ss}
            </div>
            <div className="text-[11px] text-faint">{reviewedCount} reviewed</div>
          </div>
        ) : (
          <div className="text-center text-xs text-faint">
            {Math.min(index + 1, cards.length)} of {cards.length}
          </div>
        )}
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setFocusMode(true)}>
            Focus
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
        <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progressPct}%` }} />
      </div>

      {/* card */}
      <div
        className="flip-scene select-none"
        onClick={() => {
          if (!flipped && !showAnswerAfterGrade) {
            setFlipped(true);
            playFlip();
          }
        }}
      >
        <div className={`flip-inner ${flipped || showAnswerAfterGrade ? "flipped" : ""}`}>
          <div className="flip-face card flex min-h-[24rem] cursor-pointer flex-col p-8">
            <div className="flex items-center justify-between">
              <span className="badge">{card.category}</span>
              <span className="text-[11px] text-faint">{card.type}</span>
            </div>
            <div className="flex flex-1 items-center justify-center px-2 py-8">
              <p className="text-center text-xl font-medium leading-relaxed md:text-2xl">{card.front}</p>
            </div>
            <p className="text-center text-xs text-faint">click or press Space to flip</p>
          </div>
          <div className="flip-face flip-back card flex min-h-[24rem] flex-col p-8">
            <div className="flex items-center justify-between">
              <span className="badge">{card.difficulty}</span>
              {!focusMode ? <span className="text-[11px] text-faint">{card.deckName}</span> : null}
            </div>
            <div className="flex flex-1 items-center justify-center px-2 py-8">
              <p className="text-center text-lg leading-relaxed md:text-xl">{card.back}</p>
            </div>
            <p className="text-center text-xs text-faint">press 1–4 or tap a grade button</p>
          </div>
        </div>
      </div>

      {/* grade buttons */}
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-5">
        <button className="btn-secondary py-3 text-xs" onClick={() => void grade("skip")}>
          Skip <kbd className="ml-1 hidden text-faint md:inline">S</kbd>
        </button>
        {(
          [
            ["again", "1", "Again"],
            ["hard", "2", "Hard"],
            ["good", "3", "Good"],
            ["easy", "4", "Easy"],
          ] as const
        ).map(([g, key, label]) => (
          <button
            key={g}
            disabled={!flipped && !showAnswerAfterGrade}
            onClick={() => void grade(g)}
            className="btn-secondary py-3 text-sm"
          >
            {label} <kbd className="ml-1 hidden text-faint md:inline">{key}</kbd>
          </button>
        ))}
      </div>

      {lastGrade ? (
        <div className="mt-3 text-center text-xs text-dim">
          {lastGrade.correct ? "✓ " : "✗ "}
          {lastGrade.label} — next card…
        </div>
      ) : null}

      <p className="mt-6 text-center text-[11px] text-faint">
        Progress is saved after every card — safe to close the tab and resume later.
      </p>
    </div>
  );
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}
