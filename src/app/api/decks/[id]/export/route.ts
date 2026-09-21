import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

/** GET /api/decks/:id/export?format=csv|json */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const cards = await prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" } });
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const safeName = deck.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "deck";

  if (format === "json") {
    const payload = {
      name: deck.name,
      description: deck.description,
      exportedAt: new Date().toISOString(),
      cards: cards.map((c) => ({
        front: c.front,
        back: c.back,
        type: c.type,
        options: c.options ? JSON.parse(c.options) : undefined,
        difficulty: c.difficulty,
        category: c.category,
      })),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${safeName}.json"`,
      },
    });
  }

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [["front", "back", "type", "difficulty", "category"].join(",")];
  for (const c of cards) {
    rows.push([esc(c.front), esc(c.back), esc(c.type), esc(c.difficulty), esc(c.category)].join(","));
  }
  return new NextResponse("\uFEFF" + rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.csv"`,
    },
  });
}
