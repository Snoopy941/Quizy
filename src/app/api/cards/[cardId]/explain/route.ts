import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { explainCard, requireAi, AiNotConfiguredError } from "@/lib/ai";

/**
 * POST /api/cards/:cardId/explain — the AI tutor explains a card, using the
 * section of the source it came from. Supports follow-up questions.
 * Body: { question?: string, history?: { role: "user"|"assistant", content }[] }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { chunk: { select: { text: true } }, deck: { select: { cardLanguage: true } } },
  });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question : undefined;
  const history = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter((h): h is { role: string; content: string } => !!h && typeof (h as { content?: unknown }).content === "string")
        .map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), content: h.content }))
    : [];

  try {
    const ai = await requireAi(userId);
    if (ai.kind === "demo") {
      return NextResponse.json({ error: "Explanations need a real AI — turn on the built-in AI or add an API key in Settings → AI." }, { status: 409 });
    }
    const answer = await explainCard(ai, card, card.chunk?.text ?? null, history, question, card.deck.cardLanguage);
    return NextResponse.json({ answer });
  } catch (err) {
    const status = err instanceof AiNotConfiguredError ? 409 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't get an explanation" }, { status });
  }
}
