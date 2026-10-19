import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { newRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery";
import { authLimiter, clientKey, tooManyMessage } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const name = String(body?.name ?? "").trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const ipKey = `register-ip:${clientKey(req.headers)}`;
    const wait = authLimiter.client.retryAfter(ipKey);
    if (wait > 0) return NextResponse.json({ error: tooManyMessage(wait) }, { status: 429 });
    authLimiter.client.fail(ipKey); // counts sign-ups too, so accounts can't be mass-created

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const recoveryCode = newRecoveryCode();
    const recoveryHash = await bcrypt.hash(normalizeRecoveryCode(recoveryCode), 10);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        recoveryHash,
        settings: { create: {} },
      },
    });

    const token = await createSessionToken({ userId: user.id, email: user.email, tv: user.tokenVersion });
    // The recovery code is shown once so the user can reset a forgotten password offline.
    const res = NextResponse.json({ ok: true, recoveryCode, user: { id: user.id, email: user.email, name: user.name } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (err) {
    console.error("[register] failed:", err);
    return NextResponse.json({ error: "Could not create account" }, { status: 500 });
  }
}
