import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { endOfToday } from "@/lib/stats";
import { isMastered } from "@/lib/fsrs";
import { startDeckGeneration, uploadDir } from "@/lib/generate";
import { looksLikeType, sourceTypeForName, type SourceType } from "@/lib/extract";
import { importApkg } from "@/lib/anki";
import { resolveAi } from "@/lib/ai";
import { CARD_LANGUAGES } from "@/lib/format";

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
      sourceType: d.sourceType,
      lastStudiedAt: d.lastStudiedAt,
      createdAt: d.createdAt,
      totalCards: total,
      dueToday,
      masteryPct: total === 0 ? 0 : Math.round((mastered / total) * 100),
    };
  });
  return NextResponse.json({ decks: out });
}

/**
 * POST /api/decks — create a deck. Multipart form:
 *   file: PDF, Word (.docx), PowerPoint (.pptx), text/Markdown, image (OCR),
 *         or an Anki deck (.apkg/.colpkg, imported directly — no AI needed)
 *   text: pasted notes (instead of a file)
 *   name, instructions, density
 */
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
  const pasted = String(form.get("text") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  const instructions = String(form.get("instructions") ?? "").trim().slice(0, 500);
  const cardLanguage = CARD_LANGUAGES[String(form.get("cardLanguage"))] ? String(form.get("cardLanguage")) : "auto";
  const ocrLanguage = /^[a-z_]{3,8}(\+[a-z_]{3,8})*$/.test(String(form.get("ocrLanguage"))) ? String(form.get("ocrLanguage")) : "eng";
  const density = ["low", "medium", "high"].includes(String(form.get("density")))
    ? String(form.get("density"))
    : "medium";

  let buffer: Buffer;
  let type: SourceType;
  let baseName: string;
  let ext: string;

  if (file instanceof File && file.size > 0) {
    const t = sourceTypeForName(file.name);
    if (!t) {
      return NextResponse.json(
        { error: "Unsupported file. Use PDF, Word, PowerPoint, text, an image, or an Anki deck." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "That file is larger than 50MB" }, { status: 413 });
    }
    buffer = Buffer.from(await file.arrayBuffer());
    if (!looksLikeType(buffer, t)) {
      return NextResponse.json({ error: `That file doesn't look like a valid ${path.extname(file.name)} file.` }, { status: 400 });
    }
    type = t;
    baseName = file.name.replace(/\.[^.]+$/, "");
    ext = path.extname(file.name).toLowerCase();
  } else if (pasted) {
    if (pasted.length < 40) {
      return NextResponse.json({ error: "Paste a bit more text — at least a paragraph." }, { status: 400 });
    }
    buffer = Buffer.from(pasted.slice(0, 2_000_000), "utf8");
    type = "text";
    baseName = name || pasted.split(/\n/)[0].replace(/^#+\s*/, "").slice(0, 60) || "Pasted notes";
    ext = ".txt";
  } else {
    return NextResponse.json({ error: "Choose a file or paste some text first." }, { status: 400 });
  }

  /* ---- Anki: import cards directly ---- */
  if (type === "anki") {
    let imported;
    try {
      imported = importApkg(buffer, baseName);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read that Anki deck" }, { status: 400 });
    }
    if (!imported.cards.length) {
      return NextResponse.json({ error: "No cards with text were found in that Anki deck." }, { status: 400 });
    }
    const deck = await prisma.deck.create({
      data: {
        userId,
        name: name || imported.name || "Imported deck",
        description: description || `Imported from Anki (${imported.cards.length} cards)`,
        instructions,
        density,
        sourceType: "anki",
        genStatus: "done",
        genProgress: 100,
      },
    });
    const rows = imported.cards.slice(0, 20000).map((c, i) => ({
      deckId: deck.id,
      front: c.front,
      back: c.back,
      type: c.type,
      category: c.category,
      position: i * 10,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.card.createMany({ data: rows.slice(i, i + 500) });
    }
    return NextResponse.json(
      { ok: true, deck: { id: deck.id, name: deck.name }, imported: rows.length, skipped: imported.skipped },
      { status: 201 }
    );
  }

  /* ---- Everything else: save the source, then generate in the background ---- */
  const ai = await resolveAi(userId);
  if (!ai) {
    return NextResponse.json(
      { error: "AI isn't set up yet — open Settings → AI to turn on the built-in AI or add an API key.", code: "ai_not_configured" },
      { status: 409 }
    );
  }

  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const safeBase = baseName.replace(/[^a-zA-Z0-9-_ ]/g, "_").slice(0, 60) || "upload";
  const diskName = `${Date.now()}-${safeBase}${ext}`;
  await fs.writeFile(path.join(dir, diskName), buffer);

  const deck = await prisma.deck.create({
    data: {
      userId,
      name: name || baseName.slice(0, 100) || "Untitled deck",
      description,
      instructions,
      density,
      pdfUrl: `/api/files/${diskName}`,
      sourceType: type,
      cardLanguage,
      ocrLanguage,
      genStatus: "extracting",
      genProgress: 1,
    },
  });

  startDeckGeneration(deck.id);
  return NextResponse.json({ ok: true, deck: { id: deck.id, name: deck.name } }, { status: 201 });
}
