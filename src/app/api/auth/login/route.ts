import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { authLimiter, clientKey, tooManyMessage } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const accountKey = `login:${email}`;
    const ipKey = `login-ip:${clientKey(req.headers)}`;
    const wait = Math.max(authLimiter.account.retryAfter(accountKey), authLimiter.client.retryAfter(ipKey));
    if (wait > 0) return NextResponse.json({ error: tooManyMessage(wait) }, { status: 429 });

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      authLimiter.account.fail(accountKey);
      authLimiter.client.fail(ipKey);
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    authLimiter.account.reset(accountKey);

    const token = await createSessionToken({ userId: user.id, email: user.email, tv: user.tokenVersion });
    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (err) {
    console.error("[login] failed:", err);
    return NextResponse.json({ error: "Could not sign in" }, { status: 500 });
  }
}
