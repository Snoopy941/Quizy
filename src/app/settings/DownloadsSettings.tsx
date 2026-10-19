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
  engineInstalled: boolean;
  models: { id: string; label: string; description: string; size: number; recommendedRamGb?: number; installed: boolean; active: boolean; download: Dl | null }[];
  otherModels: { file: string; active: boolean }[];
  whisper: { installed: boolean; size: number; download: Dl | null };
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

/** Built-in AI models, voice answers and OCR languages — all optional downloads. */
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
    [...data.models.map((m) => m.download), data.whisper.download, ...data.ocr.map((o) => o.download)].some((d) => d?.status === "downloading");
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
      <p className="mt-1 text-xs text-dim">Optional extras that run offline once downloaded. They&apos;re kept when Quizy updates.</p>

      {data.engineInstalled ? (
        <div className="mt-5">
          <p className="text-sm font-medium">Built-in AI model</p>
          <div className="mt-2 space-y-2">
            {data.models.map((m) => (
              <div key={m.id} className={`rounded-xl border p-3 ${m.active ? "border-accent" : "border-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {m.label} <span className="font-normal text-faint">· {gb(m.size)}</span>
                      {m.active ? <span className="badge ml-2">in use</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-dim">{m.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {m.installed && !m.active ? (
                      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void act("use", m.id)}>
                        Use
                      </button>
                    ) : null}
                    {!m.installed && m.download?.status !== "downloading" ? (
                      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void act("download", m.id)}>
                        Download
                      </button>
                    ) : null}
                    {m.installed && !m.active ? (
                      <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => void act("remove", m.id)} title="Delete this model file">
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                {m.download && m.download.status !== "done" ? <Progress d={m.download} /> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Voice answers</p>
            <p className="mt-0.5 text-xs text-dim">
              Speak your answers in study sessions. Speech recognition runs on this computer ({gb(data.whisper.size)}).
            </p>
          </div>
          {data.whisper.installed ? (
            <span className="badge shrink-0">installed</span>
          ) : data.whisper.download?.status !== "downloading" ? (
            <button className="btn-secondary shrink-0 px-3 py-1.5 text-xs" onClick={() => void act("download", "whisper")}>
              Download
            </button>
          ) : null}
        </div>
        {data.whisper.download && data.whisper.download.status !== "done" ? <Progress d={data.whisper.download} /> : null}
      </div>

      <div className="mt-5">
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
