import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { sm2, type Grade } from "@/lib/sm2";

const GRADES = new Set<Grade>(["again", "hard", "good", "easy"]);

/**
 * POST /api/study/grade
 * Body: { cardId, grade, sessionId?, timeSpentSeconds?, timed?: boolean, deckId?: string }
 *
 * Persists immediately so a closed browser loses nothing:
 * - upserts an active session (single-user-per-active-session per deck scope)
 * - appends a SessionCard row
 * - applies SM-2 to the card
 * - stamps deck.lastStudiedAt
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const body = await req.json().catch(() => null);
  const cardId = String(body?.cardId ?? "");
  const grade = String(body?.grade ?? "") as Grade;
  const timeSpent = Math.max(0, Math.min(3600, Number(body?.timeSpentSeconds ?? 0) || 0));
  const timed = Boolean(body?.timed);
  const deckId = typeof body?.deckId === "string" ? body.deckId : undefined;

  if (!cardId || !GRADES.has(grade)) {
    return NextResponse.json({ error: "cardId and a valid grade are required" }, { status: 400 });
  }

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    include: { deck: { select: { id: true } } },
  });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const result = sm2(
    {
      easeFactor: card.easeFactor,
      intervalDays: card.intervalDays,
      reps: card.reps,
      lapses: card.lapses,
    },
    grade
  );

  // Find or create the active session
  let sessionId: string | null = typeof body?.sessionId === "string" ? body.sessionId : null;
  if (sessionId) {
    const session = await prisma.studySession.findFirst({ where: { id: sessionId, userId } });
    if (!session) sessionId = null;
  }
  if (!sessionId) {
    const existing = await prisma.studySession.findFirst({
      where: { userId, status: "active", deckId: timed ? null : (card.deck.id ?? deckId ?? null) },
      orderBy: { startedAt: "desc" },
    });
    // Sessions from a previous day are stale — close them and start fresh
    // so an abandoned session doesn't absorb the next day's reviews.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (existing && existing.startedAt >= startOfToday) {
      sessionId = existing.id;
    } else {
      if (existing) {
        await prisma.studySession.update({
          where: { id: existing.id },
          data: { status: "completed", endedAt: new Date() },
        });
      }
      const created = await prisma.studySession.create({
        data: {
          userId,
          deckId: timed ? null : card.deck.id,
          mode: timed ? "timed" : "normal",
          timerMinutes: timed ? Number(body?.timerMinutes) || null : null,
        },
      });
      sessionId = created.id;
    }
  }

  const [, , updatedCard] = await prisma.$transaction([
    prisma.sessionCard.create({
      data: {
        sessionId,
        cardId: card.id,
        grade,
        timeSpentSeconds: Math.round(timeSpent),
        correct: result.correct,
      },
    }),
    prisma.studySession.update({
      where: { id: sessionId },
      data: {
        cardsReviewed: { increment: 1 },
        correctCount: result.correct ? { increment: 1 } : undefined,
        timeSpentSeconds: { increment: Math.round(timeSpent) },
      },
    }),
    prisma.card.update({
      where: { id: card.id },
      data: {
        easeFactor: result.easeFactor,
        intervalDays: result.intervalDays,
        dueDate: result.dueDate,
        reps: result.reps,
        lapses: result.lapses,
        timesSeen: { increment: 1 },
        timesFailed: result.correct ? undefined : { increment: 1 },
      },
    }),
    prisma.deck.update({
      where: { id: card.deck.id },
      data: { lastStudiedAt: new Date() },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    sessionId,
    correct: result.correct,
    card: {
      id: updatedCard.id,
      easeFactor: updatedCard.easeFactor,
      intervalDays: updatedCard.intervalDays,
      dueDate: updatedCard.dueDate,
      reps: updatedCard.reps,
      lapses: updatedCard.lapses,
    },
  });
}
