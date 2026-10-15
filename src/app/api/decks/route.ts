import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { endOfToday } from "@/lib/stats";
import { isMastered } from "@/lib/sm2";
import { startDeckGeneration, uploadDir } from "@/lib/generate";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

/** GET /api/decks — library list with per-deck stats. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const decks = await prisma.deck.findMany({
    where: { userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    include: {
      cards: { select: { intervalDays: true, reps: true, dueDate: true } },
    },
  });

  const eod = endOfToday();
  const out = decks.map((d) => {
    const total = d.cards.length;
    const mastered = d.cards.filter((c) => isMastered(c.intervalDays)).length;
    const dueToday = d.cards.filter((c) => c.dueDate <= eod).length;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      pinned: d.pinned,
      shareId: d.shareId,
      genStatus: d.genStatus,
      genProgress: d.genProgress,
      genError: d.genError,
      lastStudiedAt: d.lastStudiedAt,
      createdAt: d.createdAt,
      totalCards: total,
      dueToday,
      masteryPct: total === 0 ? 0 : Math.round((mastered / total) * 100),
    };
  });
  return NextResponse.json({ decks: out });
}

/** POST /api/decks — multipart upload: create deck from a PDF. */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
  }
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "PDF is larger than 50MB" }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim() || file.name.replace(/\.pdf$/i, "").slice(0, 100) || "Untitled deck";
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  const instructions = String(form.get("instructions") ?? "").trim().slice(0, 500);
  const density = ["low", "medium", "high"].includes(String(form.get("density")))
    ? String(form.get("density"))
    : "medium";

  // Save PDF to disk
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const safeBase = file.name.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9-_ ]/g, "_").slice(0, 60) || "upload";
  const diskName = `${Date.now()}-${safeBase}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, diskName), buffer);

  const deck = await prisma.deck.create({
    data: {
      userId,
      name,
      description,
      instructions,
      density,
      pdfUrl: `/api/files/${diskName}`,
      genStatus: "extracting",
      genProgress: 1,
    },
  });

  startDeckGeneration(deck.id);
  return NextResponse.json({ ok: true, deck: { id: deck.id, name: deck.name } }, { status: 201 });
}
