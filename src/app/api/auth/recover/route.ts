import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { newRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery";
import { authLimiter, clientKey, tooManyMessage } from "@/lib/rate-limit";

/**
 * POST /api/auth/recover — { email, code, password }
 * Reset a forgotten password with the account's recovery code (works offline,
 * no email needed). The code is single-use: a new one is returned.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const code = normalizeRecoveryCode(String(body?.code ?? ""));
  const password = String(body?.password ?? "");
  if (password.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });

  const accountKey = `recover:${email}`;
  const ipKey = `recover-ip:${clientKey(req.headers)}`;
  const wait = Math.max(authLimiter.account.retryAfter(accountKey), authLimiter.client.retryAfter(ipKey));
  if (wait > 0) return NextResponse.json({ error: tooManyMessage(wait) }, { status: 429 });

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const ok = Boolean(user?.recoveryHash && code && (await bcrypt.compare(code, user.recoveryHash)));
  if (!user || !ok) {
    authLimiter.account.fail(accountKey);
    authLimiter.client.fail(ipKey);
    return NextResponse.json({ error: "That email and recovery code don't match." }, { status: 401 });
  }
  authLimiter.account.reset(accountKey);
  const nextCode = newRecoveryCode();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      recoveryHash: await bcrypt.hash(normalizeRecoveryCode(nextCode), 10),
      tokenVersion: { increment: 1 },
    },
  });
  const token = await createSessionToken({ userId: user.id, email: user.email, tv: updated.tokenVersion });
  const res = NextResponse.json({ ok: true, recoveryCode: nextCode });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
