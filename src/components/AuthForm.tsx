"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { DesktopBar } from "./DesktopBar";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

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
        <div className="mb-10 flex justify-center">
          <Logo size="lg" />
        </div>

        <form onSubmit={submit} className="card p-6">
          <h1 className="mb-5 text-lg font-bold">{isSignup ? "Create your account" : "Welcome back"}</h1>

          {error ? (
            <div className="mb-4 rounded-lg border border-line bg-surface2 px-3.5 py-2.5 text-sm text-ink">
              {error}
            </div>
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
        </form>

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
