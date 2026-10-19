import { extractText, getDocumentProxy } from "unpdf";

/** Strip per-page NULs / control junk that some PDF producers emit. */
function clean(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim();
}

/** Extract text from a PDF file on disk, one string per page (index 0 = page 1). */
export async function extractPdfPages(filePath: string): Promise<string[]> {
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text ?? ""]).map((t) => clean(t ?? ""));
  } catch (err) {
    // Distinguish encrypted/corrupt from simply empty.
    throw new Error(`PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Extract text from a PDF file on disk as one string. */
export async function extractPdfText(filePath: string): Promise<string> {
  return (await extractPdfPages(filePath)).join("\n\n").trim();
}
