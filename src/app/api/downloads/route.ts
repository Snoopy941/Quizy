import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";
import {
  LLM_MODELS,
  OCR_LANGUAGES,
  WHISPER,
  downloadState,
  findAsset,
  isInstalled,
  ocrAsset,
  removeAsset,
  startDownload,
} from "@/lib/downloads";
import { binPath, installedModels, modelPath, setActiveModel } from "@/lib/local-ai";
import path from "path";

/** GET /api/downloads — optional downloads: AI models, voice answers, OCR languages. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const active = modelPath();
  const installed = installedModels();
  return NextResponse.json({
    engineInstalled: Boolean(binPath()),
    models: LLM_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      size: m.size,
      recommendedRamGb: m.recommendedRamGb,
      installed: installed.some((i) => i.file === m.marker),
      active: active ? path.basename(active) === m.marker : false,
      download: downloadState(m.id),
    })),
    otherModels: installed
      .filter((i) => !i.id)
      .map((i) => ({ file: i.file, active: active === i.path })),
    whisper: { installed: isInstalled(WHISPER), size: WHISPER.size, download: downloadState(WHISPER.id) },
    ocr: Object.entries(OCR_LANGUAGES).map(([code, name]) => ({
      code,
      name,
      installed: isInstalled(ocrAsset(code)) || code === "eng",
      download: downloadState(`ocr-${code}`),
    })),
  });
}

/**
 * POST /api/downloads — { action: "download" | "use" | "remove", id }
 * Downloads run in the background; poll GET for progress.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const id = String(body?.id ?? "");

  if (action === "use") {
    const file = String(body?.file ?? "") || findAsset(id)?.marker;
    if (!file || !installedModels().some((m) => m.file === file)) {
      return NextResponse.json({ error: "That model isn't downloaded yet." }, { status: 400 });
    }
    setActiveModel(file);
    return NextResponse.json({ ok: true });
  }

  const asset = findAsset(id);
  if (!asset) return NextResponse.json({ error: "Unknown download" }, { status: 400 });

  if (action === "download") {
    if (asset.kind === "llm" && !binPath()) {
      return NextResponse.json({ error: "The built-in AI engine isn't part of this install." }, { status: 400 });
    }
    startDownload(asset)
      .then(() => {
        // First model on a lite install becomes the active one automatically.
        if (asset.kind === "llm" && installedModels().length === 1) setActiveModel(asset.marker);
      })
      .catch((err) => console.error(`[downloads] ${id} failed:`, err instanceof Error ? err.message : err));
    return NextResponse.json({ ok: true, started: true });
  }

  if (action === "remove") {
    if (asset.kind === "llm" && modelPath() && path.basename(modelPath()!) === asset.marker && installedModels().length === 1) {
      return NextResponse.json({ error: "Can't remove the only AI model." }, { status: 400 });
    }
    if (asset.id === "ocr-eng") return NextResponse.json({ error: "English OCR is built in." }, { status: 400 });
    if (asset.kind === "llm" && modelPath() && path.basename(modelPath()!) === asset.marker) {
      const other = installedModels().find((m) => m.file !== asset.marker);
      if (other) setActiveModel(other.file); // also stops the server using the old file
    }
    removeAsset(asset);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
