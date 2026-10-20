import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { authLimiter, tooManyMessage } from "@/lib/rate-limit";
import { hasPassword } from "@/lib/google";

/** POST /api/auth/password — { current, next }. Signs out other sessions. */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const current = String(body?.current ?? "");
  const next = String(body?.next ?? "");
  if (next.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });

  const key = `pw:${userId}`;
  const wait = authLimiter.account.retryAfter(key);
  if (wait > 0) return NextResponse.json({ error: tooManyMessage(wait) }, { status: 429 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  // Accounts made with Google have no password yet: let them add one.
  if (!user || (hasPassword(user.passwordHash) && !(await bcrypt.compare(current, user.passwordHash)))) {
    authLimiter.account.fail(key);
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }
  authLimiter.account.reset(key);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(next, 10), tokenVersion: { increment: 1 } },
  });
  const token = await createSessionToken({ userId, email: updated.email, tv: updated.tokenVersion });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
