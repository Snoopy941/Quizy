import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  beginSignIn,
  b64url,
  finishPending,
  getPending,
  hasPassword,
  identityFromIdToken,
  loadGoogleConfig,
  redirectUriFor,
  takePending,
} from "../src/lib/google";

const cfg = { clientId: "123.apps.googleusercontent.com", clientSecret: "s" };
const jwt = (claims: Record<string, unknown>) =>
  [b64url(Buffer.from('{"alg":"RS256"}')), b64url(Buffer.from(JSON.stringify(claims))), "sig"].join(".");
const base = { iss: "https://accounts.google.com", aud: cfg.clientId, exp: Math.floor(Date.now() / 1000) + 600, sub: "g-1", email: "Alex@Gmail.com", email_verified: true, name: "Alex", nonce: "n1" };

test("Google sign-in link uses PKCE, the loopback address and a fresh state", () => {
  const { state, url } = beginSignIn(cfg, 3927);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("redirect_uri"), "http://127.0.0.1:3927/api/auth/google/callback");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), state);
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  const p = getPending(state)!;
  const challenge = b64url(crypto.createHash("sha256").update(p.verifier).digest());
  assert.equal(u.searchParams.get("code_challenge"), challenge);
  assert.equal(u.searchParams.get("nonce"), p.nonce);
  assert.notEqual(beginSignIn(cfg, 3927).state, state);
  assert.equal(redirectUriFor(4000), "http://127.0.0.1:4000/api/auth/google/callback");
});

test("a finished sign-in is handed over once", () => {
  const { state } = beginSignIn(cfg, 1);
  assert.equal(takePending(state)?.status, "pending");
  assert.ok(getPending(state), "pending sign-ins stay until finished");
  finishPending(state, { userId: "u1" });
  assert.equal(takePending(state)?.userId, "u1");
  assert.equal(getPending(state), undefined);
});

test("ID token claims are checked", () => {
  const id = identityFromIdToken(jwt(base), cfg, "n1");
  assert.deepEqual([id.sub, id.email, id.emailVerified, id.name], ["g-1", "alex@gmail.com", true, "Alex"]);
  assert.throws(() => identityFromIdToken(jwt({ ...base, aud: "other" }), cfg, "n1"), /different app/);
  assert.throws(() => identityFromIdToken(jwt({ ...base, iss: "https://evil.example" }), cfg, "n1"), /issued by Google/);
  assert.throws(() => identityFromIdToken(jwt({ ...base, exp: 1 }), cfg, "n1"), /expired/);
  assert.throws(() => identityFromIdToken(jwt(base), cfg, "other-nonce"), /didn't match/);
  assert.throws(() => identityFromIdToken("nope", cfg, "n1"), /unreadable/);
  assert.equal(identityFromIdToken(jwt({ ...base, email_verified: false }), cfg, "n1").emailVerified, false);
});

test("Google client JSON from Google Cloud is read as-is", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizy-g-"));
  const file = path.join(dir, "google-oauth.json");
  fs.writeFileSync(file, JSON.stringify({ installed: { client_id: "abc.apps.googleusercontent.com", client_secret: "xyz" } }));
  const prev = { f: process.env.QUIZY_GOOGLE_OAUTH_FILE, id: process.env.QUIZY_GOOGLE_CLIENT_ID };
  delete process.env.QUIZY_GOOGLE_CLIENT_ID;
  process.env.QUIZY_GOOGLE_OAUTH_FILE = file;
  try {
    assert.deepEqual(loadGoogleConfig(), { clientId: "abc.apps.googleusercontent.com", clientSecret: "xyz" });
  } finally {
    if (prev.f === undefined) delete process.env.QUIZY_GOOGLE_OAUTH_FILE;
    else process.env.QUIZY_GOOGLE_OAUTH_FILE = prev.f;
    if (prev.id !== undefined) process.env.QUIZY_GOOGLE_CLIENT_ID = prev.id;
  }
});

test("Google-only accounts have no password", () => {
  assert.equal(hasPassword(""), false);
  assert.equal(hasPassword("$2a$10$abcdefghijklmnopqrstuv"), true);
});
