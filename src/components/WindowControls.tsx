"use client";

import { useEffect, useState } from "react";

/**
 * Custom window controls for the Quizy desktop shell (frameless window).
 * Renders nothing in a normal browser — only when window.quizyDesktop exists.
 */
export interface PhoneStatus {
  enabled: boolean;
  port: number | null;
  addresses: string[];
  /** Pairing link encoded in the QR code (null when off or no Wi-Fi address). */
  url: string | null;
}

declare global {
  interface Window {
    quizyDesktop?: {
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (cb: (maximized: boolean) => void) => void;
      onUpdate?: (cb: (u: { status: "downloading" | "ready"; version?: string; percent?: number }) => void) => void;
      checkForUpdates?: () => Promise<{ status: string; version?: string | null; error?: string }>;
      installUpdate?: () => Promise<boolean>;
      appVersion?: () => Promise<string | null>;
      phoneStatus?: () => Promise<PhoneStatus>;
      setPhoneAccess?: (on: boolean) => Promise<PhoneStatus>;
      resetPhonePairing?: () => Promise<PhoneStatus>;
    };
  }
}

export function WindowControls() {
  const [ready, setReady] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const d = window.quizyDesktop;
    if (!d) return;
    setReady(true);
    d.isMaximized().then(setMaximized).catch(() => {});
    d.onMaximizeChange(setMaximized);
  }, []);

  if (!ready) return null;

  const btn =
    "flex h-full w-11 items-center justify-center text-dim transition-colors hover:bg-surface2 hover:text-ink";

  return (
    <div className="flex h-full items-stretch">
      <button aria-label="Minimize" title="Minimize" className={btn} onClick={() => void window.quizyDesktop?.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        className={btn}
        onClick={() => void window.quizyDesktop?.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        aria-label="Close"
        title="Close"
        className="flex h-full w-11 items-center justify-center text-dim transition-colors hover:bg-[#c42b1c] hover:text-white"
        onClick={() => void window.quizyDesktop?.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
