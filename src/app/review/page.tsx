import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { StudySessionClient } from "@/app/deck/[id]/study/StudySessionClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) return null;

  // null deckId = cross-deck queue
  return <StudySessionClient deckId={null} timedMinutes={null} />;
}
