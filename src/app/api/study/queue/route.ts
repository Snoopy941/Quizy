import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { getDueCards } from "@/lib/stats";

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * GET /api/study/queue?deckId=...&shuffle=1&limit=40&includeAll=0
 * Returns ordered study cards. Due cards first; new cards (reps=0) woven in;
 * not-yet-due cards only when includeAll=1 or nothing is due.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const deckId = sp.get("deckId") || undefined;
  const shuffle = sp.get("shuffle") !== "0";
  const includeAll = sp.get("includeAll") === "1";
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 40) || 40));

  const cards = await getDueCards(userId, deckId);
  const eod = endOfTodayLocal();

  const due = cards.filter((c) => c.reps > 0 && new Date(c.dueDate) <= eod);
  const fresh = cards.filter((c) => c.reps === 0);
  const ahead = cards.filter((c) => c.reps > 0 && new Date(c.dueDate) > eod);

  let ordered = [...due, ...fresh];
  if (!ordered.length && includeAll) ordered = ahead;

  if (shuffle && ordered.length > 1) {
    const rand = mulberry32(Date.now() % 2147483647);
    // Fisher–Yates
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  const finalCards = ordered.slice(0, limit).map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    type: c.type,
    options: c.options,
    difficulty: c.difficulty,
    category: c.category,
    deckId: c.deckId,
    deckName: c.deckName,
    reps: c.reps,
  }));

  return NextResponse.json({
    cards: finalCards,
    dueCount: due.length,
    newCount: fresh.length,
    totalAvailable: cards.length,
  });
}

function endOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
