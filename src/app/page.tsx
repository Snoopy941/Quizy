import Link from "next/link";
import { prisma } from "@/lib/db";
import { getStreak, getDailyReviews, endOfToday } from "@/lib/stats";
import { isMastered } from "@/lib/fsrs";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { StreakFlame } from "@/components/StreakFlame";
import { resolveAi } from "@/lib/ai";

async function requireUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) return null;
  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, name: true, email: true, createdAt: true },
  });
}

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  if (!user) return null;

  const [decks, streak, daily] = await Promise.all([
    prisma.deck.findMany({
      where: { userId: user.id },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      include: { cards: { select: { reps: true, dueDate: true, intervalDays: true } } },
    }),
    getStreak(user.id),
    getDailyReviews(user.id, 14),
  ]);

  const eod = endOfToday();
  let dueToday = 0;
  let totalCards = 0;
  for (const d of decks) {
    dueToday += d.cards.filter((c) => c.dueDate <= eod).length;
    totalCards += d.cards.length;
  }
  const mastered = decks.reduce((acc, d) => acc + d.cards.filter((c) => isMastered(c.intervalDays)).length, 0);
  const hasDecks = decks.length > 0;
  const anySession = await prisma.studySession.findFirst({ where: { userId: user.id }, select: { id: true } });
  const ai = await resolveAi(user.id);

  const firstName = user.name?.split(" ")[0] || user.email.split("@")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      {/* Greeting + streak */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{greeting}, {firstName}</h1>
          <p className="mt-1 text-sm text-dim">
            {dueToday > 0
              ? `You have ${dueToday} card${dueToday === 1 ? "" : "s"} ready for review.`
              : hasDecks
                ? "All caught up — nice work."
                : "Add your first study material to get started."}
          </p>
        </div>
        <StreakFlame streak={streak} />
      </div>

      {/* Primary CTA */}
      <div className="card relative overflow-hidden p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="badge mb-3">Today's Review</div>
            <div className="text-4xl font-extrabold tabular-nums md:text-5xl">{dueToday}</div>
            <p className="mt-1 text-sm text-dim">cards due across {decks.length} deck{decks.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
            <Link href="/review" className="btn-primary">
              Start review →
            </Link>
            <Link href="/library/new" className="btn-secondary">
              + New deck
            </Link>
          </div>
        </div>
      </div>

      {/* Onboarding checklist */}
      {!ai ? (
        <div className="card flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold">Set up AI to make cards</p>
            <p className="mt-0.5 text-xs text-dim">Turn on the built-in offline AI or add an API key — it takes a few seconds.</p>
          </div>
          <Link href="/settings" className="btn-secondary shrink-0">
            Open Settings →
          </Link>
        </div>
      ) : null}

      {!anySession || !hasDecks ? (
        <div className="card p-6">
          <h2 className="mb-4 font-semibold">Get started with Quizy</h2>
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <Check done /> Create your account
            </li>
            <li className="flex items-center gap-3">
              <Check done={hasDecks} /> Add a PDF, slides or notes and generate your first deck
              {!hasDecks ? <a href="/library/new" className="ml-auto text-dim underline underline-offset-4">Start</a> : null}
            </li>
            <li className="flex items-center gap-3">
              <Check done={Boolean(anySession)} /> Take a 5-card practice session
              {!anySession && hasDecks ? <a href="/review" className="ml-auto text-dim underline underline-offset-4">Start</a> : null}
            </li>
          </ol>
        </div>
      ) : null}

      {/* Recent decks */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Your decks</h2>
          {hasDecks ? <Link href="/library" className="text-sm text-dim hover:text-ink">View all →</Link> : null}
        </div>
        {hasDecks ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {decks.slice(0, 6).map((d) => {
              const due = d.cards.filter((c) => c.dueDate <= eod).length;
              return (
                <Link key={d.id} href={`/deck/${d.id}`} className="card p-5 transition-colors hover:border-dim">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-snug">{d.name}</h3>
                    {d.pinned ? <span className="badge">★</span> : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-faint">
                    <span>{d.cards.length} cards</span>
                    <span>·</span>
                    <span>{due > 0 ? <span className="text-ink">{due} due</span> : "no due cards"}</span>
                  </div>
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface2">
                    <div className="h-full bg-accent" style={{ width: `${d.cards.length ? Math.round((d.cards.filter((c) => isMastered(c.intervalDays)).length / d.cards.length) * 100) : 0}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <svg className="h-10 w-10 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
            </svg>
            <p className="text-sm text-dim">No decks yet. Add a PDF, Word or PowerPoint file, or paste notes, and Quizy will make the cards.</p>
            <Link href="/library/new" className="btn-primary mt-2">Create a deck</Link>
          </div>
        )}
      </section>

      {/* 14-day activity */}
      {hasDecks ? <MiniChart daily={daily} /> : null}
    </div>
  );
}

function Check({ done }: { done: boolean }) {
  return done ? (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-bg">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </span>
  ) : (
    <span className="h-5 w-5 rounded-full border border-line" />
  );
}

function MiniChart({ daily }: { daily: { date: string; count: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return (
    <section className="card p-6">
      <h2 className="mb-4 font-semibold">Last 14 days</h2>
      <div className="flex h-24 items-end gap-1.5">
        {daily.map((d) => (
          <div key={d.date} className="group relative flex-1">
            <div
              className="w-full rounded-t-sm bg-accent/70 transition-all group-hover:bg-accent"
              style={{ height: `${Math.max(3, (d.count / max) * 96)}px` }}
              title={`${d.count} reviews on ${d.date}`}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-faint">Reviews per day</p>
    </section>
  );
}
