/**
 * Compatibility re-exports — chunking now lives in ./chunk (page-aware,
 * shared by PDF, Word, PowerPoint and pasted text).
 */
export { chunkText, chunkDocument, looksLikeHeading, normalizePdfText, type Chunk } from "./chunk";
