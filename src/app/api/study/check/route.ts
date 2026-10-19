import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { checkAnswer, gradeForVerdict } from "@/lib/answer-check";
import { judgeAnswer, resolveAi } from "@/lib/ai";

/**
 * POST /api/study/check — grade a typed answer.
 * Body: { cardId, answer }
 * Fill-in-the-blank is checked locally (typos forgiven). Short answers get
 * a local check first; if it isn't sure, the AI judges the meaning.
 * Returns { verdict, feedback, expected, suggestedGrade, judgedBy }.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const cardId = String(body?.cardId ?? "");
  const answer = String(body?.answer ?? "").slice(0, 2000);

  const card = await prisma.card.findFirst({ where: { id: cardId, deck: { userId } } });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const local = checkAnswer(card.type, card.back, answer);
  let verdict = local.verdict;
  let feedback = "";
  let judgedBy: "local" | "ai" = "local";

  if (!local.confident) {
    const ai = await resolveAi(userId);
    if (ai && ai.kind !== "demo") {
      try {
        const j = await judgeAnswer(ai, card, answer);
        verdict = j.verdict;
        feedback = j.feedback;
        judgedBy = "ai";
      } catch (err) {
        console.warn("[check] AI judge failed, using local check:", err instanceof Error ? err.message : err);
      }
    }
  }
  if (!feedback) {
    feedback =
      verdict === "correct" ? "Nice — that matches." : verdict === "partial" ? "Close — compare with the full answer." : "Not quite — here's the answer.";
  }

  return NextResponse.json({
    verdict,
    feedback,
    expected: card.back,
    suggestedGrade: gradeForVerdict(verdict),
    judgedBy,
  });
}
