import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { requireAi, reviewCards, AiNotConfiguredError } from "@/lib/ai";
import { localCardIssues } from "@/lib/quality";

const BATCH = 10;

/**
 * POST /api/decks/:id/review — card quality check, one batch at a time.
 * Body: { offset } → { issues, nextOffset, total }
 * The first call (offset 0) also includes fast local checks (duplicates,
 * answer given away in the question, overly long cards) across the deck.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Number(body?.offset) || 0);

  const cards = await prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" } });
  const issues: { cardId: string; front: string; back: string; problem: string; source: "check" | "ai"; suggestion: { front: string; back: string } | null }[] = [];

  if (offset === 0) {
    for (const i of localCardIssues(cards)) {
      const c = cards.find((x) => x.id === i.cardId)!;
      issues.push({ cardId: c.id, front: c.front, back: c.back, problem: i.problem, source: "check", suggestion: null });
    }
  }

  const batch = cards.slice(offset, offset + BATCH);
  if (batch.length) {
    try {
      const ai = await requireAi(userId);
      if (ai.kind !== "demo") {
        for (const r of await reviewCards(ai, batch, deck.cardLanguage)) {
          const c = batch[r.n];
          const same = r.front.trim() === c.front.trim() && r.back.trim() === c.back.trim();
          issues.push({ cardId: c.id, front: c.front, back: c.back, problem: r.problem, source: "ai", suggestion: same ? null : { front: r.front, back: r.back } });
        }
      }
    } catch (err) {
      const status = err instanceof AiNotConfiguredError ? 409 : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Review failed", issues }, { status });
    }
  }
  const nextOffset = offset + BATCH < cards.length ? offset + BATCH : null;
  return NextResponse.json({ issues, nextOffset, total: cards.length });
}
