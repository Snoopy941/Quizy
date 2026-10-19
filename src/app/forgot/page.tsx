"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { DesktopBar } from "@/components/DesktopBar";
import { RecoveryCodeNotice } from "@/components/RecoveryCodeNotice";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't reset the password");
      setNewCode(data.recoveryCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password");
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 pb-12 chromeless-pad">
      <DesktopBar />
      <div className="w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Logo size="lg" />
        </div>
        {newCode ? (
          <div className="card p-6">
            <p className="mb-4 text-sm text-dim">Password changed. Your old recovery code no longer works — here&apos;s your new one.</p>
            <RecoveryCodeNotice code={newCode} onDone={() => (window.location.href = "/")} doneLabel="Continue to Quizy" />
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-6">
            <div>
              <h1 className="text-lg font-bold">Reset your password</h1>
              <p className="mt-1 text-xs text-dim">Use the recovery code you saved when you created your account.</p>
            </div>
            {error ? <div className="rounded-lg border border-line bg-surface2 px-3.5 py-2.5 text-sm">{error}</div> : null}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="code">Recovery code</label>
              <input
                id="code"
                required
                className="input font-mono uppercase"
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label" htmlFor="pw">New password</label>
              <input
                id="pw"
                type="password"
                required
                minLength={8}
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "…" : "Reset password"}
            </button>
            <p className="text-center text-xs text-dim">
              No recovery code? On this computer, another account can&apos;t reset yours — create a new account instead.{" "}
              <Link href="/login" className="underline underline-offset-4">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
