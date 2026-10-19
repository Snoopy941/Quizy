"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { RecoveryCodeNotice } from "@/components/RecoveryCodeNotice";

export function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [codePw, setCodePw] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ hasCode: boolean }>("/api/auth/recovery-code")
      .then((r) => setHasCode(r.hasCode))
      .catch(() => {});
  }, []);

  return (
    <section className="card p-6">
      <h2 className="font-semibold">Password &amp; security</h2>

      <form
        className="mt-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) });
            setMsg("Password changed ✓ — other devices were signed out.");
            setCurrent("");
            setNext("");
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Couldn't change password");
          }
          setBusy(false);
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className="input" type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <input className="input" type="password" placeholder="New password (8+ characters)" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-dim">{msg}</p>
          <button className="btn-secondary shrink-0 px-4 py-2 text-sm" disabled={busy}>
            Change password
          </button>
        </div>
      </form>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-medium">Recovery code</p>
        <p className="mt-1 text-xs text-dim">
          {hasCode === false
            ? "You don't have a recovery code yet. Create one so you can reset a forgotten password."
            : "Lets you reset a forgotten password from the sign-in page. Making a new one replaces the old one."}
        </p>
        {newCode ? (
          <div className="mt-4">
            <RecoveryCodeNotice code={newCode} onDone={() => setNewCode(null)} />
          </div>
        ) : (
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setCodeMsg(null);
              try {
                const r = await api<{ recoveryCode: string }>("/api/auth/recovery-code", {
                  method: "POST",
                  body: JSON.stringify({ password: codePw }),
                });
                setNewCode(r.recoveryCode);
                setHasCode(true);
                setCodePw("");
              } catch (err) {
                setCodeMsg(err instanceof Error ? err.message : "Couldn't create a code");
              }
            }}
          >
            <input className="input" type="password" placeholder="Confirm your password" value={codePw} onChange={(e) => setCodePw(e.target.value)} required />
            <button className="btn-secondary shrink-0 px-4 text-sm">{hasCode ? "New code" : "Create code"}</button>
          </form>
        )}
        {codeMsg ? <p className="mt-2 text-xs text-dim">{codeMsg}</p> : null}
      </div>
    </section>
  );
}
