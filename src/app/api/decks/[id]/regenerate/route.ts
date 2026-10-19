import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { generateCards, requireAi, AiNotConfiguredError } from "@/lib/ai";
import { cardRows, cardsPerChunk, parsePageMap } from "@/lib/generate";
import { dedupeCards } from "@/lib/card-parse";
import { pageForQuote } from "@/lib/chunk";

/**
 * POST /api/decks/:id/regenerate
 * Body: { cardId?: string, chunkId?: string, instructions?: string }
 * Regenerates a single card in place (keeps its scheduling state), or all
 * cards of one section (resets their scheduling state).
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
  const perChunk = cardsPerChunk(deck.density || settings?.cardDensity);

  try {
    const ai = await requireAi(userId);

    // ---- Single card ----
    if (body?.cardId) {
      const card = await prisma.card.findFirst({ where: { id: body.cardId, deckId: id } });
      if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

      const chunk = card.chunkId ? await prisma.deckChunk.findUnique({ where: { id: card.chunkId } }) : null;
      const sourceText = chunk?.text ?? `${card.front}\n${card.back}`;
      const heading = chunk?.heading || card.category;
      const siblings = chunk
        ? await prisma.card.findMany({ where: { chunkId: chunk.id, NOT: { id: card.id } }, select: { front: true, back: true } })
        : [];

      const generated = await generateCards(
        ai,
        {
          text: sourceText,
          heading,
          count: 1,
          instructions: [instructions, `Write a different card than: "${card.front}"`].filter(Boolean).join(" "),
          avoid: siblings.map((s) => s.front),
          language: deck.cardLanguage,
        },
        "interactive"
      );
      const g = dedupeCards(generated, siblings)[0] ?? generated[0];
      if (!g) return NextResponse.json({ error: "Generation returned no cards" }, { status: 502 });
      const updated = await prisma.card.update({
        where: { id: card.id },
        data: {
          front: g.front,
          back: g.back,
          type: g.type,
          options: g.options ? JSON.stringify(g.options) : null,
          difficulty: g.difficulty,
          category: heading || g.category,
          sourceQuote: g.source ?? null,
          sourcePage: chunk
            ? pageForQuote(g.source, { text: chunk.text, pageMap: parsePageMap(chunk.pageMap), pageStart: chunk.pageStart })
            : card.sourcePage,
        },
      });
      return NextResponse.json({ ok: true, card: updated });
    }

    // ---- Whole section ----
    if (body?.chunkId) {
      const chunk = await prisma.deckChunk.findFirst({ where: { id: body.chunkId, deckId: id } });
      if (!chunk) return NextResponse.json({ error: "Section not found" }, { status: 404 });

      const others = await prisma.card.findMany({
        where: { deckId: id, NOT: { chunkId: chunk.id } },
        select: { front: true, back: true },
      });
      const generated = await generateCards(
        ai,
        { text: chunk.text, heading: chunk.heading, count: perChunk, instructions: instructions || undefined, language: deck.cardLanguage },
        "interactive"
      );
      const cards = dedupeCards(generated, others);
      if (!cards.length) return NextResponse.json({ error: "Generation returned no new cards" }, { status: 502 });

      await prisma.$transaction([
        prisma.card.deleteMany({ where: { deckId: id, chunkId: chunk.id } }),
        prisma.card.createMany({ data: cardRows(id, chunk, cards) }),
        prisma.deckChunk.update({ where: { id: chunk.id }, data: { status: "done" } }),
      ]);
      const fresh = await prisma.card.findMany({ where: { deckId: id, chunkId: chunk.id }, orderBy: { position: "asc" } });
      return NextResponse.json({ ok: true, cards: fresh });
    }

    return NextResponse.json({ error: "Provide cardId or chunkId" }, { status: 400 });
  } catch (err) {
    console.error("[regenerate] failed:", err);
    const status = err instanceof AiNotConfiguredError ? 409 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Regeneration failed — try again" }, { status });
  }
}
