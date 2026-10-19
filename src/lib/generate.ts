import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { chunkDocument, pageForQuote, type Chunk } from "@/lib/chunk";
import { extractSource, type SourceType } from "@/lib/extract";
import { generateCards, requireAi, AiNotConfiguredError, type AiConfig } from "@/lib/ai";
import { dedupeCards, type GeneratedCard } from "@/lib/card-parse";
import { extractPdfFigures, extractPptxFigures, type FigureMap } from "@/lib/figures";

/**
 * Deck generation pipeline:
 * extract (PDF/Word/PowerPoint/text/OCR) → page-aware chunks → AI cards per
 * chunk, several chunks in parallel → de-duplicate → save with source pages.
 *
 * Runs as a detached job; progress is persisted on the deck + chunks so the
 * client can poll, and interrupted runs resume on the next server start.
 */

const CARDS_PER_DENSITY: Record<string, number> = { low: 3, medium: 4, high: 5 };

export function cardsPerChunk(density: string | undefined | null): number {
  return CARDS_PER_DENSITY[density ?? "medium"] ?? 4;
}

async function setDeck(
  deckId: string,
  data: { genStatus?: string; genProgress?: number; genError?: string | null; aiSource?: string }
) {
  await prisma.deck.update({ where: { id: deckId }, data });
}

const g = globalThis as unknown as { __quizyRunning?: Set<string> };
const running: Set<string> = (g.__quizyRunning ??= new Set());

/** Kick off generation without awaiting completion. No-op if already running for this deck. */
export function startDeckGeneration(deckId: string, opts?: { reprocess?: boolean }) {
  if (running.has(deckId)) return;
  running.add(deckId);
  void runDeckGeneration(deckId, opts)
    .catch((err) => {
      console.error(`[gen] deck ${deckId} crashed:`, err);
      void setDeck(deckId, { genStatus: "error", genError: "Unexpected processing error" }).catch(() => {});
    })
    .finally(() => running.delete(deckId));
}

export function isGenerating(deckId: string): boolean {
  return running.has(deckId);
}

/** Resume decks left mid-generation by a restart or crash. Called once at server start. */
export async function resumeInterruptedGenerations() {
  const stuck = await prisma.deck.findMany({
    where: { genStatus: { in: ["extracting", "generating"] } },
    select: { id: true },
  });
  for (const d of stuck) {
    console.log(`[gen] resuming interrupted deck ${d.id}`);
    startDeckGeneration(d.id);
  }
}

export function serializePageMap(c: Chunk): string | null {
  return c.pageMap.length ? JSON.stringify(c.pageMap) : null;
}

export function parsePageMap(json: string | null | undefined): [number, number][] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as [number, number][]) : [];
  } catch {
    return [];
  }
}

/** Card rows ready for prisma.card.createMany, with source pages resolved. */
export function cardRows(
  deckId: string,
  chunk: { id: string; position: number; text: string; pageMap: string | null; pageStart: number | null },
  cards: GeneratedCard[],
  startIndex = 0
) {
  const pm = { text: chunk.text, pageMap: parsePageMap(chunk.pageMap), pageStart: chunk.pageStart };
  return cards.map((c, i) => ({
    deckId,
    chunkId: chunk.id,
    front: c.front,
    back: c.back,
    type: c.type,
    options: c.options ? JSON.stringify(c.options) : null,
    difficulty: c.difficulty,
    category: c.category,
    position: chunk.position * 100 + startIndex + i,
    sourcePage: pageForQuote(c.source, pm),
    sourceQuote: c.source ?? null,
  }));
}

function emptyTextMessage(type: string, ocr: boolean): string {
  if (type === "image") return "Couldn't read any text in this image. Try a sharper, well-lit photo.";
  if (ocr) return "Couldn't read any text from this scanned PDF, even with OCR. Try a clearer scan, or add cards manually.";
  if (type === "pdf") return "No text found in this PDF. Try another file, or add cards manually.";
  return "This file has no text to make cards from.";
}

export async function runDeckGeneration(deckId: string, opts?: { reprocess?: boolean }) {
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck) return;

  let ai: AiConfig;
  try {
    ai = await requireAi(deck.userId);
  } catch (err) {
    await setDeck(deckId, {
      genStatus: "error",
      genError: err instanceof Error ? err.message : new AiNotConfiguredError().message,
    });
    return;
  }

  try {
    // Extract on first run (no chunks yet) or when explicitly reprocessing.
    // A retry after partial failure keeps existing chunks and resumes.
    const existingChunks = await prisma.deckChunk.count({ where: { deckId } });
    const needsExtract = Boolean(opts?.reprocess) || existingChunks === 0;
    if (needsExtract) {
      if (!deck.pdfUrl) throw new Error("No source file attached to this deck");
      await setDeck(deckId, { genStatus: "extracting", genProgress: 2, genError: null });

      const filePath = sourceDiskPath(deck.pdfUrl);
      if (!filePath || !fs.existsSync(filePath)) throw new Error("The uploaded file is missing on disk");
      let lastPct = 2;
      const { pages, ocr } = await extractSource(
        filePath,
        (deck.sourceType || "pdf") as SourceType,
        async (fraction) => {
          const pct = 2 + Math.round(fraction * 18);
          if (pct !== lastPct) {
            lastPct = pct;
            await setDeck(deckId, { genProgress: pct }).catch(() => {});
          }
        },
        deck.ocrLanguage
      );
      // Figures for cards (best effort — never blocks card generation)
      let figures: FigureMap = {};
      try {
        if (deck.sourceType === "pdf" && !ocr) figures = await extractPdfFigures(filePath, deckId, uploadDir());
        else if (deck.sourceType === "pptx") figures = extractPptxFigures(await fs.promises.readFile(filePath), deckId, uploadDir());
      } catch (err) {
        console.warn(`[gen] figure extraction skipped:`, err instanceof Error ? err.message : err);
      }
      await prisma.deck.update({ where: { id: deckId }, data: { figures: Object.keys(figures).length ? JSON.stringify(figures) : null } });

      const chunks = chunkDocument(pages);
      const totalChars = chunks.reduce((n, c) => n + c.text.replace(/\s/g, "").length, 0);
      if (!chunks.length || totalChars < 40) throw new Error(emptyTextMessage(deck.sourceType, ocr));

      // Fresh generation: chunk delete would only null out cards.chunkId, so delete cards explicitly.
      await prisma.card.deleteMany({ where: { deckId } });
      await prisma.deckChunk.deleteMany({ where: { deckId } });
      await prisma.deckChunk.createMany({
        data: chunks.map((c) => ({
          deckId,
          position: c.position,
          heading: c.heading,
          text: c.text,
          status: "pending",
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          pageMap: serializePageMap(c),
        })),
      });
    }

    const dbChunks = await prisma.deckChunk.findMany({ where: { deckId }, orderBy: { position: "asc" } });
    if (!dbChunks.length) throw new Error("This deck has no sections to generate from");

    const settings = await prisma.userSettings.findUnique({ where: { userId: deck.userId } });
    const perChunk = cardsPerChunk(deck.density || settings?.cardDensity);

    await setDeck(deckId, { genStatus: "generating", genProgress: 20, genError: null, aiSource: ai.kind });

    // Pool used for duplicate detection across the whole deck.
    const pool = (await prisma.card.findMany({ where: { deckId }, select: { front: true, back: true } })).map((c) => ({
      front: c.front,
      back: c.back,
    }));

    const todo = dbChunks.filter((c) => c.status !== "done" || opts?.reprocess);
    let done = dbChunks.length - todo.length;
    const failures: string[] = [];
    let successes = 0;
    let aborted: string | null = null;

    const work = async (chunk: (typeof dbChunks)[number]) => {
      if (aborted) return;
      try {
        const cards = await generateCards(ai, {
          text: chunk.text,
          heading: chunk.heading,
          count: perChunk,
          instructions: deck.instructions || undefined,
          language: deck.cardLanguage,
        });
        const unique = dedupeCards(cards, pool);
        pool.push(...unique);
        await prisma.$transaction([
          prisma.card.deleteMany({ where: { deckId, chunkId: chunk.id } }),
          prisma.card.createMany({ data: cardRows(deckId, chunk, unique) }),
          prisma.deckChunk.update({ where: { id: chunk.id }, data: { status: "done" } }),
        ]);
        successes++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[gen] chunk ${chunk.id} failed:`, msg);
        failures.push(msg);
        await prisma.deckChunk.update({ where: { id: chunk.id }, data: { status: "failed" } }).catch(() => {});
        // The AI itself is broken (bad key, unreachable, model missing): stop instead of failing every section.
        if (successes === 0 && failures.length >= 2 && failures.every((f) => f === failures[0])) aborted = msg;
      }
      done += 1;
      const progress = 20 + Math.round((done / dbChunks.length) * 80);
      await setDeck(deckId, { genProgress: Math.min(99, progress) }).catch(() => {});
    };

    // Simple worker pool
    const queue = [...todo];
    const workers = Array.from({ length: Math.max(1, Math.min(ai.concurrency, queue.length)) }, async () => {
      while (queue.length && !aborted) {
        const next = queue.shift()!;
        await work(next);
      }
    });
    await Promise.all(workers);

    const failed = await prisma.deckChunk.count({ where: { deckId, status: { not: "done" } } });
    const totalCards = await prisma.card.count({ where: { deckId } });
    if (totalCards === 0) {
      throw new Error(aborted || failures[0] || "Card generation produced no cards. Retry, or add cards manually.");
    }
    await setDeck(deckId, {
      genStatus: "done",
      genProgress: 100,
      genError: failed > 0 ? `${failed} section(s) failed to generate${failures[0] ? ` (${failures[0]})` : ""} — use Retry on the deck.` : null,
    });
  } catch (err) {
    console.error(`[gen] deck ${deckId} error:`, err);
    await setDeck(deckId, {
      genStatus: "error",
      genError: err instanceof Error ? err.message : "Processing failed",
    });
  }
}

/** Map a stored source URL ("/api/files/<name>") to an absolute path on disk. */
export function sourceDiskPath(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const name = fileUrl.split("/").pop();
  if (!name || name.includes("..") || name.includes("\\")) return null;
  return path.join(uploadDir(), name);
}

export function uploadDir(): string {
  const dir = process.env.UPLOAD_DIR || "./data/uploads";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}
