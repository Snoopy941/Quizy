"use client";

import { useEffect, useState } from "react";
import { api, pageLabel, sourceKindLabel } from "@/lib/client";
import { findQuoteRange } from "@/lib/chunk";

interface SourceData {
  page: number | null;
  quote: string | null;
  sourceType: string;
  deckName: string;
  fileUrl: string | null;
  section: { heading: string; text: string; pageStart: number | null; pageEnd: number | null } | null;
}

/** Modal showing the passage a card was written from, with the supporting quote highlighted. */
export function SourcePanel({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [data, setData] = useState<SourceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SourceData>(`/api/cards/${cardId}/source`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the source"));
  }, [cardId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = data ? pageLabel(data.sourceType, data.page) : null;
  const range = data?.section && data.quote ? findQuoteRange(data.quote, data.section.text) : null;
  const text = data?.section?.text ?? "";
  const openHref =
    data?.fileUrl && data.sourceType === "pdf" && data.page ? `${data.fileUrl}#page=${data.page}` : data?.fileUrl ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold">Source{label ? ` · ${label}` : ""}</h3>
            {data?.section?.heading ? <p className="mt-0.5 text-xs text-dim">{data.section.heading}</p> : null}
          </div>
          <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error ? <p className="mt-4 text-sm text-dim">{error}</p> : null}
        {!data && !error ? <div className="skeleton mt-4 h-40 w-full" /> : null}

        {data && !data.section ? (
          <p className="mt-4 text-sm text-dim">
            This card wasn&apos;t generated from a document section (it was added manually or imported), so there&apos;s no source passage.
          </p>
        ) : null}

        {data?.section ? (
          <div className="mt-4 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-surface2/40 p-4 text-sm leading-relaxed text-dim">
            {range ? (
              <>
                {text.slice(0, range[0])}
                <mark className="rounded bg-accent/20 px-0.5 text-ink">{text.slice(range[0], range[1])}</mark>
                {text.slice(range[1])}
              </>
            ) : (
              text
            )}
          </div>
        ) : null}

        {data?.quote && !range ? (
          <p className="mt-3 text-xs text-dim">
            Supporting quote: <span className="text-ink">“{data.quote}”</span>
          </p>
        ) : null}

        {openHref ? (
          <div className="mt-4 flex justify-end">
            <a href={openHref} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-1.5 text-xs">
              Open {sourceKindLabel(data?.sourceType)}
              {data?.sourceType === "pdf" && label ? ` at ${label}` : ""} ↗
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
