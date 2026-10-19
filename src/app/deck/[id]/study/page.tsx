import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { StudySessionClient } from "./StudySessionClient";

export const dynamic = "force-dynamic";

export default async function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) return null;

  const timedRaw = typeof sp.timed === "string" ? parseInt(sp.timed, 10) : NaN;
  const timed = [5, 10, 15, 30, 60].includes(timedRaw) ? timedRaw : null;

  const mode = sp.mode === "weak" ? "weak" : null;
  return <StudySessionClient deckId={id} timedMinutes={timed} mode={mode} />;
}
