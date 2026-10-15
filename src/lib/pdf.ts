/**
 * PDF text extraction + chunking.
 * Chunks by headings first, then paragraphs, then ~500-word windows.
 * Each chunk records the nearest preceding heading as its category.
 */

export interface Chunk {
  position: number;
  heading: string;
  text: string;
}

/** Heuristic heading detection: short line, no ending period, various styles. */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  // "1.2 Some Title", "Chapter 3: ...", "III. Title"
  if (/^(chapter|section|part|unit|lesson)\s+[\dIVXivx]+/i.test(t)) return true;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(t) && t.length < 70) return true;
  if (/^[IVXLCivxlc]+[.)]\s+\S/.test(t) && t.length < 70) return true;
  // ALL CAPS with at least 2 letters and not a full sentence
  if (/^[A-Z][A-Z\s\-—:,'&()]{3,}$/.test(t) && !/[.!?]$/.test(t)) return true;
  // Title Case line without terminal punctuation, not too long
  const words = t.split(/\s+/);
  if (
    words.length >= 2 &&
    words.length <= 12 &&
    !/[.!?]$/.test(t) &&
    /^[A-Z]/.test(t) &&
    words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length * 0.6)
  ) {
    return true;
  }
  return false;
}

/** Normalize extracted PDF text: fix hyphenation, collapse whitespace. */
export function normalizePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/([a-z])-\n([a-z])/g, "$1$2") // de-hyphenate line breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TARGET_WORDS = 500;

export function chunkText(raw: string): Chunk[] {
  const text = normalizePdfText(raw);
  if (!text) return [];

  // Split into blocks: heading lines become markers; paragraphs split on blank lines.
  const lines = text.split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  const flush = () => {
    if (currentBody.join(" ").trim()) {
      sections.push({ heading: currentHeading, body: [...currentBody] });
    }
    currentBody = [];
  };

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      flush();
      currentHeading = line.trim();
    } else {
      currentBody.push(line.trim());
    }
  }
  flush();

  // If no headings were found at all, treat whole doc as one unnamed section
  if (sections.length === 0) sections.push({ heading: "", body: [text] });

  // Break each section into paragraphs, then pack into ~500-word windows
  const chunks: Chunk[] = [];
  let pos = 0;
  for (const section of sections) {
    const paragraphs = section.body
      .join("\n")
      .split(/\n{2,}|(?<=\.)\s{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    // Pack paragraphs into windows
    let window: string[] = [];
    let wordCount = 0;
    const pushWindow = () => {
      if (!window.length) return;
      chunks.push({
        position: pos++,
        heading: section.heading || firstSentenceTopic(window[0]),
        text: window.join("\n\n"),
      });
      window = [];
      wordCount = 0;
    };

    for (const p of paragraphs) {
      const words = p.split(/\s+/).length;
      if (wordCount > 0 && wordCount + words > TARGET_WORDS * 1.3) pushWindow();
      // A single paragraph way over target gets hard-split
      if (words > TARGET_WORDS * 2) {
        pushWindow();
        const sentences = p.split(/(?<=[.!?])\s+/);
        let buf: string[] = [];
        let bufWords = 0;
        for (const s of sentences) {
          const sw = s.split(/\s+/).length;
          if (bufWords + sw > TARGET_WORDS) {
            chunks.push({
              position: pos++,
              heading: section.heading || firstSentenceTopic(buf[0] ?? ""),
              text: buf.join(" "),
            });
            buf = [];
            bufWords = 0;
          }
          buf.push(s);
          bufWords += sw;
        }
        if (buf.length) {
          chunks.push({
            position: pos++,
            heading: section.heading || firstSentenceTopic(buf[0]),
            text: buf.join(" "),
          });
        }
        continue;
      }
      window.push(p);
      wordCount += words;
    }
    pushWindow();
  }

  // Merge tiny trailing chunks (< 80 words) into predecessor
  const merged: Chunk[] = [];
  for (const c of chunks) {
    const words = c.text.split(/\s+/).length;
    const prev = merged[merged.length - 1];
    if (prev && words < 80 && prev.heading === c.heading) {
      prev.text += "\n\n" + c.text;
    } else {
      merged.push(c);
    }
  }
  return merged.map((c, i) => ({ ...c, position: i }));
}

/** Derive a category name from the first sentence when no heading exists. */
function firstSentenceTopic(text: string): string {
  const m = text.match(/^(.{5,60}?)[.,;:\n]/);
  if (m) {
    const t = m[1].trim();
    return t.length > 48 ? t.slice(0, 45).trim() + "…" : t;
  }
  const words = text.split(/\s+/).slice(0, 5).join(" ");
  return words.length > 48 ? words.slice(0, 45).trim() + "…" : words || "General";
}
