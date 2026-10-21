"use client";

import { useMemo, useState } from "react";
import { api, pageLabel } from "@/lib/client";
import { SourcePanel } from "@/components/SourcePanel";
import type { CardRow, ChunkRow, DeckData } from "./types";
import { Icon } from "@/components/Icon";

interface EditState {
  front: string;
  back: string;
  type: string;
  difficulty: string;
  category: string;
}

export function CardList({
  cards,
  chunks: _chunks,
  onSaved,
  deckId,
  sourceType,
}: {
  cards: CardRow[];
  chunks: ChunkRow[];
  onSaved: () => Promise<DeckData | null>;
  deckId: string;
  sourceType: string;
}) {
  const [sourceCard, setSourceCard] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState<string | null>(null);
  const [regenInstructions, setRegenInstructions] = useState("");
  const [grouped, setGrouped] = useState(true);

  const groups = useMemo(() => {
    if (!grouped) return [{ key: "flat", heading: "", cards }];
    const map = new Map<string, { key: string; heading: string; cards: CardRow[] }>();
    for (const c of cards) {
      const key = c.chunkId ?? `manual:${c.category}`;
      const heading = c.category || "General";
      const entry = map.get(key) ?? { key, heading, cards: [] };
      entry.cards.push(c);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [cards, grouped]);

  const startEdit = (c: CardRow) => {
    setEditingId(c.id);
    setEditDraft({ front: c.front, back: c.back, type: c.type, difficulty: c.difficulty, category: c.category });
  };

  const saveEdit = async () => {
    if (!editDraft || !editingId) return;
    setBusyId(editingId);
    try {
      await api(`/api/cards/${editingId}`, { method: "PATCH", body: JSON.stringify(editDraft) });
      setEditingId(null);
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    }
    setBusyId(null);
  };

  const del = async (id: string) => {
    if (!confirm("Delete this card?")) return;
    setBusyId(id);
    try {
      await api(`/api/cards/${id}`, { method: "DELETE" });
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
    setBusyId(null);
  };

  const regenerateCard = async (cardId: string) => {
    setBusyId(cardId);
    setRegenOpen(null);
    try {
      await api(`/api/decks/${deckId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ cardId, instructions: regenInstructions || undefined }),
      });
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Regeneration failed");
    }
    setBusyId(null);
    setRegenInstructions("");
  };

  const uploadImage = async (cardId: string, file: File | null) => {
    if (!file) return;
    setBusyId(cardId);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/cards/${cardId}/image`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    }
    setBusyId(null);
  };

  const removeImage = async (cardId: string) => {
    setBusyId(cardId);
    try {
      await api(`/api/cards/${cardId}/image`, { method: "DELETE" });
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't remove the image");
    }
    setBusyId(null);
  };

  const moreLikeThis = async (cardId: string) => {
    setBusyId(cardId);
    try {
      const r = await api<{ added: number }>(`/api/cards/${cardId}/more`, { method: "POST" });
      await onSaved();
      alert(`Added ${r.added} new card${r.added === 1 ? "" : "s"} on this topic.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't make more cards");
    }
    setBusyId(null);
  };

  const regenerateSection = async (chunkId: string) => {
    setBusyId(chunkId);
    try {
      await api(`/api/decks/${deckId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ chunkId }),
      });
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Regeneration failed");
    }
    setBusyId(null);
  };

  const move = async (cardId: string, dir: -1 | 1) => {
    const idx = cards.findIndex((c) => c.id === cardId);
    const swapWith = idx + dir;
    if (idx === -1 || swapWith < 0 || swapWith >= cards.length) return;
    const next = [...cards];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    setBusyId(cardId);
    try {
      await api(`/api/decks/${deckId}/cards`, {
        method: "PUT",
        body: JSON.stringify({ order: next.map((c) => c.id) }),
      });
      await onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reorder");
    }
    setBusyId(null);
  };

  if (!cards.length) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-dim">No cards yet.</p>
        <p className="mt-1 text-xs text-faint">Generate from the source file or add cards manually.</p>
      </div>
    );
  }

  return (
    <section className="stagger space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          Cards <span className="text-sm font-normal text-faint">({cards.length})</span>
        </h2>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setGrouped(!grouped)}>
          {grouped ? "Flat list" : "Group by section"}
        </button>
      </div>

      {sourceCard ? <SourcePanel cardId={sourceCard} onClose={() => setSourceCard(null)} /> : null}

      {groups.map((group) => {
        const chunkId = group.cards.find((c) => c.chunkId)?.chunkId ?? null;
        return (
          <div key={group.key} className="card overflow-hidden">
            {grouped ? (
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-dim">{group.heading || "General"}</span>
                {chunkId ? (
                  <button
                    className="text-[11px] text-faint underline underline-offset-2 hover:text-dim"
                    disabled={busyId === chunkId}
                    onClick={() => void regenerateSection(chunkId)}
                  >
                    {busyId === chunkId ? "working…" : "Regenerate section"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <ul className="divide-y divide-line">
              {group.cards.map((c) => {
                const flatIdx = cards.findIndex((x) => x.id === c.id);
                return (
                  <li key={c.id} className="p-4">
                    {editingId === c.id ? (
                      <div className="space-y-3">
                        <div>
                          <label className="label">Front</label>
                          <textarea className="input min-h-16" value={editDraft?.front ?? ""} onChange={(e) => setEditDraft(editDraft ? { ...editDraft, front: e.target.value } : editDraft)} />
                        </div>
                        <div>
                          <label className="label">Back</label>
                          <textarea className="input min-h-16" value={editDraft?.back ?? ""} onChange={(e) => setEditDraft(editDraft ? { ...editDraft, back: e.target.value } : editDraft)} />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <select className="input max-w-40" value={editDraft?.type} onChange={(e) => setEditDraft(editDraft ? { ...editDraft, type: e.target.value } : editDraft)}>
                            {["definition", "fill-blank", "mc", "true-false", "short-answer"].map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <select className="input max-w-36" value={editDraft?.difficulty} onChange={(e) => setEditDraft(editDraft ? { ...editDraft, difficulty: e.target.value } : editDraft)}>
                            {["easy", "medium", "hard"].map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                          <input className="input max-w-44" value={editDraft?.category} onChange={(e) => setEditDraft(editDraft ? { ...editDraft, category: e.target.value } : editDraft)} placeholder="Category" />
                          <label className="btn-ghost cursor-pointer px-3 py-1.5" title="Show an image with the question">
                            <Icon name="image" /> {c.imageUrl ? "Change image" : "Add image"}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/bmp"
                              className="hidden"
                              onChange={(e) => void uploadImage(c.id, e.target.files?.[0] ?? null)}
                            />
                          </label>
                          {c.imageUrl ? (
                            <button className="btn-ghost px-3 py-1.5" onClick={() => void removeImage(c.id)}>
                              Remove image
                            </button>
                          ) : null}
                          <div className="ml-auto flex gap-2">
                            <button className="btn-ghost px-3 py-1.5" onClick={() => setEditingId(null)}>Cancel</button>
                            <button className="btn-primary px-3 py-1.5" disabled={busyId === c.id} onClick={() => void saveEdit()}>Save</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover" />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{c.front}</p>
                          <p className="mt-1 text-sm text-dim">{c.back}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                            <span className="badge">{c.type}</span>
                            <span className="badge">{c.difficulty}</span>
                            <span className="badge">{c.category}</span>
                            {c.chunkId ? (
                              <button
                                className="badge hover:text-ink"
                                title="Show the passage this card came from"
                                onClick={() => setSourceCard(c.id)}
                              >
                                <Icon name="file" /> {pageLabel(sourceType, c.sourcePage) ?? "source"}
                              </button>
                            ) : null}
                            {c.intervalDays > 21 ? <span className="badge">mastered</span> : null}
                            <span>seen {c.timesSeen} · failed {c.timesFailed}</span>
                            <span>due {new Date(c.dueDate).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <IconBtn title="Move up" onClick={() => void move(c.id, -1)} disabled={busyId === c.id || flatIdx === 0}><Icon name="arrowUp" /></IconBtn>
                          <IconBtn title="Move down" onClick={() => void move(c.id, 1)} disabled={busyId === c.id || flatIdx === cards.length - 1}><Icon name="arrowDown" /></IconBtn>
                          <IconBtn title="Edit card" onClick={() => startEdit(c)}><Icon name="pencil" /></IconBtn>
                          <IconBtn title="Regenerate with AI" onClick={() => { setRegenOpen(regenOpen === c.id ? null : c.id); setRegenInstructions(""); }}><Icon name="repeat" /></IconBtn>
                          <IconBtn title="More cards like this (AI)" onClick={() => void moreLikeThis(c.id)} disabled={busyId === c.id}><Icon name="plus" /></IconBtn>
                          <IconBtn title="Delete card" onClick={() => void del(c.id)}><Icon name="trash" /></IconBtn>
                        </div>
                      </div>
                    )}
                    {regenOpen === c.id ? (
                      <div className="mt-3 rounded-xl border border-line bg-surface2/40 p-3">
                        <label className="label !mb-1 !text-xs">Optional instruction for this card</label>
                        <div className="flex gap-2">
                          <input
                            className="input"
                            placeholder="e.g. Make harder · Add analogy"
                            value={regenInstructions}
                            onChange={(e) => setRegenInstructions(e.target.value)}
                          />
                          <button className="btn-secondary shrink-0 px-3 py-1.5 text-xs" disabled={busyId === c.id} onClick={() => void regenerateCard(c.id)}>
                            Regenerate
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-faint">Keeps this card's scheduling history.</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-[13px] text-dim transition-all duration-200 hover:-translate-y-0.5 hover:border-dim/60 hover:bg-surface2 hover:text-ink active:scale-90 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
