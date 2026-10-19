"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD_LANGUAGES, OCR_LANGUAGE_NAMES } from "@/lib/client";

const DENSITIES = [
  { id: "low", label: "Low", hint: "~3 cards / section" },
  { id: "medium", label: "Medium", hint: "~4 cards / section" },
  { id: "high", label: "High", hint: "~5 cards / section" },
];

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.bmp,.apkg,.colpkg";
const EXT_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "Word document",
  pptx: "PowerPoint",
  txt: "text file",
  md: "Markdown notes",
  markdown: "Markdown notes",
  png: "image (read with OCR)",
  jpg: "image (read with OCR)",
  jpeg: "image (read with OCR)",
  webp: "image (read with OCR)",
  bmp: "image (read with OCR)",
  apkg: "Anki deck (imported as-is)",
  colpkg: "Anki collection (imported as-is)",
};

const extOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export default function NewDeckPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [density, setDensity] = useState("medium");
  const [cardLanguage, setCardLanguage] = useState("auto");
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAi, setNeedsAi] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const isAnki = file ? ["apkg", "colpkg"].includes(extOf(file.name)) : false;

  const pickFile = (f: File | null) => {
    setError(null);
    setNeedsAi(false);
    if (!f) return;
    if (!EXT_LABEL[extOf(f.name)]) {
      setError("Unsupported file. Use a PDF, Word or PowerPoint file, text/Markdown, a photo of notes, or an Anki deck.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError("That file is larger than 50MB.");
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").slice(0, 100));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "file" && !file) {
      setError("Choose a file first.");
      return;
    }
    if (mode === "text" && text.trim().length < 40) {
      setError("Paste a bit more text — at least a paragraph.");
      return;
    }
    setBusy(true);
    setError(null);
    setNeedsAi(false);
    try {
      setProgress(mode === "file" ? (isAnki ? "Importing deck…" : "Uploading…") : "Saving notes…");
      const form = new FormData();
      if (mode === "file" && file) form.append("file", file);
      else form.append("text", text);
      form.append("name", name);
      form.append("instructions", instructions);
      form.append("density", density);
      form.append("cardLanguage", cardLanguage);
      form.append("ocrLanguage", ocrLanguage);

      const res = await fetch("/api/decks", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") setNeedsAi(true);
        throw new Error(data.error || "Upload failed");
      }
      const deckId = data.deck?.id;
      if (!deckId) throw new Error("Upload failed");

      // Anki imports are ready immediately; everything else generates in the background.
      router.push(isAnki && mode === "file" ? `/deck/${deckId}` : `/deck/${deckId}?generating=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">New deck</h1>
      <p className="mt-1 text-sm text-dim">
        Add a PDF, Word or PowerPoint file, a photo of your notes, or paste text — Quizy writes the flashcards. Already
        use Anki? Import your .apkg deck.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line p-1">
        {(["file", "text"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === m ? "bg-surface2 text-ink" : "text-dim hover:text-ink"}`}
          >
            {m === "file" ? "Upload a file" : "Paste text"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-5">
        {mode === "file" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
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
              accept={ACCEPT}
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
                <p className="text-xs text-faint">
                  {EXT_LABEL[extOf(file.name)]} · {(file.size / 1024 / 1024).toFixed(1)} MB — tap to change
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Drag & drop a file here</p>
                <p className="text-xs text-faint">PDF · Word · PowerPoint · text · image · Anki (.apkg) — up to 50MB</p>
              </>
            )}
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="deck-text">Your notes</label>
            <textarea
              id="deck-text"
              className="input min-h-56 resize-y font-mono text-[13px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Paste lecture notes, an article, or a study guide…\n\nTip: lines starting with # become section headings."}
            />
            <p className="mt-1 text-[11px] text-faint">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ""}</p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="deck-name">Deck name</label>
          <input id="deck-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Biology — Chapter 4" maxLength={120} />
        </div>

        {!isAnki ? (
          <>
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="card-language">Write cards in</label>
                <select id="card-language" className="input" value={cardLanguage} onChange={(e) => setCardLanguage(e.target.value)}>
                  {Object.entries(CARD_LANGUAGES).map(([code, n]) => (
                    <option key={code} value={code}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ocr-language">Scans &amp; photos are in</label>
                <select id="ocr-language" className="input" value={ocrLanguage} onChange={(e) => setOcrLanguage(e.target.value)}>
                  {Object.entries(OCR_LANGUAGE_NAMES).map(([code, n]) => (
                    <option key={code} value={code}>{n}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-faint">Only used to read scanned pages and images.</p>
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
          </>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-line bg-surface2 px-3.5 py-2.5 text-sm text-ink">
            {error}
            {needsAi ? (
              <Link href="/settings" className="ml-2 underline underline-offset-2">
                Open Settings →
              </Link>
            ) : null}
          </div>
        ) : null}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? progress || "Working…" : isAnki ? "Import Anki deck" : "Create & generate cards"}
        </button>
        <p className="text-center text-xs text-faint">
          {isAnki
            ? "Cards are imported as new cards (Anki review history isn't carried over)."
            : "Generation runs in the background — you can watch progress on the next page."}
        </p>
      </form>
    </div>
  );
}
