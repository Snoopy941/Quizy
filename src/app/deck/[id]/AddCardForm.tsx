"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export function AddCardForm({ deckId, onDone }: { deckId: string; onDone: (ok: boolean) => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [type, setType] = useState("definition");
  const [difficulty, setDifficulty] = useState("medium");
  const [category, setCategory] = useState("Manual");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/decks/${deckId}/cards`, {
        method: "POST",
        body: JSON.stringify({ front, back, type, difficulty, category }),
      });
      onDone(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add card");
      onDone(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h3 className="font-semibold">Add a card manually</h3>
      <div>
        <label className="label">Front (question)</label>
        <textarea className="input min-h-16" value={front} onChange={(e) => setFront(e.target.value)} required />
      </div>
      <div>
        <label className="label">Back (answer)</label>
        <textarea className="input min-h-16" value={back} onChange={(e) => setBack(e.target.value)} required />
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <select className="input max-w-40" value={type} onChange={(e) => setType(e.target.value)}>
          {["definition", "fill-blank", "mc", "true-false", "short-answer"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="input max-w-36" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          {["easy", "medium", "hard"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input className="input max-w-44" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => onDone(false)}>Cancel</button>
        <button type="submit" className="btn-primary">Add card</button>
      </div>
    </form>
  );
}
