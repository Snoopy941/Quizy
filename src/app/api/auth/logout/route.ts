import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { getUserId } from "@/lib/session";

/** Sign out: clears the cookie and invalidates every existing session token for this account. */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req).catch(() => null);
  if (userId) {
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
