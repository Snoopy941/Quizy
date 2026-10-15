import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

async function ownedDeck(req: NextRequest, deckId: string) {
  const userId = await getUserId(req);
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } });
  if (!deck) return { error: NextResponse.json({ error: "Deck not found" }, { status: 404 }) as NextResponse };
  return { deck };
}

const CARD_TYPES = ["definition", "fill-blank", "mc", "true-false", "short-answer"];
const DIFFICULTIES = ["easy", "medium", "hard"];

/** GET /api/decks/:id/cards — all cards in order. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { deck, error } = await ownedDeck(req, id);
  if (error || !deck) return error!;
  const cards = await prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" } });
  return NextResponse.json({ cards });
}

/** POST /api/decks/:id/cards — manually add a card. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { deck, error } = await ownedDeck(req, id);
  if (error || !deck) return error!;

  const body = await req.json().catch(() => null);
  const front = String(body?.front ?? "").trim();
  const back = String(body?.back ?? "").trim();
  if (!front || !back) {
    return NextResponse.json({ error: "Front and back are required" }, { status: 400 });
  }
  const type = CARD_TYPES.includes(body?.type) ? body.type : "definition";
  const difficulty = DIFFICULTIES.includes(body?.difficulty) ? body.difficulty : "medium";
  const options = Array.isArray(body?.options)
    ? body.options.filter((o: unknown) => typeof o === "string").slice(0, 4)
    : null;

  const maxPos = await prisma.card.aggregate({ where: { deckId: id }, _max: { position: true } });
  const card = await prisma.card.create({
    data: {
      deckId: id,
      front: front.slice(0, 2000),
      back: back.slice(0, 4000),
      type,
      options: options ? JSON.stringify(options) : null,
      difficulty,
      category: String(body?.category ?? "Manual").trim().slice(0, 80) || "Manual",
      position: (maxPos._max.position ?? 0) + 10,
    },
  });
  return NextResponse.json({ ok: true, card }, { status: 201 });
}

/** PUT /api/decks/:id/cards — reorder: { order: [cardId, ...] }. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { deck, error } = await ownedDeck(req, id);
  if (error || !deck) return error!;

  const body = await req.json().catch(() => null);
  const order: unknown = body?.order;
  if (!Array.isArray(order) || !order.length) {
    return NextResponse.json({ error: "order array is required" }, { status: 400 });
  }

  const updates = order.map((cardId, idx) =>
    prisma.card.updateMany({
      where: { id: String(cardId), deckId: id },
      data: { position: idx * 10 },
    })
  );
  await prisma.$transaction(updates);
  return NextResponse.json({ ok: true });
}
