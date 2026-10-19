import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

/** POST /api/decks/:id/duplicate — copy deck, chunks, and cards (fresh SRS state kept). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const [chunks, cards] = await Promise.all([
    prisma.deckChunk.findMany({ where: { deckId: id }, orderBy: { position: "asc" } }),
    prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" } }),
  ]);

  const copy = await prisma.deck.create({
    data: {
      userId,
      name: `${deck.name} (copy)`.slice(0, 120),
      description: deck.description,
      instructions: deck.instructions,
      pdfUrl: deck.pdfUrl,
      sourceType: deck.sourceType,
      aiSource: deck.aiSource,
      density: deck.density,
      cardLanguage: deck.cardLanguage,
      ocrLanguage: deck.ocrLanguage,
      figures: deck.figures,
      genStatus: "done",
      genProgress: 100,
    },
  });

  const chunkIdMap = new Map<string, string>();
  for (const ch of chunks) {
    const nc = await prisma.deckChunk.create({
      data: {
        deckId: copy.id,
        position: ch.position,
        heading: ch.heading,
        text: ch.text,
        status: ch.status,
        cardCount: ch.cardCount,
        pageStart: ch.pageStart,
        pageEnd: ch.pageEnd,
        pageMap: ch.pageMap,
        summary: ch.summary,
      },
    });
    chunkIdMap.set(ch.id, nc.id);
  }

  if (cards.length) {
    await prisma.card.createMany({
      data: cards.map((c) => ({
        deckId: copy.id,
        chunkId: c.chunkId ? chunkIdMap.get(c.chunkId) ?? null : null,
        front: c.front,
        back: c.back,
        type: c.type,
        options: c.options,
        difficulty: c.difficulty,
        category: c.category,
        position: c.position,
        easeFactor: c.easeFactor,
        intervalDays: c.intervalDays,
        dueDate: c.dueDate,
        reps: c.reps,
        lapses: c.lapses,
        timesSeen: c.timesSeen,
        timesFailed: c.timesFailed,
        sourcePage: c.sourcePage,
        sourceQuote: c.sourceQuote,
        imageUrl: c.imageUrl,
        stability: c.stability,
        fsrsDifficulty: c.fsrsDifficulty,
        fsrsState: c.fsrsState,
        lastReviewAt: c.lastReviewAt,
      })),
    });
  }

  return NextResponse.json({ ok: true, deck: { id: copy.id, name: copy.name } }, { status: 201 });
}
