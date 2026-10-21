"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, pageLabel } from "@/lib/client";
import { Icon } from "@/components/Icon";

interface Section {
  id: string;
  heading: string;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string | null;
}

/** Cheat sheet: a short AI summary of every section, printable. */
export default function DeckSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [deck, setDeck] = useState<{ name: string; sourceType: string } | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const load = useCallback(async () => {
    const r = await api<{ deck: { name: string; sourceType: string }; sections: Section[] }>(`/api/decks/${id}/summary`);
    setDeck(r.deck);
    setSections(r.sections);
    return r.sections;
  }, [id]);

  const write = async (s: Section, force = false) => {
    setWorking(s.id);
    try {
      const r = await api<{ summary: string }>(`/api/decks/${id}/summary`, {
        method: "POST",
        body: JSON.stringify({ chunkId: s.id, force }),
      });
      setSections((list) => list.map((x) => (x.id === s.id ? { ...x, summary: r.summary } : x)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't summarize");
      return false;
    } finally {
      setWorking(null);
    }
  };

  const writeAll = async (list: Section[]) => {
    stop.current = false;
    setError(null);
    for (const s of list) {
      if (stop.current) break;
      if (s.summary) continue;
      if (!(await write(s))) break;
    }
  };

  useEffect(() => {
    void load()
      .then((list) => void writeAll(list))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load"));
    return () => {
      stop.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const done = sections.filter((s) => s.summary).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3 print:hidden">
        <div>
          <Link href={`/deck/${id}`} className="text-xs text-faint hover:text-dim">
            <Icon name="arrowLeft" /> {deck?.name || "Deck"}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Cheat sheet</h1>
          <p className="mt-1 text-sm text-dim">
            {sections.length ? `${done} of ${sections.length} sections summarized` : "This deck has no document sections to summarize."}
            {working ? " · writing…" : ""}
          </p>
        </div>
        <button className="btn-secondary shrink-0" onClick={() => window.print()} disabled={!done}>
          Print / save PDF
        </button>
      </div>
      <h1 className="mb-4 hidden text-xl font-bold print:block">{deck?.name} — cheat sheet</h1>
      {error ? <p className="mb-4 text-sm text-dim print:hidden">{error}</p> : null}
      <div className="space-y-3">
        {sections.map((s) => (
          <section key={s.id} className="card break-inside-avoid p-5 print:border-0 print:p-0 print:pb-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">{s.heading || "Section"}</h2>
              <span className="shrink-0 text-[11px] text-faint">
                {pageLabel(deck?.sourceType, s.pageStart)}
                {s.pageEnd && s.pageEnd !== s.pageStart ? `–${s.pageEnd}` : ""}
              </span>
            </div>
            {s.summary ? (
              <div className="mt-2 space-y-1 text-sm leading-relaxed text-dim print:text-black">
                {s.summary.split("\n").map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            ) : working === s.id ? (
              <div className="skeleton mt-3 h-16 w-full" />
            ) : (
              <button className="btn-ghost mt-2 px-2 py-1 text-xs print:hidden" onClick={() => void write(s)}>
                Summarize
              </button>
            )}
            {s.summary ? (
              <button className="mt-2 text-[11px] text-faint underline underline-offset-2 print:hidden" onClick={() => void write(s, true)} disabled={!!working}>
                Rewrite
              </button>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
