import { NextRequest, NextResponse } from "next/server";
import { beginSignIn, GSTATE_COOKIE, loadGoogleConfig } from "@/lib/google";

function isLoopback(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** POST — begin a Google sign-in. Returns the link to open in the browser. */
export async function POST(req: NextRequest) {
  const cfg = loadGoogleConfig();
  if (!cfg) return NextResponse.json({ error: "Google sign-in isn't set up in this copy of Quizy" }, { status: 404 });
  // Google sends the browser back to 127.0.0.1, so this only works on the computer running Quizy.
  if (!isLoopback(req.nextUrl.hostname)) {
    return NextResponse.json({ error: "Sign in with Google on the computer running Quizy, then use your phone." }, { status: 400 });
  }
  const port = req.nextUrl.port || process.env.PORT || "80";
  const { state, url } = beginSignIn(cfg, port);
  const res = NextResponse.json({ url, state });
  // Ties the poll to this window, so a copied link can't be used to grab the session.
  res.cookies.set(GSTATE_COOKIE, state, { httpOnly: true, sameSite: "strict", path: "/api/auth/google", maxAge: 600 });
  return res;
}
