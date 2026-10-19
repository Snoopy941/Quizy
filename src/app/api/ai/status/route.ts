import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";
import { resolveAiFromSettings } from "@/lib/ai";
import { localAvailable, localStatus, modelName, needsModelDownload } from "@/lib/local-ai";

/** GET /api/ai/status — which AI is active and the state of the built-in model. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const s = await prisma.userSettings.findUnique({ where: { userId } });
  const active = resolveAiFromSettings(s);
  return NextResponse.json({
    active: active ? { kind: active.kind, label: active.label, model: active.model } : null,
    preference: s?.aiProvider ?? "auto",
    builtin: { available: localAvailable(), needsDownload: needsModelDownload(), model: modelName(), ...localStatus() },
    api: {
      baseUrl: s?.aiBaseUrl ?? "",
      model: s?.aiModel ?? "",
      hasKey: Boolean(s?.aiApiKey),
      keyHint: s?.aiApiKey ? `…${s.aiApiKey.slice(-4)}` : "",
      envConfigured: Boolean(process.env.OPENAI_API_KEY),
    },
    demo: process.env.MOCK_AI === "1",
  });
}
