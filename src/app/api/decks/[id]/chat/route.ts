import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { chatWithDocument, requireAi, AiNotConfiguredError } from "@/lib/ai";
import { rankPassages } from "@/lib/retrieve";
import { pageLabel } from "@/lib/format";

/**
 * POST /api/decks/:id/chat — ask a question about the deck's source document.
 * Body: { question, history?: {role, content}[] }
 * Finds the most relevant sections and answers with page citations.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const question = String(body?.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "Ask a question first" }, { status: 400 });
  const history = Array.isArray(body?.history)
    ? (body.history as { role?: string; content?: unknown }[])
        .filter((h) => typeof h?.content === "string")
        .map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), content: String(h.content) }))
    : [];

  const chunks = await prisma.deckChunk.findMany({
    where: { deckId: id },
    orderBy: { position: "asc" },
    select: { id: true, heading: true, text: true, pageStart: true, pageEnd: true },
  });
  let passages: { id: string; heading: string; text: string; pageStart: number | null; pageEnd: number | null }[] = chunks;
  if (!chunks.length) {
    // Imported/manual decks: answer from the cards themselves.
    const cards = await prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" }, take: 400 });
    passages = cards.map((c) => ({ id: c.id, heading: c.category, text: `${c.front} — ${c.back}`, pageStart: null, pageEnd: null }));
  }
  // Use the previous question too, so follow-ups like "why?" still find the right sections.
  const lastUser = [...history].reverse().find((h) => h.role === "user")?.content ?? "";
  const ranked = rankPassages(`${question} ${lastUser}`, passages, 4);
  const picked = ranked.length ? ranked.map((r) => r.passage) : passages.slice(0, 2);

  try {
    const ai = await requireAi(userId);
    if (ai.kind === "demo") {
      return NextResponse.json({ error: "Chat needs a real AI — turn on the built-in AI or add an API key in Settings → AI." }, { status: 409 });
    }
    const where = (p: { pageStart: number | null; pageEnd: number | null }) =>
      p.pageStart ? (p.pageEnd && p.pageEnd !== p.pageStart ? `${pageLabel(deck.sourceType, p.pageStart)}–${p.pageEnd}` : pageLabel(deck.sourceType, p.pageStart)) : null;
    const answer = await chatWithDocument(
      ai,
      question,
      picked.map((p) => ({ heading: p.heading, text: p.text, where: where(p) })),
      history,
      deck.cardLanguage
    );
    return NextResponse.json({
      answer,
      sources: picked.map((p) => ({ heading: p.heading, where: where(p), page: p.pageStart })),
    });
  } catch (err) {
    const status = err instanceof AiNotConfiguredError ? 409 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chat failed" }, { status });
  }
}
