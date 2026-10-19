import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { exportApkg } from "@/lib/anki";

/** GET /api/decks/:id/export?format=csv|json|apkg */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const cards = await prisma.card.findMany({ where: { deckId: id }, orderBy: { position: "asc" } });
  const fmt = req.nextUrl.searchParams.get("format");
  const format = fmt === "csv" ? "csv" : fmt === "apkg" ? "apkg" : "json";
  const safeName = deck.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "deck";

  if (format === "apkg") {
    try {
      const apkg = exportApkg(
        deck.name,
        cards.map((c) => ({
          front: c.front,
          back: c.back,
          type: c.type,
          options: c.options ? (JSON.parse(c.options) as string[]) : null,
          category: c.category,
        }))
      );
      return new NextResponse(new Uint8Array(apkg), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeName}.apkg"`,
        },
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Anki export failed" }, { status: 500 });
    }
  }

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
        sourcePage: c.sourcePage ?? undefined,
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
