"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

/** One-time display of an account recovery code with copy + save-as-file. */
export function RecoveryCodeNotice({ code, onDone, doneLabel = "I've saved it" }: { code: string; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const blob = new Blob([`Quizy recovery code\n\n${code}\n\nUse it on the sign-in page (“Forgot password?”) to reset your password.\n`], {
      type: "text/plain",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "quizy-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Save your recovery code</h2>
        <p className="mt-1 text-sm text-dim">
          If you ever forget your password, this code lets you reset it — no email needed. It&apos;s shown only once.
        </p>
      </div>
      <div className="rounded-xl border border-line bg-surface2 px-4 py-3 text-center font-mono text-lg tracking-wider">{code}</div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary flex-1"
          onClick={async () => {
            await navigator.clipboard?.writeText(code).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? <><Icon name="check" /> Copied</> : <><Icon name="copy" /> Copy</>}
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={download}>
          Save as file
        </button>
      </div>
      <button type="button" className="btn-primary w-full" onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
