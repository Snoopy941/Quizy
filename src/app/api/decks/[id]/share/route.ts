import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

/** POST /api/decks/:id/share — create or rotate the public share link. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const shareId = randomBytes(9).toString("base64url");
  const updated = await prisma.deck.update({ where: { id }, data: { shareId } });
  return NextResponse.json({ ok: true, shareId: updated.shareId });
}

/** DELETE /api/decks/:id/share — disable sharing. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  await prisma.deck.update({ where: { id }, data: { shareId: null } });
  return NextResponse.json({ ok: true });
}
