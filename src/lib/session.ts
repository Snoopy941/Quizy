import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function getUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  // Ensure the user still exists and this session wasn't signed out.
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, tokenVersion: true } });
  if (!user || (payload.tv ?? 0) !== user.tokenVersion) return null;
  return user.id;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
