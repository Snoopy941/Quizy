"use client";

import { useEffect, useState } from "react";

/** Shows download progress / "restart to update" for the desktop app's automatic updates. */
export function UpdateBanner() {
  const [u, setU] = useState<{ status: "downloading" | "ready"; version?: string; percent?: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.quizyDesktop?.onUpdate?.((next) => setU((prev) => ({ ...prev, ...next })));
  }, []);

  if (!u || dismissed || u.status !== "ready") return null;
  return (
    <div className="fixed bottom-20 right-4 z-50 w-72 rounded-xl border border-line bg-surface p-4 shadow-xl md:bottom-4">
      <p className="text-sm font-semibold">Update ready{u.version ? ` — v${u.version}` : ""}</p>
      <p className="mt-1 text-xs text-dim">Restart Quizy to install it. Your decks and progress are kept.</p>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setDismissed(true)}>
          Later
        </button>
        <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void window.quizyDesktop?.installUpdate?.()}>
          Restart now
        </button>
      </div>
    </div>
  );
}
