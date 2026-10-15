import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { generateCards } from "@/lib/ai";
import { cardsPerChunk } from "@/lib/generate";

const CARD_TYPES = ["definition", "fill-blank", "mc", "true-false", "short-answer"];

/**
 * POST /api/decks/:id/regenerate
 * Body: { cardId?: string, chunkId?: string, instructions?: string }
 * Regenerates a single card in place (keeps SRS state), or all cards of a
 * section (resets their SRS state), or — with neither id — the entire deck.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const extraInstructions = typeof body?.instructions === "string" ? body.instructions.trim().slice(0, 500) : "";
  const instructions = [deck.instructions, extraInstructions].filter(Boolean).join(" ");

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const perChunk = cardsPerChunk(settings?.cardDensity);

  try {
    // ---- Single card ----
    if (body?.cardId) {
      const card = await prisma.card.findFirst({ where: { id: body.cardId, deckId: id } });
      if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

      const chunk = card.chunkId
        ? await prisma.deckChunk.findUnique({ where: { id: card.chunkId } })
        : null;
      const sourceText = chunk?.text ?? `${card.front} ${card.back}`;
      const heading = chunk?.heading || card.category;

      let cards = await generateCards({
        text: sourceText,
        heading,
        count: 1,
        instructions: instructions || undefined,
      });
      if (!cards.length) return NextResponse.json({ error: "Generation returned no cards" }, { status: 502 });
      // Replace the old card's content, keep scheduling state.
      const g = cards[0];
      const updated = await prisma.card.update({
        where: { id: card.id },
        data: {
          front: g.front,
          back: g.back,
          type: g.type,
          options: g.options ? JSON.stringify(g.options) : null,
          difficulty: g.difficulty,
          category: heading || g.category,
        },
      });
      return NextResponse.json({ ok: true, card: updated });
    }

    // ---- Whole chunk ----
    if (body?.chunkId) {
      const chunk = await prisma.deckChunk.findFirst({ where: { id: body.chunkId, deckId: id } });
      if (!chunk) return NextResponse.json({ error: "Section not found" }, { status: 404 });

      const cards = await generateCards({
        text: chunk.text,
        heading: chunk.heading,
        count: chunk.cardCount || perChunk,
        instructions: instructions || undefined,
      });
      if (!cards.length) return NextResponse.json({ error: "Generation returned no cards" }, { status: 502 });

      await prisma.$transaction([
        prisma.card.deleteMany({ where: { deckId: id, chunkId: chunk.id } }),
        prisma.card.createMany({
          data: cards.map((c, i) => ({
            deckId: id,
            chunkId: chunk.id,
            front: c.front,
            back: c.back,
            type: c.type,
            options: c.options ? JSON.stringify(c.options) : null,
            difficulty: c.difficulty,
            category: c.category,
            position: chunk.position * 10 + i,
          })),
        }),
        prisma.deckChunk.update({ where: { id: chunk.id }, data: { status: "done" } }),
      ]);
      const fresh = await prisma.card.findMany({ where: { deckId: id, chunkId: chunk.id }, orderBy: { position: "asc" } });
      return NextResponse.json({ ok: true, cards: fresh });
    }

    return NextResponse.json({ error: "Provide cardId or chunkId" }, { status: 400 });
  } catch (err) {
    console.error("[regenerate] failed:", err);
    return NextResponse.json({ error: "Regeneration failed — try again" }, { status: 502 });
  }
}
