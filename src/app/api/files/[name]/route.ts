import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { uploadDir } from "@/lib/generate";

/** GET /api/files/:name — serve an uploaded PDF to its owner. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const { name } = await ctx.params;
  if (!name || name.includes("..") || name.includes("/")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  const deck = await prisma.deck.findFirst({ where: { userId, pdfUrl: `/api/files/${name}` } });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = path.join(uploadDir(), name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
