import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** GET /api/share/:shareId — public deck data (no auth). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await ctx.params;
  const deck = await prisma.deck.findUnique({
    where: { shareId },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      cards: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          front: true,
          back: true,
          type: true,
          options: true,
          difficulty: true,
          category: true,
        },
      },
    },
  });
  if (!deck) return NextResponse.json({ error: "Shared deck not found" }, { status: 404 });

  return NextResponse.json({
    deck: {
      name: deck.name,
      description: deck.description,
      createdAt: deck.createdAt,
      ownerName: deck.user.name || deck.user.email,
      cards: deck.cards.map((c) => ({
        ...c,
        options: c.options ? JSON.parse(c.options) : null,
      })),
    },
  });
}
