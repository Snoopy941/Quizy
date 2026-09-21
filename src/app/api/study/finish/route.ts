import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

/**
 * POST /api/study/finish
 * Body: { sessionId, abandon?: boolean }
 * Marks the session completed (or abandoned) and returns a summary:
 * reviewed count, accuracy, time, weakest categories.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const sessionId = String(body?.sessionId ?? "");
  const abandon = Boolean(body?.abandon);
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const session = await prisma.studySession.findFirst({ where: { id: sessionId, userId } });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const sessionCards = await prisma.sessionCard.findMany({
    where: { sessionId },
    include: { card: { select: { category: true } } },
  });

  const graded = sessionCards.filter((sc) => sc.grade !== "skip");
  const correct = graded.filter((sc) => sc.correct).length;
  const timeSpent = sessionCards.reduce((acc, sc) => acc + sc.timeSpentSeconds, 0);

  const byCat = new Map<string, { seen: number; correct: number }>();
  for (const sc of graded) {
    const cat = sc.card?.category ?? "General";
    const entry = byCat.get(cat) ?? { seen: 0, correct: 0 };
    entry.seen += 1;
    if (sc.correct) entry.correct += 1;
    byCat.set(cat, entry);
  }
  const categoryStats = [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      seen: v.seen,
      accuracy: Math.round((v.correct / v.seen) * 100),
    }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  const summary = {
    sessionId: session.id,
    reviewed: sessionCards.length,
    graded: graded.length,
    correct,
    accuracy: graded.length ? Math.round((correct / graded.length) * 100) : 0,
    timeSpentSeconds: timeSpent || session.timeSpentSeconds,
    weakest: categoryStats,
  };

  if (session.status === "active") {
    await prisma.studySession.update({
      where: { id: sessionId },
      data: {
        status: abandon ? "abandoned" : "completed",
        endedAt: new Date(),
        cardsReviewed: sessionCards.length,
        correctCount: correct,
        timeSpentSeconds: summary.timeSpentSeconds,
      },
    });
  }

  return NextResponse.json({ ok: true, summary });
}
