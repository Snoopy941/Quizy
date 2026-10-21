import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { isGenerating, startDeckGeneration } from "@/lib/generate";
import { resolveAi } from "@/lib/ai";

/** POST /api/decks/:id/generate — (re)generate cards. Body: { reprocess?: boolean } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  if (deck.sourceType === "anki" || !deck.pdfUrl) {
    return NextResponse.json({ error: "This deck has no source file to generate from." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const reprocess = Boolean(body?.reprocess);

  if (isGenerating(id)) {
    return NextResponse.json(
      { ok: false, error: "Generation already in progress", genStatus: deck.genStatus },
      { status: 409 }
    );
  }
  if (!(await resolveAi(userId))) {
    return NextResponse.json(
      { error: "AI isn't set up yet. Open Settings, then AI, and add an API key.", code: "ai_not_configured" },
      { status: 409 }
    );
  }

  await prisma.deck.update({
    where: { id },
    data: { genStatus: "extracting", genProgress: 1, genError: null },
  });
  startDeckGeneration(id, { reprocess });
  return NextResponse.json({ ok: true, genStatus: "extracting" });
}
