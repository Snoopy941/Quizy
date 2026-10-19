import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { uploadDir } from "@/lib/generate";
import { looksLikeType } from "@/lib/extract";

const MAX = 8 * 1024 * 1024;

/** POST /api/cards/:cardId/image — attach an image (multipart "file") shown on the card's front. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const card = await prisma.card.findFirst({ where: { id: cardId, deck: { userId } } });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose an image" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "Images must be under 8MB" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!looksLikeType(buf, "image")) return NextResponse.json({ error: "That isn't a PNG, JPEG, BMP or WebP image" }, { status: 400 });
  const ext = buf[0] === 0x89 ? ".png" : buf[0] === 0xff ? ".jpg" : buf[0] === 0x42 ? ".bmp" : ".webp";
  const name = `card-${card.id}-${Date.now()}${ext}`;
  fs.mkdirSync(uploadDir(), { recursive: true });
  fs.writeFileSync(path.join(uploadDir(), name), buf);
  removeFile(card.imageUrl);
  const updated = await prisma.card.update({ where: { id: card.id }, data: { imageUrl: `/api/images/${name}` } });
  return NextResponse.json({ ok: true, imageUrl: updated.imageUrl });
}

/** DELETE — remove the card's image. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await ctx.params;
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const card = await prisma.card.findFirst({ where: { id: cardId, deck: { userId } } });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  removeFile(card.imageUrl);
  await prisma.card.update({ where: { id: card.id }, data: { imageUrl: null } });
  return NextResponse.json({ ok: true });
}

function removeFile(url: string | null) {
  const name = url?.split("/").pop();
  if (name && /^card-[a-z0-9]+-\d+\.\w+$/i.test(name)) fs.rmSync(path.join(uploadDir(), name), { force: true });
}
