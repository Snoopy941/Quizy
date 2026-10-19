import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { newRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery";
import { authLimiter, tooManyMessage } from "@/lib/rate-limit";

/** GET — whether a recovery code exists. POST { password } — make a new one (old one stops working). */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { recoveryHash: true } });
  return NextResponse.json({ hasCode: Boolean(user?.recoveryHash) });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const key = `pw:${userId}`;
  const wait = authLimiter.account.retryAfter(key);
  if (wait > 0) return NextResponse.json({ error: tooManyMessage(wait) }, { status: 429 });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(String(body?.password ?? ""), user.passwordHash))) {
    authLimiter.account.fail(key);
    return NextResponse.json({ error: "Password is incorrect" }, { status: 401 });
  }
  const code = newRecoveryCode();
  await prisma.user.update({ where: { id: userId }, data: { recoveryHash: await bcrypt.hash(normalizeRecoveryCode(code), 10) } });
  return NextResponse.json({ ok: true, recoveryCode: code });
}
