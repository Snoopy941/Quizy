"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, CARD_LANGUAGES, sourceKindLabel, timeAgo } from "@/lib/client";
import { siteUrl } from "@/lib/site";
import type { DeckData, CardRow, ChunkRow } from "./types";
import { CardList } from "./CardList";
import { AddCardForm } from "./AddCardForm";
import { Icon } from "@/components/Icon";

export function DeckDetail({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [data, setData] = useState<DeckData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [languageDraft, setLanguageDraft] = useState("auto");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [addedCard, setAddedCard] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<DeckData>(`/api/decks/${deckId}`);
      setData(d);
      setError(null);
      return d;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load deck";
      if (msg.includes("not found")) setNotFound(true);
      else setError(msg);
      return null;
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while generating
  useEffect(() => {
    const st = data?.deck.genStatus;
    if (st !== "extracting" && st !== "generating") return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [data?.deck.genStatus, load]);

  const deck = data?.deck;
  const cards = data?.cards ?? [];
  const chunks = data?.chunks ?? [];
  const stats = data?.stats;
  const processing = deck?.genStatus === "extracting" || deck?.genStatus === "generating";

  useEffect(() => {
    if (deck) {
      setNameDraft(deck.name);
      setInstructionsDraft(deck.instructions);
      setLanguageDraft(deck.cardLanguage || "auto");
    }
  }, [deck]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <div className="card p-10 text-center">
        <h1 className="font-bold">Deck not found</h1>
        <p className="mt-2 text-sm text-dim">It may have been deleted.</p>
        <Link href="/library" className="btn-primary mt-4">Back to library</Link>
      </div>
    );
  }

  if (error) {
    return <div className="card p-10 text-center text-sm text-dim">{error}</div>;
  }

  if (!data || !deck || !stats) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-9 w-64" />
        <div className="skeleton h-20 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  const saveMeta = async (patch: Record<string, unknown>) => {
    await api(`/api/decks/${deckId}`, { method: "PATCH", body: JSON.stringify(patch) });
    await load();
    router.refresh();
  };

  const startRegenerateDeck = async () => {
    if (!confirm(`Re-run AI generation on the ${sourceKindLabel(deck.sourceType)}? Existing cards and scheduling state will be replaced.`)) return;
    setMenuOpen(false);
    try {
      await api(`/api/decks/${deckId}/generate`, { method: "POST", body: JSON.stringify({ reprocess: true }) });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  const deleteDeck = async () => {
    await api(`/api/decks/${deckId}`, { method: "DELETE" });
    router.push("/library");
  };

  const startShare = async () => {
    setMenuOpen(false);
    try {
      let sid = deck.shareId;
      if (!sid) {
        const res = await api<{ shareId: string }>(`/api/decks/${deckId}/share`, { method: "POST" });
        sid = res.shareId;
        setData((prev) => (prev ? { ...prev, deck: { ...prev.deck, shareId: sid! } } : prev));
      }
      await navigator.clipboard?.writeText(`${siteUrl()}/share/${sid}`).catch(() => {});
      alert("Share link copied to clipboard");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to share");
    }
  };

  const duplicate = async () => {
    setMenuOpen(false);
    try {
      const res = await api<{ deck: { id: string } }>(`/api/decks/${deckId}/duplicate`, { method: "POST" });
      router.push(`/deck/${res.deck.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to duplicate");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {renaming ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await saveMeta({ name: nameDraft });
                  setRenaming(false);
                }}
                className="flex items-center gap-2"
              >
                <input className="input max-w-md" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus maxLength={120} />
                <button className="btn-primary px-3 py-2" type="submit">Save</button>
                <button className="btn-ghost px-3 py-2" type="button" onClick={() => setRenaming(false)}>Cancel</button>
              </form>
            ) : (
              <h1
                className="group cursor-text text-3xl font-semibold tracking-tight"
                title="Click to rename"
                onClick={() => setRenaming(true)}
              >
                {deck.name}
                <span className="ml-2 inline-block align-middle text-faint opacity-60 transition-opacity group-hover:opacity-100"><Icon name="pencil" className="h-4 w-4" /></span>
              </h1>
            )}
            <p className="mt-1 text-sm text-dim">
              {stats.total} cards · {stats.masteryPct}% mastered
              {deck.lastStudiedAt ? ` · last studied ${timeAgo(deck.lastStudiedAt)}` : ""}
            </p>
            {deck.pdfUrl ? (
              <a href={deck.pdfUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-faint underline underline-offset-2 hover:text-dim">
                View source {sourceKindLabel(deck.sourceType)} <Icon name="external" className="h-3 w-3" />
              </a>
            ) : deck.sourceType === "anki" ? (
              <span className="mt-1 inline-block text-xs text-faint">Imported from Anki</span>
            ) : null}
          </div>
          <div className="relative shrink-0">
            <button className="btn-secondary px-3" aria-label="Deck options" onClick={() => setMenuOpen(!menuOpen)}><Icon name="more" className="h-5 w-5" /></button>
            {menuOpen ? (
              <div className="absolute right-0 top-12 z-30 w-48 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
                <MenuBtn onClick={() => { setMenuOpen(false); setInstructionsOpen(true); }}>AI instructions</MenuBtn>
                <MenuBtn onClick={() => { setMenuOpen(false); setRenaming(true); }}>Rename</MenuBtn>
                <MenuBtn onClick={duplicate}>Duplicate</MenuBtn>
                <MenuBtn onClick={startShare}>{deck.shareId ? "Copy share link" : "Share link"}</MenuBtn>
                <MenuBtn onClick={() => { window.location.href = `/api/decks/${deckId}/export?format=csv`; setMenuOpen(false); }}>Export CSV</MenuBtn>
                <MenuBtn onClick={() => { window.location.href = `/api/decks/${deckId}/export?format=json`; setMenuOpen(false); }}>Export JSON</MenuBtn>
                <MenuBtn onClick={() => { window.location.href = `/api/decks/${deckId}/export?format=apkg`; setMenuOpen(false); }}>Export to Anki (.apkg)</MenuBtn>
                {deck.pdfUrl ? <MenuBtn onClick={startRegenerateDeck}>Re-generate from source</MenuBtn> : null}
                <MenuBtn danger onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>Delete deck</MenuBtn>
              </div>
            ) : null}
          </div>
        </div>

        {processing ? (
          <div className="card mt-4 p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">
                {deck.genStatus === "extracting"
                  ? deck.sourceType === "image" || deck.genProgress > 3
                    ? `Reading ${sourceKindLabel(deck.sourceType)} (OCR)…`
                    : `Reading ${sourceKindLabel(deck.sourceType)}…`
                  : deck.aiSource === "builtin"
                    ? "Generating cards with Quizy AI…"
                    : "Generating cards…"}
              </span>
              <span className="tabular-nums text-dim">{deck.genProgress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.max(3, deck.genProgress)}%` }} />
            </div>
            {deck.aiSource === "builtin" && deck.genStatus === "generating" ? (
              <p className="mt-2 text-[11px] text-faint">
                Cards appear below as they&apos;re written. You can leave this page.
              </p>
            ) : null}
          </div>
        ) : deck.genStatus === "error" ? (
          <div className="card mt-4 p-5">
            <p className="text-sm font-medium">Generation hit a problem</p>
            <p className="mt-1 text-sm text-dim">{deck.genError}</p>
            {deck.genError?.includes("Settings") ? (
              <Link href="/settings" className="mt-1 inline-block text-xs underline underline-offset-2">
                Open Settings → AI
              </Link>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={async () => {
                try {
                  await api(`/api/decks/${deckId}/generate`, { method: "POST", body: JSON.stringify({ reprocess: false }) });
                  await load();
                } catch (err) { alert(err instanceof Error ? err.message : "Failed"); }
              }}>Retry generation</button>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setAddedCard(true)}>Add cards manually</button>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setInstructionsOpen(true)}>Adjust AI instructions</button>
            </div>
          </div>
        ) : null}

        {deck.aiSource === "demo" && !processing ? (
          <p className="mt-3 text-xs text-faint">
            These cards were made by the offline demo generator (MOCK_AI=1), not a real AI. Set up AI in Settings, then
            use the <Icon name="more" className="inline h-3.5 w-3.5" /> menu, then Re-generate for proper cards.
          </p>
        ) : null}

        {deck.genStatus === "done" && deck.genError ? (
          <p className="mt-3 text-xs text-dim">{deck.genError}</p>
        ) : null}

        {!processing && cards.length > 0 ? (
          <div className="stagger mt-5 flex flex-wrap gap-2">
            <Link href={`/deck/${deckId}/study`} className="btn-primary"><Icon name="play" className="h-3.5 w-3.5" /> Study now</Link>
            <TimedStudyButton deckId={deckId} />
            <Link href={`/deck/${deckId}/study?mode=weak`} className="btn-secondary" title="Cards you miss most"><Icon name="target" className="h-4 w-4" /> Weak spots</Link>
            <Link href={`/deck/${deckId}/stats`} className="btn-secondary"><Icon name="chart" className="h-4 w-4" /> Stats</Link>
            <button className="btn-secondary" onClick={() => setAddedCard(true)}><Icon name="plus" className="h-4 w-4" /> Add card</button>
          </div>
        ) : null}

        {!processing && (cards.length > 0 || chunks.length > 0) ? (
          <div className="stagger mt-2 flex flex-wrap gap-1">
            <Link href={`/deck/${deckId}/chat`} className="btn-ghost icon-nudge px-3 py-1.5 text-xs"><Icon name="chat" className="h-3.5 w-3.5" /> Ask the document</Link>
            {chunks.length ? <Link href={`/deck/${deckId}/summary`} className="btn-ghost icon-nudge px-3 py-1.5 text-xs"><Icon name="notes" className="h-3.5 w-3.5" /> Cheat sheet</Link> : null}
            {cards.length ? <Link href={`/deck/${deckId}/quality`} className="btn-ghost icon-nudge px-3 py-1.5 text-xs"><Icon name="shieldCheck" className="h-3.5 w-3.5" /> Check card quality</Link> : null}
          </div>
        ) : null}
      </div>

      {addedCard ? (
        <AddCardForm
          deckId={deckId}
          onDone={async (ok) => {
            setAddedCard(false);
            if (ok) await load();
          }}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Due today" value={stats.dueToday} />
        <StatTile label="New" value={stats.new} />
        <StatTile label="Mastered" value={stats.mastered} />
        <StatTile label="Learning" value={stats.learning} />
      </div>

      <CardList cards={cards} chunks={chunks} onSaved={load} deckId={deckId} sourceType={deck.sourceType} />

      {instructionsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setInstructionsOpen(false)}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">Instructions for the AI</h3>
            <p className="mt-1 text-xs text-dim">
              Applied when generating and regenerating — e.g. “Focus on formulas”, “Make harder”, “Add analogies”.
            </p>
            <textarea
              className="input mt-4 min-h-24 resize-y"
              value={instructionsDraft}
              onChange={(e) => setInstructionsDraft(e.target.value)}
              maxLength={500}
            />
            <label className="label mt-4 !text-xs" htmlFor="card-lang">Card language</label>
            <select id="card-lang" className="input" value={languageDraft} onChange={(e) => setLanguageDraft(e.target.value)}>
              {Object.entries(CARD_LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-faint">Applies to new and regenerated cards, explanations and chat.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setInstructionsOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={async () => {
                await saveMeta({ instructions: instructionsDraft, cardLanguage: languageDraft });
                setInstructionsOpen(false);
              }}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirmDelete(false)}>
          <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">Delete “{deck.name}”?</h3>
            <p className="mt-2 text-sm text-dim">Cards, schedules, and stats will be permanently removed.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn-primary" onClick={deleteDeck}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimedStudyButton({ deckId }: { deckId: string }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const router = useRouter();
  return (
    <div className="relative">
      <button className="btn-secondary" onClick={() => setOpen(!open)}><Icon name="timer" className="h-4 w-4" /> Timed</button>
      {open ? (
        <div className="anim-pop absolute left-0 top-12 z-30 w-52 origin-top-left rounded-xl border border-line bg-surface p-3 shadow-xl">
          <p className="mb-2 text-xs font-medium text-dim">Session length</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[5, 10, 15, 30, 60].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold tabular-nums ${
                  minutes === m ? "border-accent bg-surface2" : "border-line text-dim hover:text-ink"
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
          <button className="btn-primary mt-3 w-full py-2 text-xs" onClick={() => router.push(`/deck/${deckId}/study?timed=${minutes}`)}>
            Start {minutes}-minute session
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-dim">{label}</div>
    </div>
  );
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-4 py-2.5 text-left text-sm text-dim transition-colors hover:bg-surface2 hover:text-ink"
    >
      {children}
    </button>
  );
}

export type { CardRow, ChunkRow };
