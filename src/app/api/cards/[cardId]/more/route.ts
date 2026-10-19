import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { generateCards, requireAi, AiNotConfiguredError } from "@/lib/ai";
import { dedupeCards } from "@/lib/card-parse";
import { cardRows } from "@/lib/generate";

/** POST /api/cards/:cardId/more — write 3 new cards on the same concept from different angles. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { chunk: true, deck: true },
  });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const existing = await prisma.card.findMany({ where: { deckId: card.deckId }, select: { front: true, back: true } });
  try {
    const ai = await requireAi(userId);
    const generated = await generateCards(
      ai,
      {
        text: card.chunk?.text ?? `${card.front}\n${card.back}`,
        heading: card.chunk?.heading || card.category,
        count: 3,
        instructions: `Focus ONLY on the same concept as this card, testing it from different angles (cause, example, comparison, application): Q: "${card.front}" A: "${card.back}".`,
        avoid: [card.front],
        language: card.deck.cardLanguage,
      },
      "interactive"
    );
    const fresh = dedupeCards(generated, existing);
    if (!fresh.length) return NextResponse.json({ error: "The AI only came up with cards you already have — try again." }, { status: 502 });
    const maxPos = await prisma.card.aggregate({ where: { deckId: card.deckId }, _max: { position: true } });
    const base = (maxPos._max.position ?? 0) + 1;
    const rows = card.chunk
      ? cardRows(card.deckId, card.chunk, fresh).map((r, i) => ({ ...r, position: base + i }))
      : fresh.map((c, i) => ({
          deckId: card.deckId,
          front: c.front,
          back: c.back,
          type: c.type,
          options: c.options ? JSON.stringify(c.options) : null,
          difficulty: c.difficulty,
          category: card.category,
          position: base + i,
        }));
    await prisma.card.createMany({ data: rows });
    return NextResponse.json({ ok: true, added: rows.length });
  } catch (err) {
    const status = err instanceof AiNotConfiguredError ? 409 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't make more cards" }, { status });
  }
}
