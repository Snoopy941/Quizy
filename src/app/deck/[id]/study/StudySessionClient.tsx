"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { playFlip, playGrade, playChime } from "@/lib/sound";
import { celebrate } from "@/components/ConfettiHost";
import { DesktopBar, useInDesktopShell } from "@/components/DesktopBar";
import { SessionSummary, type Summary } from "./SessionSummary";
import { ExplainPanel } from "@/components/ExplainPanel";
import { SourcePanel } from "@/components/SourcePanel";
import { pageLabel, SPEECH_LANG } from "@/lib/client";
import { canSpeak, speak, startRecording, stopSpeaking, type Recorder } from "@/lib/audio";

type GradeKey = "again" | "hard" | "good" | "easy";

/** What the student did on the front of the card before revealing it. */
interface AnswerState {
  /** Option picked on a multiple-choice / true-false card. */
  picked?: string;
  /** Text typed on a fill-in-the-blank / short-answer card. */
  typed?: string;
  checking?: boolean;
  result?: { verdict: "correct" | "partial" | "incorrect"; feedback: string; judgedBy: "local" | "ai" };
  suggested?: GradeKey;
}

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
  sourcePage: number | null;
  sourceType: string;
  hasSource: boolean;
  previews?: Record<GradeKey, string>;
  imageUrl?: string | null;
  figureUrl?: string | null;
  cardLanguage?: string;
}

const TYPED_TYPES = new Set(["fill-blank", "short-answer"]);
const sameAnswer = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function choicesFor(card: QueueCard): string[] | null {
  if (card.type === "mc" && card.options && card.options.length >= 2) return card.options;
  if (card.type === "true-false") return ["True", "False"];
  return null;
}

const MINUTES_OPTIONS = [5, 10, 15, 30, 60];

export function StudySessionClient({
  deckId,
  timedMinutes,
  mode = null,
}: {
  deckId: string | null;
  timedMinutes: number | null;
  mode?: "weak" | null;
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
  const [answer, setAnswer] = useState<AnswerState>({});
  const [explainOpen, setExplainOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const typedRef = useRef<HTMLInputElement>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);

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
      if (mode === "weak") q.set("mode", "weak");
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
  }, [deckId, shuffle, mode]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  /* ---------- read-aloud preference + voice availability ---------- */
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setReadAloud(Boolean(d?.settings?.readAloud)))
      .catch(() => {});
    fetch("/api/voice/transcribe")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVoiceAvailable(Boolean(d?.available)))
      .catch(() => setVoiceAvailable(false));
    return () => stopSpeaking();
  }, []);

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

  /* ---------- reveal / interactive answers ---------- */
  const reveal = useCallback(() => {
    if (!flipped && !showAnswerAfterGrade) {
      setFlipped(true);
      playFlip();
    }
  }, [flipped, showAnswerAfterGrade]);

  const pickOption = useCallback(
    (option: string) => {
      if (!card || flipped || showAnswerAfterGrade) return;
      const correct = sameAnswer(option, card.back);
      setAnswer({
        picked: option,
        result: {
          verdict: correct ? "correct" : "incorrect",
          feedback: correct ? "Correct!" : `The answer is “${card.back}”.`,
          judgedBy: "local",
        },
        suggested: correct ? "good" : "again",
      });
      reveal();
    },
    [card, flipped, showAnswerAfterGrade, reveal]
  );

  const checkTyped = useCallback(
    async (typed: string) => {
      if (!card || answer.checking) return;
      if (!typed.trim()) {
        reveal();
        return;
      }
      setAnswer({ typed, checking: true });
      try {
        const r = await api<{
          verdict: "correct" | "partial" | "incorrect";
          feedback: string;
          suggestedGrade: GradeKey;
          judgedBy: "local" | "ai";
        }>("/api/study/check", { method: "POST", body: JSON.stringify({ cardId: card.id, answer: typed }) });
        setAnswer({ typed, result: { verdict: r.verdict, feedback: r.feedback, judgedBy: r.judgedBy }, suggested: r.suggestedGrade });
      } catch {
        setAnswer({ typed });
      }
      reveal();
    },
    [card, answer.checking, reveal]
  );

  /* ---------- read aloud ---------- */
  const speechLang = card?.cardLanguage && card.cardLanguage !== "auto" ? SPEECH_LANG[card.cardLanguage] : undefined;
  const sayFront = useCallback(() => {
    if (!card) return;
    const opts = choicesFor(card);
    speak(opts ? `${card.front}. ${opts.join(". ")}` : card.front, speechLang);
  }, [card, speechLang]);
  const sayBack = useCallback(() => {
    if (card) speak(card.back, speechLang);
  }, [card, speechLang]);

  useEffect(() => {
    if (readAloud && started && card && !flipped && !showAnswerAfterGrade) sayFront();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAloud, started, card?.id]);
  useEffect(() => {
    if (readAloud && flipped) sayBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAloud, flipped]);

  /* ---------- voice answers ---------- */
  const toggleVoice = useCallback(async () => {
    if (!card) return;
    if (voiceAvailable === false) {
      setVoiceMsg("Voice answers need a one-time download — Settings → Downloads → Voice answers.");
      return;
    }
    if (recording === "recording") {
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (!rec) return;
      setRecording("transcribing");
      try {
        const wav = await rec.stop();
        const lang = card.cardLanguage && card.cardLanguage !== "auto" ? card.cardLanguage : "auto";
        const res = await fetch(`/api/voice/transcribe?lang=${encodeURIComponent(lang)}`, { method: "POST", body: wav });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't understand the recording");
        if (typedRef.current && data.text) {
          typedRef.current.value = data.text;
          typedRef.current.focus();
        }
        setVoiceMsg(data.text ? null : "Didn't catch that — try again.");
      } catch (e) {
        setVoiceMsg(e instanceof Error ? e.message : "Voice input failed");
      }
      setRecording("idle");
      return;
    }
    try {
      stopSpeaking();
      recorderRef.current = await startRecording();
      setRecording("recording");
      setVoiceMsg(null);
    } catch {
      setVoiceMsg("Couldn't use the microphone — check that one is connected and allowed.");
    }
  }, [card, recording, voiceAvailable]);

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
        setAnswer({});
        setExplainOpen(false);
        setSourceOpen(false);
        setVoiceMsg(null);
        recorderRef.current?.cancel();
        recorderRef.current = null;
        setRecording("idle");
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
      if (summary || !started || !card) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const revealed = flipped || showAnswerAfterGrade;
      const choices = choicesFor(card);
      if (k === " ") {
        e.preventDefault();
        reveal();
      } else if (["1", "2", "3", "4"].includes(k)) {
        e.preventDefault();
        if (!revealed) {
          // Before flipping, number keys pick an answer option.
          const opt = choices?.[Number(k) - 1];
          if (opt) pickOption(opt);
          return;
        }
        void grade(k === "1" ? "again" : k === "2" ? "hard" : k === "3" ? "good" : "easy");
      } else if (k === "enter" && revealed && answer.suggested) {
        e.preventDefault();
        void grade(answer.suggested);
      } else if (k === "s") {
        e.preventDefault();
        void grade("skip");
      } else if (k === "f") {
        setFocusMode((f) => !f);
      } else if (k === "e" && revealed) {
        setExplainOpen((o) => !o);
      } else if (k === "r") {
        if (revealed) sayBack();
        else sayFront();
      } else if (k === "v" && !revealed && TYPED_TYPES.has(card.type)) {
        e.preventDefault();
        void toggleVoice();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, showAnswerAfterGrade, grade, started, summary, card, reveal, pickOption, answer.suggested, sayFront, sayBack, toggleVoice]);

  // Focus the answer box on typed-answer cards.
  useEffect(() => {
    if (card && TYPED_TYPES.has(card.type) && !flipped && started) {
      const t = setTimeout(() => typedRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [card, flipped, started]);

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
        <h2 className="mt-3 text-lg font-bold">{mode === "weak" ? "No weak spots yet" : "All caught up!"}</h2>
        <p className="mt-1 text-sm text-dim">
          {mode === "weak" ? "Cards you get wrong will show up here for extra practice." : "No cards are due right now."}
        </p>
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
            {mode === "weak" ? "Weak spots · " : ""}
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
          // Plain cards flip on click; interactive cards flip via their controls.
          if (!choicesFor(card) && !TYPED_TYPES.has(card.type)) reveal();
        }}
      >
        <div className={`flip-inner ${flipped || showAnswerAfterGrade ? "flipped" : ""}`}>
          <div className="flip-face card flex min-h-[26rem] cursor-pointer flex-col p-8">
            <div className="flex items-center justify-between gap-2">
              <span className="badge">{card.category}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-faint">{typeLabel(card.type)}</span>
                {canSpeak() ? (
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 text-xs text-faint hover:bg-surface2 hover:text-ink"
                    title="Read aloud (R)"
                    aria-label="Read the question aloud"
                    onClick={(e) => {
                      e.stopPropagation();
                      sayFront();
                    }}
                  >
                    🔊
                  </button>
                ) : null}
              </span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-2 py-6">
              {card.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.imageUrl} alt="" className="max-h-56 max-w-full rounded-xl border border-line object-contain" />
              ) : null}
              <p className="text-center text-xl font-medium leading-relaxed md:text-2xl">{card.front}</p>
              {choicesFor(card) ? (
                <div className={`grid w-full gap-2 ${card.type === "true-false" ? "max-w-sm grid-cols-2" : "max-w-lg"}`}>
                  {choicesFor(card)!.map((opt, i) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickOption(opt);
                      }}
                      className="flex items-start gap-3 rounded-xl border border-line px-4 py-3 text-left text-sm transition-colors hover:border-faint hover:bg-surface2"
                    >
                      <kbd className="mt-0.5 hidden shrink-0 text-[11px] text-faint md:inline">{i + 1}</kbd>
                      <span>{opt}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {TYPED_TYPES.has(card.type) ? (
                <form
                  className="flex w-full max-w-lg gap-2"
                  onClick={(e) => e.stopPropagation()}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void checkTyped(typedRef.current?.value ?? "");
                  }}
                >
                  <input
                    ref={typedRef}
                    key={card.id}
                    className="input"
                    placeholder={card.type === "fill-blank" ? "Fill in the blank…" : "Type your answer…"}
                    disabled={answer.checking || flipped}
                    maxLength={2000}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className={`btn-secondary shrink-0 px-3 ${recording === "recording" ? "ring-2 ring-accent" : ""}`}
                    title={recording === "recording" ? "Stop and transcribe (V)" : "Answer by voice (V)"}
                    aria-label="Answer by voice"
                    disabled={answer.checking || flipped || recording === "transcribing"}
                    onClick={() => void toggleVoice()}
                  >
                    {recording === "recording" ? "■" : recording === "transcribing" ? "…" : "🎤"}
                  </button>
                  <button className="btn-secondary shrink-0 px-4" disabled={answer.checking || flipped}>
                    {answer.checking ? "Checking…" : "Check"}
                  </button>
                </form>
              ) : null}
              {recording === "recording" ? <p className="text-xs text-dim">Listening… click ■ (or press V) when you&apos;re done.</p> : null}
              {voiceMsg ? <p className="max-w-md text-center text-xs text-dim">{voiceMsg}</p> : null}
            </div>
            <p className="text-center text-xs text-faint">
              {choicesFor(card)
                ? "pick an answer · or press Space to just show it"
                : TYPED_TYPES.has(card.type)
                  ? "type your answer and press Enter · or press Space to just show it"
                  : "click or press Space to flip"}
            </p>
          </div>
          <div className="flip-face flip-back card flex min-h-[26rem] flex-col overflow-y-auto p-8">
            <div className="flex items-center justify-between gap-2">
              <span className="badge">{card.difficulty}</span>
              {!focusMode ? <span className="truncate text-[11px] text-faint">{card.deckName}</span> : null}
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 py-6 text-center">
              {answer.result ? (
                <div
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    answer.result.verdict === "correct" ? "border-accent text-ink" : "border-line text-dim"
                  }`}
                >
                  {answer.result.verdict === "correct" ? "✓ Correct" : answer.result.verdict === "partial" ? "≈ Partly right" : "✗ Not quite"}
                </div>
              ) : null}
              {answer.picked && answer.result?.verdict !== "correct" ? (
                <p className="text-sm text-dim line-through decoration-faint">{answer.picked}</p>
              ) : null}
              {answer.typed ? <p className="text-sm text-dim">You wrote: “{answer.typed}”</p> : null}
              <p className="text-lg leading-relaxed md:text-xl">{card.back}</p>
              {card.figureUrl && !card.imageUrl ? (
                <figure className="mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.figureUrl} alt="Figure from the source page" className="max-h-40 max-w-full rounded-lg border border-line object-contain" />
                  <figcaption className="mt-1 text-[10px] text-faint">
                    Figure from {pageLabel(card.sourceType, card.sourcePage) ?? "the source"}
                  </figcaption>
                </figure>
              ) : null}
              {answer.result?.feedback && answer.result.verdict !== "correct" ? (
                <p className="max-w-md text-sm text-dim">{answer.result.feedback}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setExplainOpen((o) => !o)}>
                💡 Explain <kbd className="ml-1 hidden text-faint md:inline">E</kbd>
              </button>
              {canSpeak() ? (
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={sayBack} title="Read aloud (R)">
                  🔊 Read
                </button>
              ) : null}
              {card.hasSource ? (
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setSourceOpen(true)}>
                  📄 Source{pageLabel(card.sourceType, card.sourcePage) ? ` · ${pageLabel(card.sourceType, card.sourcePage)}` : ""}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {explainOpen && (flipped || showAnswerAfterGrade) ? (
        <ExplainPanel key={card.id} cardId={card.id} onClose={() => setExplainOpen(false)} />
      ) : null}
      {sourceOpen ? <SourcePanel cardId={card.id} onClose={() => setSourceOpen(false)} /> : null}

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
            className={`btn-secondary flex-col gap-0 py-2.5 text-sm ${answer.suggested === g ? "ring-2 ring-accent" : ""}`}
            title={answer.suggested === g ? "Suggested from your answer — press Enter" : undefined}
          >
            <span>
              {label} <kbd className="ml-1 hidden text-faint md:inline">{key}</kbd>
            </span>
            {card.previews?.[g] ? <span className="text-[10px] font-normal text-faint">{card.previews[g]}</span> : null}
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

function typeLabel(t: string): string {
  return (
    { definition: "definition", "fill-blank": "fill in the blank", mc: "multiple choice", "true-false": "true / false", "short-answer": "short answer" }[t] ??
    t
  );
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}
