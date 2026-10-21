"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Dl {
  status: "downloading" | "done" | "error";
  received: number;
  total: number;
  error: string | null;
}
interface DownloadsData {
  ocr: { code: string; name: string; installed: boolean; download: Dl | null }[];
}

const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

function Progress({ d }: { d: Dl }) {
  if (d.status === "error") return <p className="mt-1 text-xs text-dim">Download failed: {d.error} — try again to resume.</p>;
  const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-faint">
        {gb(d.received)} of {gb(d.total)} · {pct}%
      </p>
    </div>
  );
}

/** OCR languages for scanned documents — optional downloads. */
export function DownloadsSettings() {
  const [data, setData] = useState<DownloadsData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocrPick, setOcrPick] = useState("spa");

  const load = useCallback(async () => {
    try {
      setData(await api<DownloadsData>("/api/downloads"));
    } catch {}
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const busy =
    data &&
    data.ocr.map((o) => o.download).some((d) => d?.status === "downloading");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [busy, load]);

  const act = async (action: string, id: string) => {
    setMsg(null);
    try {
      await api("/api/downloads", { method: "POST", body: JSON.stringify({ action, id }) });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!data) return null;
  const pickable = data.ocr.filter((o) => !o.installed);

  return (
    <section className="card p-6">
      <h2 className="font-semibold">Downloads</h2>
      <p className="mt-1 text-xs text-dim">Extra languages for reading scanned PDFs and photos. They&apos;re kept when Quizy updates.</p>

      <div className="mt-4">
        <p className="text-sm font-medium">OCR languages</p>
        <p className="mt-0.5 text-xs text-dim">
          For scanned PDFs and photos. Installed: {data.ocr.filter((o) => o.installed).map((o) => o.name).join(", ")}. Languages
          are also downloaded automatically when a deck needs them.
        </p>
        {pickable.length ? (
          <div className="mt-2 flex gap-2">
            <select className="input max-w-56" value={ocrPick} onChange={(e) => setOcrPick(e.target.value)}>
              {pickable.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
            <button className="btn-secondary shrink-0 px-3 text-xs" onClick={() => void act("download", `ocr-${ocrPick}`)}>
              Add language
            </button>
          </div>
        ) : null}
        {data.ocr
          .filter((o) => o.download && o.download.status !== "done")
          .map((o) => (
            <div key={o.code} className="mt-2 text-xs text-dim">
              {o.name}
              <Progress d={o.download!} />
            </div>
          ))}
      </div>
      {msg ? <p className="mt-3 text-sm text-dim">{msg}</p> : null}
    </section>
  );
}
