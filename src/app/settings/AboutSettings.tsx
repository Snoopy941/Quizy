"use client";

import { useEffect, useState } from "react";

/** App version + "Check for updates" (desktop app only). */
export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = window.quizyDesktop;
    if (!d) return;
    setDesktop(true);
    d.appVersion?.().then(setVersion).catch(() => {});
    d.onUpdate?.((u) => {
      if (u.status === "downloading") setMsg(`Downloading update${u.percent ? ` — ${u.percent}%` : ""}…`);
      if (u.status === "ready") setMsg(`Version ${u.version ?? ""} is ready — restart Quizy to install it.`);
    });
  }, []);

  if (!desktop) return null;
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-6">
      <div>
        <h2 className="font-semibold">Quizy {version ? `v${version}` : ""}</h2>
        <p className="mt-1 text-xs text-dim">{msg ?? "Updates download automatically in the background."}</p>
      </div>
      <button
        className="btn-secondary px-3 py-1.5 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg("Checking…");
          const r = await window.quizyDesktop?.checkForUpdates?.().catch(() => null);
          if (!r || r.status === "unsupported") setMsg("Automatic updates work in the installed version of Quizy.");
          else if (r.status === "error") setMsg("Couldn't check for updates — are you online?");
          else if (r.version && r.version !== version) setMsg(`Version ${r.version} found — downloading…`);
          else setMsg("You're on the latest version.");
          setBusy(false);
        }}
      >
        Check for updates
      </button>
    </section>
  );
}
