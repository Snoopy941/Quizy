/**
 * "Continue with Google" for the desktop app.
 *
 * Quizy accounts live on this computer; Google is only used to prove who you
 * are. The flow follows Google's guidance for installed apps:
 *   1. The app window asks /api/auth/google/start for a sign-in link. It opens
 *      in the user's normal browser (Google blocks sign-in inside app windows).
 *   2. Google sends the browser back to http://127.0.0.1:<port>/api/auth/google/callback.
 *      Quizy swaps the code for an ID token (with PKCE) and finds or creates
 *      the local account.
 *   3. The app window, which has been polling /api/auth/google/poll, gets its
 *      session cookie. The browser tab just shows "You can go back to Quizy".
 *
 * Configuration: the OAuth client JSON downloaded from Google Cloud
 * ("Desktop app" client type), saved as google-oauth.json next to the app, or
 * the QUIZY_GOOGLE_CLIENT_ID / QUIZY_GOOGLE_CLIENT_SECRET environment variables.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

/** Cookie that ties a sign-in to the app window that started it. */
export const GSTATE_COOKIE = "quizy_gstate";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function loadGoogleConfig(): GoogleConfig | null {
  const envId = process.env.QUIZY_GOOGLE_CLIENT_ID;
  if (envId) return { clientId: envId, clientSecret: process.env.QUIZY_GOOGLE_CLIENT_SECRET || "" };
  const candidates = [
    process.env.QUIZY_GOOGLE_OAUTH_FILE,
    path.join(process.cwd(), "google-oauth.json"),
    process.env.QUIZY_DATA_DIR ? path.join(process.env.QUIZY_DATA_DIR, "google-oauth.json") : undefined,
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      // Google's download wraps the values in "installed" (desktop) or "web".
      const c = json.installed || json.web || json;
      if (typeof c.client_id === "string" && c.client_id) {
        return { clientId: c.client_id, clientSecret: typeof c.client_secret === "string" ? c.client_secret : "" };
      }
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/* ---------------- pending sign-ins (in memory, 10 minutes) ---------------- */

export type Pending = {
  verifier: string;
  nonce: string;
  redirectUri: string;
  createdAt: number;
  status: "pending" | "done" | "error";
  userId?: string;
  error?: string;
};

const TTL_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __quizyGoogle?: Map<string, Pending> };
const pending: Map<string, Pending> = (g.__quizyGoogle ??= new Map());

function sweep(now = Date.now()) {
  for (const [k, v] of pending) if (now - v.createdAt > TTL_MS) pending.delete(k);
}

export function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The callback address Google sends the browser back to. Always the loopback address. */
export function redirectUriFor(port: string | number): string {
  return `http://127.0.0.1:${port}/api/auth/google/callback`;
}

export function beginSignIn(cfg: GoogleConfig, port: string | number): { state: string; url: string } {
  sweep();
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const nonce = b64url(crypto.randomBytes(16));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const redirectUri = redirectUriFor(port);
  pending.set(state, { verifier, nonce, redirectUri, createdAt: Date.now(), status: "pending" });
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { state, url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
}

export function getPending(state: string): Pending | undefined {
  sweep();
  return pending.get(state);
}

export function finishPending(state: string, result: { userId: string } | { error: string }) {
  const p = pending.get(state);
  if (!p) return;
  if ("userId" in result) {
    p.status = "done";
    p.userId = result.userId;
  } else {
    p.status = "error";
    p.error = result.error;
  }
}

export function takePending(state: string) {
  const p = pending.get(state);
  if (p && p.status !== "pending") pending.delete(state);
  return p;
}

/* ---------------- token exchange ---------------- */

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

/**
 * Validate the claims of an ID token received directly from Google's token
 * endpoint over HTTPS (OpenID Connect Core 3.1.3.7 allows skipping the
 * signature check in that case).
 */
export function identityFromIdToken(idToken: string, cfg: GoogleConfig, nonce: string, now = Date.now()): GoogleIdentity {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google sent an unreadable sign-in token");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    throw new Error("Google sent an unreadable sign-in token");
  }
  const iss = claims.iss;
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") throw new Error("The sign-in token wasn't issued by Google");
  const aud = claims.aud;
  if (!(aud === cfg.clientId || (Array.isArray(aud) && aud.includes(cfg.clientId)))) throw new Error("The sign-in token is for a different app");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - 60_000) throw new Error("The Google sign-in expired. Please try again.");
  if (claims.nonce !== nonce) throw new Error("The Google sign-in didn't match this request. Please try again.");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Google didn't return an account id");
  if (typeof claims.email !== "string" || !claims.email) throw new Error("Google didn't share an email address");
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name : "",
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };
}

export async function exchangeCode(cfg: GoogleConfig, p: Pending, code: string): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    redirect_uri: p.redirectUri,
    grant_type: "authorization_code",
    code_verifier: p.verifier,
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Couldn't reach Google. Check your internet connection and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.id_token) {
    throw new Error(`Google sign-in failed${json.error_description ? `: ${json.error_description}` : json.error ? `: ${json.error}` : ""}`);
  }
  return identityFromIdToken(json.id_token, cfg, p.nonce);
}

/** Google-only accounts have no password; they're stored with an empty hash. */
export function hasPassword(passwordHash: string | null | undefined): boolean {
  return typeof passwordHash === "string" && passwordHash.startsWith("$2");
}
