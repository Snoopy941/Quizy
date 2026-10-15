"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { DesktopBar } from "@/components/DesktopBar";
import { api } from "@/lib/client";
import { playFlip } from "@/lib/sound";

interface SharedCard {
  id: string;
  front: string;
  back: string;
  type: string;
  options: string[] | null;
  difficulty: string;
  category: string;
}

interface SharedDeck {
  name: string;
  description: string;
  createdAt: string;
  ownerName: string;
  cards: SharedCard[];
}

export function ShareClient({ shareId }: { shareId: string }) {
  const [deck, setDeck] = useState<SharedDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "study">("list");
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    api<{ deck: SharedDeck }>(`/api/share/${shareId}`)
      .then((d) => setDeck(d.deck))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load shared deck")
      );
  }, [shareId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 chromeless-pad">
        <DesktopBar />
        <div className="card max-w-sm p-10 text-center">
          <Logo />
          <p className="mt-4 text-sm text-dim">{error}</p>
          <Link href="/" className="btn-primary mt-4">Try Quizy</Link>
        </div>
    </div>
    );
  }

  if (!deck) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 chromeless-pad">
        <DesktopBar />
        <div className="w-full max-w-sm space-y-4">
          <div className="skeleton h-8 w-48 mx-auto" />
          <div className="skeleton h-64 w-full" />
        </div>
      </div>
    );
  }

  const card = deck.cards[idx];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 chromeless-pad">
      <DesktopBar />
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <Link href="/signup" className="btn-primary px-3 py-2 text-xs">Make your own — free</Link>
      </div>

      <h1 className="text-2xl font-bold tracking-tight">{deck.name}</h1>
      <p className="mt-1 text-sm text-dim">
        Shared by {deck.ownerName} · {deck.cards.length} cards
      </p>
      {deck.description ? <p className="mt-2 text-sm text-dim">{deck.description}</p> : null}

      {deck.cards.length === 0 ? (
        <div className="card mt-8 p-10 text-center text-sm text-dim">This deck has no cards.</div>
      ) : mode === "list" ? (
        <>
          <button className="btn-primary mt-6" onClick={() => setMode("study")}>
            ▶ Browse as flashcards
          </button>
          <ul className="mt-6 space-y-2">
            {deck.cards.map((c) => (
              <li key={c.id} className="card p-4">
                <p className="text-sm font-medium">{c.front}</p>
                <p className="mt-1 text-sm text-dim">{c.back}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-faint">
                  <span className="badge">{c.type}</span>
                  <span className="badge">{c.difficulty}</span>
                  <span className="badge">{c.category}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between text-sm text-faint">
            <span>
              Card {idx + 1} of {deck.cards.length}
            </span>
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setMode("list"); setFlipped(false); }}>
              ✕ Exit
            </button>
          </div>
          <div
            className="flip-scene select-none"
            onClick={() => {
              if (!flipped) {
                setFlipped(true);
                playFlip();
              }
            }}
          >
            <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
              <div className="flip-face card flex min-h-[24rem] cursor-pointer flex-col p-8">
                <div className="flex items-center justify-between">
                  <span className="badge">{card.category}</span>
                  <span className="text-[11px] text-faint">{card.type}</span>
                </div>
                <div className="flex flex-1 items-center justify-center px-2 py-8">
                  <p className="text-center text-xl font-medium leading-relaxed md:text-2xl">{card.front}</p>
                </div>
                <p className="text-center text-xs text-faint">click to flip</p>
              </div>
              <div className="flip-face flip-back card flex min-h-[24rem] flex-col p-8">
                <div className="flex items-center justify-between">
                  <span className="badge">{card.difficulty}</span>
                  <span className="text-[11px] text-faint">{deck.name}</span>
                </div>
                <div className="flex flex-1 items-center justify-center px-2 py-8">
                  <p className="text-center text-lg leading-relaxed md:text-xl">{card.back}</p>
                </div>
                <p className="text-center text-xs text-faint">click to flip back</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-between gap-2">
            <button
              className="btn-secondary"
              disabled={idx === 0}
              onClick={() => { setIdx((i) => Math.max(0, i - 1)); setFlipped(false); }}
            >
              ← Prev
            </button>
            <button
              className="btn-primary"
              disabled={idx >= deck.cards.length - 1}
              onClick={() => { setIdx((i) => Math.min(deck.cards.length - 1, i + 1)); setFlipped(false); }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      <p className="mt-10 text-center text-xs text-faint">
        Shared via Quizy — <Link href="/" className="underline underline-offset-2">quizy.study</Link>
      </p>
    </div>
  );
}
