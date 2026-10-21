"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { DesktopBar } from "./DesktopBar";
import { RecoveryCodeNotice } from "./RecoveryCodeNotice";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const isSignup = mode === "signup";

  // "Continue with Google" (only on the computer running Quizy, and only when set up)
  const [googleOn, setGoogleOn] = useState(false);
  const [googleWait, setGoogleWait] = useState<{ url: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const h = window.location.hostname;
    if (h !== "127.0.0.1" && h !== "localhost") return;
    fetch("/api/auth/google/status")
      .then((r) => r.json())
      .then((d) => setGoogleOn(Boolean(d.enabled)))
      .catch(() => {});
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const stopGoogle = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setGoogleWait(null);
  };

  const continueWithGoogle = async () => {
    setError(null);
    try {
      const res = await fetch("/api/auth/google/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start Google sign-in");
      window.open(data.url, "_blank", "noopener");
      setGoogleWait({ url: data.url });
      const started = Date.now();
      const poll = async () => {
        try {
          const r = await fetch(`/api/auth/google/poll?state=${encodeURIComponent(data.state)}`, { cache: "no-store" });
          const d = await r.json().catch(() => ({}));
          if (r.ok && d.ok) {
            window.location.href = "/";
            return;
          }
          if (!r.ok) {
            stopGoogle();
            setError(d.error || "Google sign-in failed");
            return;
          }
        } catch {
          /* keep waiting */
        }
        if (Date.now() - started > 10 * 60 * 1000) {
          stopGoogle();
          setError("The Google sign-in timed out. Please try again.");
          return;
        }
        pollTimer.current = setTimeout(poll, 1500);
      };
      pollTimer.current = setTimeout(poll, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start Google sign-in");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${isSignup ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isSignup ? { name, email, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      if (isSignup && data.recoveryCode) {
        setRecoveryCode(data.recoveryCode);
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 pb-12 chromeless-pad">
      <DesktopBar />
      <div className="w-full max-w-sm">
        <div className="anim-pop mb-10 flex justify-center">
          <Logo size="lg" />
        </div>

        {googleWait ? (
          <div className="card anim-rise p-6 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden="true" />
            <h1 className="text-lg font-bold">Finish signing in with Google</h1>
            <p className="mt-2 text-sm text-dim">
              Your browser opened Google&apos;s sign-in page. Pick your account there, then come back here. Quizy signs you in automatically.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => window.open(googleWait.url, "_blank", "noopener")}>
                Open the page again
              </button>
              <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={stopGoogle}>
                Cancel
              </button>
            </div>
          </div>
        ) : recoveryCode ? (
          <div className="card anim-rise p-6">
            <RecoveryCodeNotice code={recoveryCode} onDone={() => (window.location.href = "/")} doneLabel="Continue to Quizy" />
          </div>
        ) : (
        <form onSubmit={submit} className="card anim-rise p-6">
          <h1 className="mb-5 text-lg font-bold">{isSignup ? "Create your account" : "Welcome back"}</h1>

          {error ? (
            <div className="mb-4 rounded-lg border border-line bg-surface2 px-3.5 py-2.5 text-sm text-ink">
              {error}
            </div>
          ) : null}

          {googleOn ? (
            <>
              <button type="button" onClick={continueWithGoogle} className="btn-secondary mb-4 w-full gap-3">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
                </svg>
                Continue with Google
              </button>
              <div className="mb-4 flex items-center gap-3 text-xs text-dim">
                <span className="h-px flex-1 bg-line" />
                or with email
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          ) : null}

          {isSignup ? (
            <div className="mb-4">
              <label className="label" htmlFor="name">Name</label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Student"
                autoComplete="name"
              />
            </div>
          ) : null}

          <div className="mb-4">
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              autoComplete="email"
            />
          </div>

          <div className="mb-6">
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={isSignup ? 8 : undefined}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "…" : isSignup ? "Create account" : "Sign in"}
          </button>
          {!isSignup ? (
            <p className="mt-4 text-center text-xs">
              <Link href="/forgot" className="text-dim underline underline-offset-4 hover:text-ink">
                Forgot password?
              </Link>
            </p>
          ) : null}
        </form>
        )}

        <p className="mt-6 text-center text-sm text-dim">
          {isSignup ? (
            <>Already have an account? <Link href="/login" className="text-ink underline underline-offset-4">Sign in</Link></>
          ) : (
            <>New to Quizy? <Link href="/signup" className="text-ink underline underline-offset-4">Create an account</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
