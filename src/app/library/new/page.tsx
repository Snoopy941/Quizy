"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DENSITIES = [
  { id: "low", label: "Low", hint: "~3 cards / section" },
  { id: "medium", label: "Medium", hint: "~4 cards / section" },
  { id: "high", label: "High", hint: "~5 cards / section" },
];

export default function NewDeckPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [density, setDensity] = useState("medium");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError("That PDF is larger than 50MB.");
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.pdf$/i, "").slice(0, 100));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Choose a PDF first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setProgress("Uploading PDF…");
      const form = new FormData();
      form.append("file", file);
      form.append("name", name);
      form.append("instructions", instructions);
      form.append("density", density);

      const res = await fetch("/api/decks", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      const deckId = data.deck?.id;
      if (!deckId) throw new Error("Upload failed");

      // Hand off to the deck page, which polls generation progress live.
      router.push(`/deck/${deckId}?generating=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">New deck</h1>
      <p className="mt-1 text-sm text-dim">Upload a PDF — Quizy extracts the text and writes your flashcards.</p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
            dragOver ? "border-dim bg-surface2" : "border-line hover:border-faint"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <svg className="h-10 w-10 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          {file ? (
            <>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-faint">{(file.size / 1024 / 1024).toFixed(1)} MB — tap to change</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Drag & drop your PDF here</p>
              <p className="text-xs text-faint">or click to browse · up to 50MB</p>
            </>
          )}
        </div>

        <div>
          <label className="label" htmlFor="deck-name">Deck name</label>
          <input id="deck-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Biology — Chapter 4" maxLength={120} />
        </div>

        <div>
          <label className="label">Card density</label>
          <div className="grid grid-cols-3 gap-2">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDensity(d.id)}
                className={`rounded-xl border px-3 py-3 text-center transition-colors ${
                  density === d.id ? "border-accent bg-surface2" : "border-line hover:border-faint"
                }`}
              >
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="mt-0.5 text-[11px] text-faint">{d.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="deck-instructions">
            Instructions for the AI <span className="text-faint">(optional)</span>
          </label>
          <textarea
            id="deck-instructions"
            className="input min-h-20 resize-y"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Focus on formulas · Make the cards harder · Add analogies"
            maxLength={500}
          />
        </div>

        {error ? <div className="rounded-lg border border-line bg-surface2 px-3.5 py-2.5 text-sm text-ink">{error}</div> : null}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? progress || "Working…" : "Upload & generate cards"}
        </button>
        <p className="text-center text-xs text-faint">
          Generation runs in the background — you can watch progress on the next page.
        </p>
      </form>
    </div>
  );
}
