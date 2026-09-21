import { extractText, getDocumentProxy } from "unpdf";

/** Extract text from a PDF file on disk. */
export async function extractPdfText(filePath: string): Promise<string> {
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);

  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join("\n\n") : text) ?? "";
    // Strip per-page NULs / control junk that some producers emit.
    const cleaned = merged
      .replace(/\0/g, "")
      .replace(/\u0000/g, "")
      .trim();
    return cleaned;
  } catch (err) {
    // Distinguish encrypted/corrupt from simply empty.
    throw new Error(
      `PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
