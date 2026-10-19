import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { getDeckStats } from "@/lib/stats";
import { CARD_LANGUAGES } from "@/lib/format";

async function ownedDeck(req: NextRequest, deckId: string) {
  const userId = await getUserId(req);
  if (!userId) return { error: unauthorized() as NextResponse };
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } });
  if (!deck) return { error: NextResponse.json({ error: "Deck not found" }, { status: 404 }) };
  return { deck };
}

function parseOptions(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** GET /api/decks/:id — deck detail: cards, chunks, stats, active session. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { deck, error } = await ownedDeck(req, id);
  if (error || !deck) return error!;

  const [cards, chunks, stats, activeSession] = await Promise.all([
    prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" } }),
    prisma.deckChunk.findMany({
      where: { deckId: id },
      orderBy: { position: "asc" },
      select: { id: true, position: true, heading: true, status: true, cardCount: true, pageStart: true, pageEnd: true },
    }),
    getDeckStats(id),
    prisma.studySession.findFirst({
      where: { deckId: id, userId: deck.userId, status: "active" },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true, mode: true },
    }),
  ]);

  return NextResponse.json({
    deck: {
      id: deck.id,
      name: deck.name,
      description: deck.description,
      instructions: deck.instructions,
      pdfUrl: deck.pdfUrl,
      sourceType: deck.sourceType,
      aiSource: deck.aiSource,
      cardLanguage: deck.cardLanguage,
      ocrLanguage: deck.ocrLanguage,
      pinned: deck.pinned,
      shareId: deck.shareId,
      genStatus: deck.genStatus,
      genProgress: deck.genProgress,
      genError: deck.genError,
      lastStudiedAt: deck.lastStudiedAt,
      createdAt: deck.createdAt,
    },
    cards: cards.map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      type: c.type,
      options: parseOptions(c.options),
      difficulty: c.difficulty,
      category: c.category,
      position: c.position,
      chunkId: c.chunkId,
      dueDate: c.dueDate,
      intervalDays: c.intervalDays,
      reps: c.reps,
      lapses: c.lapses,
      timesSeen: c.timesSeen,
      timesFailed: c.timesFailed,
      sourcePage: c.sourcePage,
      sourceQuote: c.sourceQuote,
      imageUrl: c.imageUrl,
    })),
    chunks,
    stats,
    activeSession,
  });
}

/** PATCH /api/decks/:id — rename / edit / pin. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { deck, error } = await ownedDeck(req, id);
  if (error || !deck) return error!;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (typeof body.description === "string") data.description = body.description.slice(0, 500);
  if (typeof body.instructions === "string") data.instructions = body.instructions.slice(0, 500);
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.cardLanguage === "string" && CARD_LANGUAGES[body.cardLanguage]) data.cardLanguage = body.cardLanguage;
  if (typeof body.ocrLanguage === "string" && /^[a-z_]{3,8}(\+[a-z_]{3,8})*$/.test(body.ocrLanguage)) data.ocrLanguage = body.ocrLanguage;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.deck.update({ where: { id }, data });
  return NextResponse.json({ ok: true, deck: { id: updated.id, name: updated.name, pinned: updated.pinned, instructions: updated.instructions } });
}

/** DELETE /api/decks/:id */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await ownedDeck(req, id);
  if (error) return error!;
  await prisma.deck.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
