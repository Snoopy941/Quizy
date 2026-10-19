import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { uploadDir } from "@/lib/generate";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };

/**
 * GET /api/images/:name — figures extracted from a deck's source ("fig-<deckId>-…")
 * and images attached to cards ("card-<cardId>-…"), for their owner only.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const { name } = await ctx.params;
  const m = name.match(/^(fig|card)-([a-z0-9]+)-[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp|bmp)$/i);
  if (!m) return NextResponse.json({ error: "Invalid image name" }, { status: 400 });
  const owned =
    m[1] === "fig"
      ? await prisma.deck.findFirst({ where: { id: m[2], userId }, select: { id: true } })
      : await prisma.card.findFirst({ where: { id: m[2], deck: { userId } }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = path.join(uploadDir(), name);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "Image missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "Content-Type": TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
