import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { endOfToday } from "@/lib/stats";
import { isMastered } from "@/lib/fsrs";
import { LibraryClient } from "./LibraryClient";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) return null;

  const decks = await prisma.deck.findMany({
    where: { userId: payload.userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    include: {
      cards: { select: { intervalDays: true, dueDate: true } },
    },
  });

  const eod = endOfToday();
  const decksOut = decks.map((d) => {
    const total = d.cards.length;
    const mastered = d.cards.filter((c) => isMastered(c.intervalDays)).length;
    const dueToday = d.cards.filter((c) => c.dueDate <= eod).length;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      pinned: d.pinned,
      shareId: d.shareId,
      genStatus: d.genStatus,
      genProgress: d.genProgress,
      genError: d.genError,
      lastStudiedAt: d.lastStudiedAt?.toISOString() ?? null,
      totalCards: total,
      dueToday,
      masteryPct: total === 0 ? 0 : Math.round((mastered / total) * 100),
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Library</h1>
          <p className="mt-0.5 text-sm text-dim">{decksOut.length} deck{decksOut.length === 1 ? "" : "s"}</p>
        </div>
        <Link href="/library/new" className="btn-primary">+ New deck</Link>
      </div>
      <LibraryClient decks={decksOut} />
    </div>
  );
}
