import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getDeckStats, getDailyReviews, getCategoryMastery } from "@/lib/stats";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DeckStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) return null;

  const deck = await prisma.deck.findFirst({ where: { id, userId: payload.userId } });
  if (!deck) {
    return (
      <div className="card p-10 text-center">
        <h1 className="font-bold">Deck not found</h1>
        <p className="mt-2 text-sm text-dim">It may have been deleted.</p>
      </div>
    );
  }

  const [stats, daily, categories, sessions] = await Promise.all([
    getDeckStats(id),
    getDailyReviews(payload.userId, 30),
    getCategoryMastery(id),
    prisma.studySession.findMany({
      where: { userId: payload.userId, deckId: id },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        mode: true,
        status: true,
        startedAt: true,
        cardsReviewed: true,
        correctCount: true,
        timeSpentSeconds: true,
      },
    }),
  ]);

  const max = Math.max(1, ...daily.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{deck.name} — Stats</h1>
        <p className="mt-1 text-sm text-dim">Progress and history for this deck.</p>
      </div>

      {/* counts */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Total cards" value={stats.total} />
        <StatTile label="Due today" value={stats.dueToday} />
        <StatTile label="New" value={stats.new} />
        <StatTile label="Learning" value={stats.learning} />
        <StatTile label="Mastered" value={stats.mastered} />
      </div>

      {/* 30-day chart */}
      <section className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Reviews per day</h2>
          <span className="text-xs text-faint">last 30 days</span>
        </div>
        <div className="flex h-28 items-end gap-1">
          {daily.map((d) => (
            <div key={d.date} className="group relative flex-1">
              <div
                className="w-full rounded-t-sm bg-accent/70 transition-all group-hover:bg-accent"
                style={{ height: `${Math.max(3, (d.count / max) * 112)}px` }}
                title={`${d.count} reviews · ${d.date}`}
              />
            </div>
            ))}
        </div>
        <p className="mt-3 text-xs text-faint">
          Total: {daily.reduce((a, d) => a + d.count, 0)} reviews
        </p>
      </section>

      {/* category mastery */}
      <section className="card p-6">
        <h2 className="mb-4 font-semibold">Mastery by category</h2>
        {categories.length === 0 ? (
          <p className="text-sm text-dim">No cards yet.</p>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => (
              <div key={cat.category}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="truncate text-dim">{cat.category}</span>
                  <span className="tabular-nums text-faint">
                    {cat.mastered}/{cat.total} · {cat.pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${cat.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* session history */}
      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-semibold">Recent sessions</h2>
        </div>
        {sessions.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-dim">No study sessions yet — start one from the deck page.</p>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-6 py-3.5 text-sm">
                <div>
                  <p className="font-medium">
                    {fmtDate(s.startedAt)}{" "}
                    <span className="text-xs text-faint">
                      {new Date(s.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </p>
                  <p className="text-xs text-faint">
                    {s.mode === "timed" ? "Timed" : "Study"} · {s.status === "abandoned" ? "abandoned" : "completed"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular-nums">
                    {s.cardsReviewed} cards ·{" "}
                    {s.cardsReviewed ? Math.round((s.correctCount / s.cardsReviewed) * 100) : 0}%
                  </p>
                  <p className="text-xs text-faint">{Math.round(s.timeSpentSeconds / 60)} min</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-dim">{label}</div>
    </div>
  );
}
