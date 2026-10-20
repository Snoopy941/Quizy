import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { getPending, GSTATE_COOKIE, takePending } from "@/lib/google";

/** GET ?state= — the app window waits here until the browser finishes signing in. */
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") || "";
  if (!state || req.cookies.get(GSTATE_COOKIE)?.value !== state) {
    return NextResponse.json({ error: "This sign-in wasn't started from this window" }, { status: 403 });
  }
  const p = getPending(state);
  if (!p) return NextResponse.json({ error: "The Google sign-in timed out. Please try again." }, { status: 410 });
  if (p.status === "pending") return NextResponse.json({ pending: true });

  takePending(state);
  const clear = { httpOnly: true, sameSite: "strict" as const, path: "/api/auth/google", maxAge: 0 };
  if (p.status === "error" || !p.userId) {
    const res = NextResponse.json({ error: p.error || "Google sign-in failed" }, { status: 400 });
    res.cookies.set(GSTATE_COOKIE, "", clear);
    return res;
  }
  const user = await prisma.user.findUnique({ where: { id: p.userId } });
  if (!user) return NextResponse.json({ error: "That account no longer exists" }, { status: 400 });
  const token = await createSessionToken({ userId: user.id, email: user.email, tv: user.tokenVersion });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  res.cookies.set(GSTATE_COOKIE, "", clear);
  return res;
}
