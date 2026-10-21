import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";
import { OCR_LANGUAGES, downloadState, findAsset, isInstalled, ocrAsset, removeAsset, startDownload } from "@/lib/downloads";

/** GET /api/downloads — optional downloads: OCR languages for scanned documents. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  return NextResponse.json({
    ocr: Object.entries(OCR_LANGUAGES).map(([code, name]) => ({
      code,
      name,
      installed: isInstalled(ocrAsset(code)) || code === "eng",
      download: downloadState(`ocr-${code}`),
    })),
  });
}

/**
 * POST /api/downloads — { action: "download" | "remove", id }
 * Downloads run in the background; poll GET for progress.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const id = String(body?.id ?? "");

  const asset = findAsset(id);
  if (!asset || asset.kind !== "ocr") return NextResponse.json({ error: "Unknown download" }, { status: 400 });

  if (action === "download") {
    startDownload(asset).catch((err) => console.error(`[downloads] ${id} failed:`, err instanceof Error ? err.message : err));
    return NextResponse.json({ ok: true, started: true });
  }

  if (action === "remove") {
    if (asset.id === "ocr-eng") return NextResponse.json({ error: "English OCR is built in." }, { status: 400 });
    removeAsset(asset);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
