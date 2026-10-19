/**
 * Splits extracted document text into study sections ("chunks") while
 * remembering which page (or slide) every part came from, so each card can
 * point back to its source page.
 *
 * Pipeline: per-page lines → context-aware heading detection → sections →
 * ~500-word windows broken at sentence ends → tiny-chunk merge.
 *
 * Pure module (no imports) so it can be unit-tested directly.
 */

export interface SourcePage {
  /** 1-based page / slide number, or null when the format has no pages (DOCX, pasted text). */
  num: number | null;
  text: string;
}

export interface Chunk {
  position: number;
  heading: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  /** [charOffset, page] pairs: page in effect from that offset of `text` onward. */
  pageMap: [number, number][];
}

export const TARGET_WORDS = 500;

/** Lines starting with "# " are explicit headings (DOCX/PPTX extractors, Markdown). */
const MARKED_HEADING = /^#{1,6}\s+(.+)$/;

const TRAILING_CONNECTOR = /\b(and|or|of|the|a|an|to|in|for|with|on|by|as|at|from|that|which|is|are|but)$/i;

/** Normalize one page's text: unify newlines, fix line-break hyphenation, collapse spaces. */
export function normalizePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // soft hyphens
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const endsSentence = (s: string) => /[.!?:;)"”’]$/.test(s.trim());

/**
 * Heading detection. `prev`/`next` give context so wrapped sentence lines
 * that happen to be Title Case aren't mistaken for headings.
 */
export function looksLikeHeading(line: string, prev?: string | null, next?: string | null): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (MARKED_HEADING.test(t)) return true;
  if (/[.,;]$/.test(t)) return false;
  if (TRAILING_CONNECTOR.test(t)) return false;
  if (/^[-•*·▪●]\s/.test(t)) return false; // bullet
  if (/^\d+(\.\d+)?$/.test(t)) return false; // bare page number
  if (!/[A-Za-z]{2,}/.test(t)) return false;

  // A line that continues an unfinished sentence is never a heading.
  const prevT = (prev ?? "").trim();
  if (prevT && !endsSentence(prevT) && !looksLikeStrongHeading(prevT)) return false;
  // A heading is followed by a new sentence/paragraph, not a lowercase continuation.
  const nextT = (next ?? "").trim();
  if (nextT && /^[a-z]/.test(nextT)) return false;

  return looksLikeStrongHeading(t) || looksLikeTitleCase(t);
}

/** Numbered / labelled / ALL-CAPS headings. */
function looksLikeStrongHeading(t: string): boolean {
  if (/^(chapter|section|part|unit|lesson|module|topic)\s+[\dIVXivx]+\b/i.test(t)) return true;
  if (/^\d+(\.\d+)*[.)]?\s+[A-Z]\S*/.test(t) && t.length < 80 && !/[.!?]$/.test(t)) return true;
  if (/^[IVXL]+[.)]\s+[A-Z]/.test(t) && t.length < 80) return true;
  if (/^[A-Z][A-Z0-9\s\-—:,'&()/]{3,}$/.test(t) && !/[.!?]$/.test(t) && /[A-Z]{3,}/.test(t)) return true;
  return false;
}

const SMALL_WORDS = new Set(
  "a an and as at but by for from in into nor of on or the to vs via with".split(" ")
);

function looksLikeTitleCase(t: string): boolean {
  if (/[.!?]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 12) return false;
  if (!/^[A-Z0-9]/.test(t)) return false;
  const content = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (!content.length) return false;
  const capped = content.filter((w) => /^[A-Z0-9(“"']/.test(w)).length;
  if (words.length === 1) return t.length >= 4 && t.length <= 40 && /^[A-Z][a-z]+$/.test(t);
  return capped / content.length >= 0.75;
}

function headingText(line: string): string {
  const m = line.trim().match(MARKED_HEADING);
  return (m ? m[1] : line).trim().replace(/\s+/g, " ").slice(0, 120);
}

interface Line {
  text: string;
  page: number | null;
}

interface Section {
  heading: string;
  lines: Line[];
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Join lines into readable text, tracking where each page starts. */
function joinLines(lines: Line[]): { text: string; pageMap: [number, number][] } {
  let text = "";
  const pageMap: [number, number][] = [];
  let lastPage: number | null | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i > 0) {
      const prev = lines[i - 1].text;
      if (/[a-z]-$/.test(prev) && /^[a-z]/.test(l.text)) {
        text = text.slice(0, -1); // de-hyphenate across the break
      } else {
        text += endsSentence(prev) ? "\n" : " ";
      }
    }
    if (l.page !== null && l.page !== lastPage) pageMap.push([text.length, l.page]);
    lastPage = l.page;
    text += l.text;
  }
  return { text: text.trim(), pageMap };
}

/** Chunk a whole document. Pages may have num=null for page-less formats. */
export function chunkDocument(pages: SourcePage[], targetWords = TARGET_WORDS): Chunk[] {
  const lines: Line[] = [];
  for (const p of pages) {
    const norm = normalizePdfText(p.text || "");
    if (!norm) continue;
    for (const raw of norm.split("\n")) {
      const t = raw.trim();
      if (t) lines.push({ text: t, page: p.num });
      else if (lines.length && lines[lines.length - 1].text !== "") lines.push({ text: "", page: p.num });
    }
  }

  // Sections
  const sections: Section[] = [];
  let current: Section = { heading: "", lines: [] };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.text) {
      // paragraph gap: keep as a sentence boundary marker
      if (current.lines.length) current.lines.push(l);
      continue;
    }
    const prev = prevNonEmpty(lines, i);
    const next = nextNonEmpty(lines, i);
    if (looksLikeHeading(l.text, prev, next)) {
      if (current.lines.some((x) => x.text)) sections.push(current);
      current = { heading: headingText(l.text), lines: [] };
    } else {
      current.lines.push(l);
    }
  }
  if (current.lines.some((x) => x.text)) sections.push(current);

  // Pack each section into ~targetWords windows, breaking at sentence ends.
  const raw: Omit<Chunk, "position">[] = [];
  for (const sec of sections) {
    let win: Line[] = [];
    let words = 0;
    const flush = () => {
      const content = win.filter((l) => l.text);
      if (!content.length) {
        win = [];
        words = 0;
        return;
      }
      const { text, pageMap } = joinLines(content);
      const nums = content.map((l) => l.page).filter((n): n is number => n !== null);
      raw.push({
        heading: sec.heading || firstSentenceTopic(text),
        text,
        pageStart: nums.length ? Math.min(...nums) : null,
        pageEnd: nums.length ? Math.max(...nums) : null,
        pageMap,
      });
      win = [];
      words = 0;
    };
    for (const l of sec.lines) {
      if (!l.text) {
        if (words >= targetWords * 0.8) flush();
        else if (win.length) win.push({ text: "", page: l.page });
        continue;
      }
      // very long single line (no line breaks in source): split into sentences
      const pieces = wordCount(l.text) > targetWords ? l.text.split(/(?<=[.!?])\s+/) : [l.text];
      for (const piece of pieces) {
        const w = wordCount(piece);
        if (words > 0 && words + w > targetWords * 1.3) flush();
        win.push({ text: piece, page: l.page });
        words += w;
        if (words >= targetWords && endsSentence(piece)) flush();
      }
    }
    flush();
  }

  // Merge tiny chunks (< 80 words) into the previous chunk of the same section.
  const merged: Omit<Chunk, "position">[] = [];
  for (const c of raw) {
    const prev = merged[merged.length - 1];
    if (prev && wordCount(c.text) < 80 && prev.heading === c.heading) {
      const offset = prev.text.length + 2;
      prev.text += "\n\n" + c.text;
      for (const [o, p] of c.pageMap) {
        if (prev.pageMap[prev.pageMap.length - 1]?.[1] !== p) prev.pageMap.push([o + offset, p]);
      }
      if (c.pageStart !== null) prev.pageStart = prev.pageStart === null ? c.pageStart : Math.min(prev.pageStart, c.pageStart);
      if (c.pageEnd !== null) prev.pageEnd = prev.pageEnd === null ? c.pageEnd : Math.max(prev.pageEnd, c.pageEnd);
    } else {
      merged.push({ ...c, pageMap: [...c.pageMap] });
    }
  }
  return merged.map((c, i) => ({ position: i, ...c }));
}

/** Backwards-compatible: chunk one block of text with no page info. */
export function chunkText(raw: string): Chunk[] {
  return chunkDocument([{ num: null, text: raw }]);
}

function prevNonEmpty(lines: Line[], i: number): string | null {
  for (let j = i - 1; j >= 0; j--) if (lines[j].text) return lines[j].text;
  return null;
}
function nextNonEmpty(lines: Line[], i: number): string | null {
  for (let j = i + 1; j < lines.length; j++) if (lines[j].text) return lines[j].text;
  return null;
}

/** Derive a category name from the first sentence when no heading exists. */
export function firstSentenceTopic(text: string): string {
  const m = text.match(/^(.{5,60}?)[.,;:\n]/);
  if (m) {
    const t = m[1].trim();
    return t.length > 48 ? t.slice(0, 45).trim() + "…" : t;
  }
  const words = text.split(/\s+/).slice(0, 5).join(" ");
  return words.length > 48 ? words.slice(0, 45).trim() + "…" : words || "General";
}

/* ---------- locating a card's source quote ---------- */

/** Lowercased alphanumeric skeleton of `s` plus a map back to original offsets. */
function skeleton(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i].toLowerCase();
    if (/[a-z0-9]/.test(ch)) {
      norm += ch;
      map.push(i);
      lastSpace = false;
    } else if (!lastSpace) {
      norm += " ";
      map.push(i);
      lastSpace = true;
    }
  }
  return { norm: norm.trimEnd(), map };
}

/** Offset in `text` where `quote` appears (fuzzy: falls back to its first/last words). */
export function findQuoteOffset(quote: string, text: string): number {
  const q = skeleton(quote).norm.trim();
  if (q.length < 8) return -1;
  const { norm, map } = skeleton(text);
  let idx = norm.indexOf(q);
  if (idx === -1) {
    const words = q.split(" ");
    if (words.length >= 6) {
      idx = norm.indexOf(words.slice(0, 5).join(" "));
      if (idx === -1) idx = norm.indexOf(words.slice(-5).join(" "));
    }
  }
  return idx === -1 ? -1 : map[idx] ?? -1;
}

/** Page number in effect at `offset` according to a chunk's pageMap. */
export function pageAtOffset(pageMap: [number, number][], offset: number): number | null {
  let page: number | null = pageMap.length ? pageMap[0][1] : null;
  for (const [o, p] of pageMap) {
    if (o <= offset) page = p;
    else break;
  }
  return page;
}

/** Best page for a card: where its quote appears, else the chunk's first page. */
export function pageForQuote(
  quote: string | undefined,
  chunk: { text: string; pageMap: [number, number][]; pageStart: number | null }
): number | null {
  if (quote) {
    const off = findQuoteOffset(quote, chunk.text);
    if (off >= 0) return pageAtOffset(chunk.pageMap, off);
  }
  return chunk.pageStart;
}

/** [start, end) range of `quote` inside `text`, for highlighting (exact-ish match only). */
export function findQuoteRange(quote: string, text: string): [number, number] | null {
  const q = skeleton(quote).norm.trim();
  if (q.length < 8) return null;
  const { norm, map } = skeleton(text);
  const idx = norm.indexOf(q);
  if (idx === -1) return null;
  const start = map[idx];
  const endIdx = map[Math.min(idx + q.length - 1, map.length - 1)];
  return start === undefined || endIdx === undefined ? null : [start, endIdx + 1];
}
