"use client";

import { useEffect, useState } from "react";
import type { PhoneStatus } from "@/components/WindowControls";

/**
 * "Study on your phone": the desktop app shares Quizy on your Wi-Fi. Phones
 * pair by scanning a QR code, then sign in to their Quizy account as usual.
 */
export function PhoneSettings() {
  const [desktop, setDesktop] = useState(false);
  const [st, setSt] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = window.quizyDesktop;
    if (!d?.phoneStatus) return;
    setDesktop(true);
    d.phoneStatus().then(setSt).catch(() => {});
  }, []);

  if (!desktop) return null;

  const toggle = async () => {
    setBusy(true);
    const next = await window.quizyDesktop?.setPhoneAccess?.(!st?.enabled).catch(() => null);
    if (next) setSt(next);
    setBusy(false);
  };

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Study on your phone</h2>
          <p className="mt-1 text-xs text-dim">
            Review your decks on a phone or tablet on the same Wi-Fi while Quizy is open on this computer. No install needed.
          </p>
        </div>
        <button
          onClick={() => void toggle()}
          disabled={busy}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            st?.enabled ? "border-accent bg-accent" : "border-line bg-surface2"
          }`}
          aria-label="Toggle phone access"
        >
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${
              st?.enabled ? "left-6 bg-bg" : "left-0.5 bg-faint"
            }`}
          />
        </button>
      </div>

      {st?.enabled ? (
        st.url ? (
          <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/qr?text=${encodeURIComponent(st.url)}`}
              alt="QR code to open Quizy on your phone"
              className="h-44 w-44 rounded-xl bg-white p-1"
            />
            <div className="space-y-2 text-sm text-dim">
              <p>
                <span className="text-ink">1.</span> Scan this with your phone&apos;s camera.
              </p>
              <p>
                <span className="text-ink">2.</span> Sign in with your Quizy account.
              </p>
              <p className="text-xs text-faint">
                Address: {st.addresses[0]}:{st.port}. If Windows asks whether to allow Quizy on networks, choose <b>Private
                networks</b>. Only devices that scanned this code can connect.
              </p>
              <button
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const next = await window.quizyDesktop?.resetPhonePairing?.().catch(() => null);
                  if (next) setSt(next);
                  setBusy(false);
                }}
              >
                Disconnect all phones
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-dim">
            This computer isn&apos;t connected to a home or school network right now, so phones can&apos;t reach it.
          </p>
        )
      ) : null}
    </section>
  );
}
