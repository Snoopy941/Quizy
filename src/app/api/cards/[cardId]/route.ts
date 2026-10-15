import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

async function ownedCard(req: NextRequest, cardId: string) {
  const userId = await getUserId(req);
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { deck: { select: { id: true } } },
  });
  if (!card) return { error: NextResponse.json({ error: "Card not found" }, { status: 404 }) as NextResponse };
  return { card };
}

/** PATCH /api/cards/:cardId — edit front/back/type/difficulty/category/options. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const { card, error } = await ownedCard(req, cardId);
  if (error || !card) return error!;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.front === "string" && body.front.trim()) data.front = body.front.trim().slice(0, 2000);
  if (typeof body.back === "string" && body.back.trim()) data.back = body.back.trim().slice(0, 4000);
  if (["definition", "fill-blank", "mc", "true-false", "short-answer"].includes(body.type)) data.type = body.type;
  if (["easy", "medium", "hard"].includes(body.difficulty)) data.difficulty = body.difficulty;
  if (typeof body.category === "string" && body.category.trim()) data.category = body.category.trim().slice(0, 80);
  if (Array.isArray(body.options)) {
    const opts = body.options.filter((o: unknown) => typeof o === "string").slice(0, 4);
    data.options = body.type === "mc" && opts.length === 4 ? JSON.stringify(opts) : null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.card.update({ where: { id: cardId }, data });
  return NextResponse.json({ ok: true, card: updated });
}

/** DELETE /api/cards/:cardId */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const { error } = await ownedCard(req, cardId);
  if (error) return error!;
  await prisma.card.delete({ where: { id: cardId } });
  return NextResponse.json({ ok: true });
}
