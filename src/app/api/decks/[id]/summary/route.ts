import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { requireAi, summarizeSection, AiNotConfiguredError } from "@/lib/ai";

/** GET /api/decks/:id/summary — the deck's sections with any summaries written so far. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  const sections = await prisma.deckChunk.findMany({
    where: { deckId: id },
    orderBy: { position: "asc" },
    select: { id: true, heading: true, pageStart: true, pageEnd: true, summary: true },
  });
  return NextResponse.json({ deck: { id: deck.id, name: deck.name, sourceType: deck.sourceType }, sections });
}

/** POST /api/decks/:id/summary — { chunkId, force? } write (or rewrite) one section's summary. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const chunk = await prisma.deckChunk.findFirst({ where: { id: String(body?.chunkId ?? ""), deckId: id } });
  if (!chunk) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  if (chunk.summary && !body?.force) return NextResponse.json({ summary: chunk.summary });
  try {
    const ai = await requireAi(userId);
    if (ai.kind === "demo") return NextResponse.json({ error: "Summaries need a real AI (Settings → AI)." }, { status: 409 });
    const summary = await summarizeSection(ai, chunk.heading, chunk.text, deck.cardLanguage);
    await prisma.deckChunk.update({ where: { id: chunk.id }, data: { summary } });
    return NextResponse.json({ summary });
  } catch (err) {
    const status = err instanceof AiNotConfiguredError ? 409 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Summary failed" }, { status });
  }
}
