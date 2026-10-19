import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { uploadDir } from "@/lib/generate";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".markdown": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/** Formats the browser can show inline; Office files download instead. */
const INLINE = new Set([".pdf", ".txt", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

/** GET /api/files/:name — serve an uploaded source file to its owner. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const { name } = await ctx.params;
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  const deck = await prisma.deck.findFirst({ where: { userId, pdfUrl: `/api/files/${name}` } });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = path.join(uploadDir(), name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
  const ext = path.extname(name).toLowerCase();
  const data = fs.readFileSync(filePath);
  const downloadName = name.replace(/^\d+-/, "");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `${INLINE.has(ext) ? "inline" : "attachment"}; filename="${downloadName}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
