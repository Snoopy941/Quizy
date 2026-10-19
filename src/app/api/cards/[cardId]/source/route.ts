import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

/** GET /api/cards/:cardId/source — the passage a card was written from, for the "Source" panel. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: {
      chunk: { select: { heading: true, text: true, pageStart: true, pageEnd: true } },
      deck: { select: { pdfUrl: true, sourceType: true, name: true } },
    },
  });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  return NextResponse.json({
    page: card.sourcePage,
    quote: card.sourceQuote,
    sourceType: card.deck.sourceType,
    deckName: card.deck.name,
    fileUrl: card.deck.pdfUrl,
    section: card.chunk
      ? { heading: card.chunk.heading, text: card.chunk.text, pageStart: card.chunk.pageStart, pageEnd: card.chunk.pageEnd }
      : null,
  });
}
