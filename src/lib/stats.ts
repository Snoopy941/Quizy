import { prisma } from "@/lib/db";
import { isMastered } from "@/lib/sm2";

/** End-of-day boundary for "due today" checks. */
export function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export interface DeckStats {
  total: number;
  new: number;
  learning: number;
  mastered: number;
  dueToday: number;
  masteryPct: number;
}

export async function getDeckStats(deckId: string): Promise<DeckStats> {
  const cards = await prisma.card.findMany({
    where: { deckId },
    select: { reps: true, intervalDays: true, dueDate: true },
  });
  const eod = endOfToday();
  const total = cards.length;
  const newCards = cards.filter((c) => c.reps === 0).length;
  const mastered = cards.filter((c) => isMastered(c.intervalDays)).length;
  const learning = total - newCards - mastered;
  const dueToday = cards.filter((c) => c.dueDate <= eod).length;
  return {
    total,
    new: newCards,
    learning,
    mastered,
    dueToday,
    masteryPct: total === 0 ? 0 : Math.round((mastered / total) * 100),
  };
}

export interface StudyQueueCard {
  id: string;
  front: string;
  back: string;
  type: string;
  options: string[] | null;
  difficulty: string;
  category: string;
  deckId: string;
  deckName: string;
  reps: number;
  intervalDays: number;
  dueDate: string | Date;
}

/** Cards due today (or all cards when reviewing ahead / empty deck). */
export async function getDueCards(userId: string, deckId?: string): Promise<StudyQueueCard[]> {
  const cards = await prisma.card.findMany({
    where: { deck: { userId }, ...(deckId ? { deckId } : {}) },
    orderBy: { dueDate: "asc" },
    include: { deck: { select: { name: true } } },
  });
  const eod = endOfToday();
  const due = cards.filter((c) => c.dueDate <= eod);
  const rest = cards.filter((c) => c.dueDate > eod);
  const ordered = [...due, ...rest];
  return ordered.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    type: c.type,
    options: c.options ? safeParse(c.options) : null,
    difficulty: c.difficulty,
    category: c.category,
    deckId: c.deckId,
    deckName: c.deck.name,
    reps: c.reps,
    intervalDays: c.intervalDays,
    dueDate: c.dueDate,
  }));
}

function safeParse(json: string): string[] | null {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Consecutive-day streak ending today or yesterday. */
export async function getStreak(userId: string): Promise<number> {
  const sessions = await prisma.studySession.findMany({
    where: { userId, status: { not: "abandoned" }, cardsReviewed: { gt: 0 } },
    select: { startedAt: true },
    orderBy: { startedAt: "desc" },
    take: 400,
  });
  const days = new Set(
    sessions.map((s) => {
      const d = new Date(s.startedAt);
      d.setHours(12, 0, 0, 0); // noon anchor avoids DST edges
      return d.toISOString().slice(0, 10);
    })
  );
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const dayMs = 86_400_000;
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Streak counts if studied today, or yesterday (streak still alive until midnight)
  let cursor = days.has(iso(today)) ? new Date(today) : new Date(today.getTime() - dayMs);
  if (!days.has(iso(cursor))) return 0;
  let streak = 0;
  while (days.has(iso(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - dayMs);
  }
  return streak;
}

/** Reviews per day for the last N days (inclusive of today). */
export async function getDailyReviews(userId: string, days: number): Promise<{ date: string; count: number }[]> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  const cards = await prisma.sessionCard.findMany({
    where: { session: { userId }, reviewedAt: { gte: since }, grade: { not: "skip" } },
    select: { reviewedAt: true },
  });
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const c of cards) {
    const key = new Date(c.reviewedAt).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

/** Per-category mastery for a deck. */
export async function getCategoryMastery(deckId: string): Promise<{ category: string; total: number; mastered: number; pct: number }[]> {
  const cards = await prisma.card.findMany({
    where: { deckId },
    select: { category: true, intervalDays: true },
  });
  const byCat = new Map<string, { total: number; mastered: number }>();
  for (const c of cards) {
    const entry = byCat.get(c.category) ?? { total: 0, mastered: 0 };
    entry.total += 1;
    if (isMastered(c.intervalDays)) entry.mastered += 1;
    byCat.set(c.category, entry);
  }
  return [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      total: v.total,
      mastered: v.mastered,
      pct: v.total ? Math.round((v.mastered / v.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
