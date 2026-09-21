import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { getStreak, getDailyReviews, endOfToday } from "@/lib/stats";
import { isMastered } from "@/lib/sm2";

/** GET /api/stats — cross-deck dashboard data. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const [user, decks, streak, daily] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, createdAt: true } }),
    prisma.deck.findMany({
      where: { userId },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      include: { cards: { select: { reps: true, dueDate: true, intervalDays: true } } },
    }),
    getStreak(userId),
    getDailyReviews(userId, 30),
  ]);

  const eod = endOfToday();
  let dueToday = 0;
  let totalCards = 0;
  const deckSummaries = decks.map((d) => {
    const due = d.cards.filter((c) => c.dueDate <= eod).length;
    dueToday += due;
    totalCards += d.cards.length;
    const mastered = d.cards.filter((c) => isMastered(c.intervalDays)).length;
    return {
      id: d.id,
      name: d.name,
      pinned: d.pinned,
      totalCards: d.cards.length,
      dueToday: due,
      masteryPct: d.cards.length ? Math.round((mastered / d.cards.length) * 100) : 0,
      lastStudiedAt: d.lastStudiedAt,
      genStatus: d.genStatus,
      updatedAt: d.updatedAt,
    };
  });

  const hasAnySession = await prisma.studySession.findFirst({ where: { userId }, select: { id: true } });
  const onboarding = {
    accountCreated: true,
    firstDeck: decks.length > 0,
    firstSession: Boolean(hasAnySession),
  };

  return NextResponse.json({
    user,
    streak,
    dueToday,
    totalCards,
    deckCount: decks.length,
    recentDecks: deckSummaries.slice(0, 6),
    daily,
    onboarding,
  });
}
