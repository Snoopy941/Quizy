import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { extractPdfText } from "@/lib/pdf-extract";
import { chunkText, type Chunk } from "@/lib/pdf";
import { generateCards, aiEnabled } from "@/lib/ai";

/**
 * Deck generation pipeline:
 * extract text → chunk → per-chunk AI generation (sequential, resumable).
 * Runs as a detached async job; progress is persisted on the deck + chunks
 * so the client can poll and interrupted runs can resume.
 */

const CARDS_PER_DENSITY: Record<string, number> = { low: 3, medium: 4, high: 5 };

export function cardsPerChunk(density: string | undefined | null): number {
  return CARDS_PER_DENSITY[density ?? "medium"] ?? 4;
}

async function setDeck(deckId: string, data: { genStatus?: string; genProgress?: number; genError?: string | null }) {
  await prisma.deck.update({ where: { id: deckId }, data });
}

/** Kick off generation without awaiting completion. */
export function startDeckGeneration(deckId: string, opts?: { reprocess?: boolean }) {
  void runDeckGeneration(deckId, opts).catch((err) => {
    console.error(`[gen] deck ${deckId} crashed:`, err);
    void setDeck(deckId, { genStatus: "error", genError: "Unexpected processing error" }).catch(() => {});
  });
}

export async function runDeckGeneration(deckId: string, opts?: { reprocess?: boolean }) {
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck) return;

  try {
    let chunks: Chunk[] = [];

    // Extract on first run (no chunks yet) or when explicitly reprocessing.
    // A retry after partial failure keeps existing chunks and resumes.
    const existingChunks = await prisma.deckChunk.count({ where: { deckId } });
    const needsExtract = Boolean(opts?.reprocess) || existingChunks === 0;
    if (needsExtract) {
      if (!deck.pdfUrl) throw new Error("No PDF attached to this deck");
      await setDeck(deckId, { genStatus: "extracting", genProgress: 2, genError: null });

      const filePath = pdfDiskPath(deck.pdfUrl);
      if (!filePath || !fs.existsSync(filePath)) throw new Error("Uploaded PDF file is missing on disk");
      const raw = await extractPdfText(filePath);
      if (!raw || raw.replace(/\s/g, "").length < 40) {
        throw new Error(
          "No extractable text found in this PDF — it may be scanned images. Try an OCR-processed file or a text-based PDF, or add cards manually."
        );
      }
      chunks = chunkText(raw);
      if (!chunks.length) throw new Error("Could not derive any sections from this PDF");

      // Replace chunks (fresh generation). Cards cascade-delete with chunks? No —
      // chunk delete sets cards.chunkId null via SetNull; delete cards explicitly.
      await prisma.card.deleteMany({ where: { deckId } });
      await prisma.deckChunk.deleteMany({ where: { deckId } });
      await prisma.deckChunk.createMany({
        data: chunks.map((c) => ({
          deckId,
          position: c.position,
          heading: c.heading,
          text: c.text,
          status: "pending",
        })),
      });
    }

    const dbChunks = await prisma.deckChunk.findMany({
      where: { deckId },
      orderBy: { position: "asc" },
    });
    if (!dbChunks.length) throw new Error("This deck has no sections to generate from");

    const settings = await prisma.userSettings.findUnique({ where: { userId: deck.userId } });
    const perChunk = cardsPerChunk(deck.density || settings?.cardDensity);

    await setDeck(deckId, { genStatus: "generating", genProgress: 5, genError: null });

    let done = dbChunks.filter((c) => c.status === "done").length;
    for (const chunk of dbChunks) {
      if (chunk.status === "done" && !opts?.reprocess) {
        continue; // resume support: skip already-generated chunks
      }
      try {
        const cards = await generateCards({
          text: chunk.text,
          heading: chunk.heading,
          count: chunk.cardCount || perChunk,
          instructions: deck.instructions || undefined,
        });
        await prisma.$transaction([
          prisma.card.createMany({
            data: cards.map((c, i) => ({
              deckId,
              chunkId: chunk.id,
              front: c.front,
              back: c.back,
              type: c.type,
              options: c.options ? JSON.stringify(c.options) : null,
              difficulty: c.difficulty,
              category: c.category,
              position: chunk.position * 10 + i,
            })),
          }),
          prisma.deckChunk.update({ where: { id: chunk.id }, data: { status: "done" } }),
        ]);
        done += 1;
      } catch (err) {
        console.error(`[gen] chunk ${chunk.id} failed:`, err);
        await prisma.deckChunk.update({ where: { id: chunk.id }, data: { status: "failed" } });
      }
      const progress = 5 + Math.round((done / dbChunks.length) * 95);
      await setDeck(deckId, { genProgress: Math.min(99, progress) });
    }

    const failed = await prisma.deckChunk.count({ where: { deckId, status: "failed" } });
    const totalCards = await prisma.card.count({ where: { deckId } });
    if (totalCards === 0) {
      throw new Error(
        aiEnabled()
          ? "AI generation produced no cards. Check your API key/model, then retry."
          : "Card generation produced no cards. Retry, or add cards manually."
      );
    }
    await setDeck(deckId, {
      genStatus: failed > 0 && totalCards === 0 ? "error" : "done",
      genProgress: 100,
      genError: failed > 0 ? `${failed} section(s) failed to generate — use Retry on the deck.` : null,
    });
  } catch (err) {
    console.error(`[gen] deck ${deckId} error:`, err);
    await setDeck(deckId, {
      genStatus: "error",
      genError: err instanceof Error ? err.message : "Processing failed",
    });
  }
}

/** Map a stored pdfUrl to an absolute path on disk. */
export function pdfDiskPath(pdfUrl: string | null | undefined): string | null {
  if (!pdfUrl) return null;
  // pdfUrl looks like "/api/files/<name>"
  const name = pdfUrl.split("/").pop();
  if (!name || name.includes("..")) return null;
  return path.join(uploadDir(), name);
}

export function uploadDir(): string {
  const dir = process.env.UPLOAD_DIR || "./data/uploads";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}
