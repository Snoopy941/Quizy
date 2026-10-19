"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, timeAgo } from "@/lib/client";
import { siteUrl } from "@/lib/site";

export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  pinned: boolean;
  shareId: string | null;
  genStatus: string;
  genProgress: number;
  genError: string | null;
  lastStudiedAt: string | null;
  totalCards: number;
  dueToday: number;
  masteryPct: number;
}

export function LibraryClient({ decks: initial }: { decks: DeckSummary[] }) {
  const router = useRouter();
  const [decks, setDecks] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const patchDeck = (id: string, patch: Partial<DeckSummary>) =>
    setDecks((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const togglePin = async (d: DeckSummary) => {
    setBusyId(d.id);
    try {
      await api(`/api/decks/${d.id}`, { method: "PATCH", body: JSON.stringify({ pinned: !d.pinned }) });
      patchDeck(d.id, { pinned: !d.pinned });
      setDecks((ds) => [...ds].sort((a, b) => Number(b.pinned) - Number(a.pinned)));
      router.refresh();
    } catch {}
    setBusyId(null);
  };

  const duplicate = async (d: DeckSummary) => {
    setBusyId(d.id);
    setMenuId(null);
    try {
      await api(`/api/decks/${d.id}/duplicate`, { method: "POST" });
      router.refresh();
    } catch {}
    setBusyId(null);
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await api(`/api/decks/${id}`, { method: "DELETE" });
      setDecks((ds) => ds.filter((d) => d.id !== id));
      setConfirmDelete(null);
      router.refresh();
    } catch {}
    setBusyId(null);
  };

  const makeShare = async (d: DeckSummary) => {
    setBusyId(d.id);
    setMenuId(null);
    try {
      const res = await api<{ shareId: string }>(`/api/decks/${d.id}/share`, { method: "POST" });
      patchDeck(d.id, { shareId: res.shareId });
      await navigator.clipboard?.writeText(`${siteUrl()}/share/${res.shareId}`).catch(() => {});
      alert("Share link copied to clipboard");
    } catch {}
    setBusyId(null);
  };

  if (!decks.length) {
    return (
      <div className="card flex flex-col items-center gap-3 p-12 text-center">
        <svg className="h-12 w-12 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
          <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-4.5" />
        </svg>
        <h2 className="text-lg font-semibold">Your library is empty</h2>
        <p className="max-w-xs text-sm text-dim">
          Upload a textbook chapter, lecture notes, or an article — Quizy turns it into flashcards.
        </p>
        <Link href="/library/new" className="btn-primary mt-2">Create your first deck</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((d) => {
        const processing = d.genStatus === "extracting" || d.genStatus === "generating";
        const failed = d.genStatus === "error";
        return (
          <div key={d.id} className="card group relative flex flex-col p-5 transition-colors hover:border-dim">
            <div className="flex items-start justify-between gap-2">
              {processing ? (
                <Link href={`/deck/${d.id}`} className="font-semibold leading-snug hover:underline">
                  {d.name}
                </Link>
              ) : (
                <Link href={`/deck/${d.id}`} className="font-semibold leading-snug hover:underline">
                  {d.name}
                </Link>
              )}
              <button
                onClick={() => setMenuId(menuId === d.id ? null : d.id)}
                className="rounded-md p-1 text-faint hover:bg-surface2 hover:text-ink"
                aria-label="Deck options"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
              </button>
            </div>
            {d.description ? <p className="mt-1 line-clamp-2 text-xs text-dim">{d.description}</p> : null}

            {processing ? (
              <div className="mt-4 space-y-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${d.genProgress}%` }} />
                </div>
                <p className="text-xs text-dim">
                  {d.genStatus === "extracting" ? "Reading file…" : `Generating cards… ${d.genProgress}%`}
                </p>
              </div>
            ) : failed ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-dim">{d.genError ?? "Generation failed"}</p>
                <button
                  onClick={async () => {
                    setBusyId(d.id);
                    try {
                      await api(`/api/decks/${d.id}/generate`, { method: "POST", body: JSON.stringify({ reprocess: false }) });
                      patchDeck(d.id, { genStatus: "extracting", genProgress: 1, genError: null });
                    } catch {}
                    setBusyId(null);
                  }}
                  className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={busyId === d.id}
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-2 text-xs text-faint">
                  <span className="tabular-nums">{d.totalCards} cards</span>
                  <span>·</span>
                  <span>{d.masteryPct}% mastered</span>
                  {d.dueToday > 0 ? (
                    <>
                      <span>·</span>
                      <span className="badge-due !px-2 !py-0 !text-[11px]">{d.dueToday} due</span>
                    </>
                  ) : null}
                </div>
                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${d.masteryPct}%` }} />
                </div>
                <p className="mt-3 text-[11px] text-faint">Last studied {timeAgo(d.lastStudiedAt)}</p>
              </>
            )}

            {menuId === d.id ? (
              <div className="absolute right-3 top-10 z-20 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
                <MenuButton onClick={() => { togglePin(d); setMenuId(null); }}>{d.pinned ? "★ Unpin" : "☆ Pin to top"}</MenuButton>
                <MenuButton onClick={() => duplicate(d)}>Duplicate</MenuButton>
                <MenuButton onClick={() => { window.location.href = `/api/decks/${d.id}/export?format=csv`; setMenuId(null); }}>Export CSV</MenuButton>
                <MenuButton onClick={() => { window.location.href = `/api/decks/${d.id}/export?format=json`; setMenuId(null); }}>Export JSON</MenuButton>
                <MenuButton onClick={() => makeShare(d)}>{d.shareId ? "Copy share link" : "Share link"}</MenuButton>
                <MenuButton danger onClick={() => { setMenuId(null); setConfirmDelete(d.id); }}>Delete deck</MenuButton>
              </div>
            ) : null}
          </div>
        );
      })}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">Delete this deck?</h3>
            <p className="mt-2 text-sm text-dim">
              “{decks.find((d) => d.id === confirmDelete)?.name}” and all its cards, schedules, and stats will be permanently removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-primary" disabled={busyId === confirmDelete} onClick={() => remove(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-4 py-2.5 text-left text-sm transition-colors ${
        danger ? "text-dim hover:bg-surface2 hover:text-ink" : "text-dim hover:bg-surface2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
