/** Pure date/duration formatters — safe to import from both server and client components. */

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** Label for a source location: "p. 4" for documents, "slide 4" for PowerPoint. */
export function pageLabel(sourceType: string | null | undefined, page: number | null | undefined): string | null {
  if (page === null || page === undefined) return null;
  return sourceType === "pptx" ? `slide ${page}` : `p. ${page}`;
}

/** What a deck was made from, for display. */
export function sourceKindLabel(sourceType: string | null | undefined): string {
  switch (sourceType) {
    case "docx":
      return "Word document";
    case "pptx":
      return "PowerPoint";
    case "text":
      return "notes";
    case "image":
      return "image";
    case "anki":
      return "Anki deck";
    default:
      return "PDF";
  }
}

/** Languages cards can be written in ("auto" = same as the source). */
export const CARD_LANGUAGES: Record<string, string> = {
  auto: "Same as the document",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  hi: "Hindi",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  id: "Indonesian",
  fil: "Filipino",
};

/** Tesseract OCR languages (code → name) offered when creating a deck. */
export const OCR_LANGUAGE_NAMES: Record<string, string> = {
  eng: "English",
  spa: "Spanish",
  fra: "French",
  deu: "German",
  ita: "Italian",
  por: "Portuguese",
  nld: "Dutch",
  pol: "Polish",
  tur: "Turkish",
  rus: "Russian",
  ukr: "Ukrainian",
  ara: "Arabic",
  hin: "Hindi",
  chi_sim: "Chinese (Simplified)",
  chi_tra: "Chinese (Traditional)",
  jpn: "Japanese",
  kor: "Korean",
  vie: "Vietnamese",
  ind: "Indonesian",
  tgl: "Filipino",
};

/** BCP-47-ish tag for speech (read-aloud / voice) from a card language. */
export const SPEECH_LANG: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR", nl: "nl-NL", pl: "pl-PL", tr: "tr-TR",
  ru: "ru-RU", uk: "uk-UA", ar: "ar-SA", hi: "hi-IN", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", vi: "vi-VN", id: "id-ID", fil: "fil-PH",
};
