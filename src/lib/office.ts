/**
 * Text extraction from Word (.docx) and PowerPoint (.pptx) files.
 * Both are zip archives of XML; we read the XML directly (no dependencies).
 * Headings are emitted as "# Heading" lines, which the chunker treats as
 * section breaks.
 */
import { readZip } from "./zip";
import type { SourcePage } from "./chunk";

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Text of one <w:p> / <a:p> paragraph: concatenated runs, tabs and breaks. */
function paragraphText(xml: string, ns: "w" | "a"): string {
  const runText = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:tab\\s*/>|<${ns}:br\\s*/>`, "g");
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = runText.exec(xml))) {
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (m[0].includes("tab")) out += "\t";
    else out += "\n";
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

/* ---------------- Word ---------------- */

export function extractDocxText(buf: Buffer): SourcePage[] {
  const zip = readZip(buf);
  const doc = zip.get("word/document.xml");
  if (!doc) throw new Error("This doesn't look like a Word document (word/document.xml missing)");
  const xml = doc.read().toString("utf8");
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;

  // Style ids that are headings: built-ins are "Heading1"…, but localized
  // Word versions use other ids, so also read styles.xml names.
  const headingStyles = new Set<string>();
  const styles = zip.get("word/styles.xml")?.read().toString("utf8") ?? "";
  for (const m of styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const name = m[2].match(/<w:name w:val="([^"]+)"/)?.[1] ?? "";
    if (/^(heading|title)\b/i.test(name) || /^(heading|title)/i.test(m[1])) headingStyles.add(m[1]);
  }

  const lines: string[] = [];
  for (const m of body.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const p = m[1] ?? "";
    const text = paragraphText(p, "w");
    if (!text) {
      lines.push("");
      continue;
    }
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1];
    const outline = /<w:outlineLvl w:val="\d"/.test(p);
    const isHeading = (style && (headingStyles.has(style) || /^heading/i.test(style))) || outline;
    const listItem = /<w:numPr>/.test(p);
    lines.push(isHeading && text.length <= 120 ? `# ${text}` : listItem ? `• ${text}` : text);
  }
  return [{ num: null, text: lines.join("\n") }];
}

/* ---------------- PowerPoint ---------------- */

export function extractPptxText(buf: Buffer): SourcePage[] {
  const zip = readZip(buf);
  const slideNames = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b));
  if (!slideNames.length) throw new Error("This doesn't look like a PowerPoint file (no slides found)");

  // Slide order as shown in the deck (presentation.xml → rels), falling back to file numbers.
  const order = slideOrder(zip);
  const ordered = order.length ? order.filter((n) => zip.has(n)) : slideNames;

  const pages: SourcePage[] = [];
  ordered.forEach((name, i) => {
    const xml = zip.get(name)!.read().toString("utf8");
    const lines: string[] = [];
    for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const shape = sp[0];
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(shape);
      const paras = [...shape.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((m) => paragraphText(m[1], "a")).filter(Boolean);
      if (!paras.length) continue;
      if (isTitle) lines.unshift(`# ${paras.join(" ")}`);
      else lines.push(...paras);
    }
    // Tables / other frames
    for (const gf of xml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
      for (const row of gf[0].matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
        const cells = [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((c) =>
          [...c[0].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((m) => paragraphText(m[1], "a")).join(" ")
        );
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
    }
    // Speaker notes often hold the real explanation.
    const notesName = notesFor(zip, name);
    if (notesName) {
      const nxml = zip.get(notesName)!.read().toString("utf8");
      const notes = [...nxml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)]
        .filter((s) => /<p:ph[^>]*type="body"/.test(s[0]))
        .flatMap((s) => [...s[0].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((m) => paragraphText(m[1], "a")))
        .filter(Boolean);
      if (notes.length) lines.push("", `Notes: ${notes.join(" ")}`);
    }
    if (lines.length) pages.push({ num: i + 1, text: lines.join("\n") });
  });
  return pages;
}

export function num(name: string): number {
  return parseInt(name.match(/(\d+)\.xml$/)?.[1] ?? "0", 10);
}

export function slideOrder(zip: Map<string, { read(): Buffer }>): string[] {
  const pres = zip.get("ppt/presentation.xml")?.read().toString("utf8");
  const rels = zip.get("ppt/_rels/presentation.xml.rels")?.read().toString("utf8");
  if (!pres || !rels) return [];
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/Id="([^"]+)"/)?.[1];
    const target = m[1].match(/Target="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target);
  }
  const out: string[] = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) {
    const t = targets.get(m[1]);
    if (t) out.push("ppt/" + t.replace(/^\.?\//, "").replace(/^\.\.\//, ""));
  }
  return out;
}

function notesFor(zip: Map<string, { read(): Buffer }>, slideName: string): string | null {
  const relsName = slideName.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
  const rels = zip.get(relsName)?.read().toString("utf8");
  if (!rels) return null;
  const m = rels.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/);
  return m ? `ppt/notesSlides/${m[1]}` : null;
}
