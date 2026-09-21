import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { DeckDetail } from "./DeckDetail";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
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

  return <DeckDetail deckId={id} />;
}
