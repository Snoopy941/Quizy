import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";
import { resolveAi, testAi } from "@/lib/ai";

/** POST /api/ai/test — send a tiny prompt to the active AI (warms up the built-in model too). */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const ai = await resolveAi(userId);
  if (!ai) return NextResponse.json({ ok: false, error: "No AI is set up yet." }, { status: 409 });
  try {
    const r = await testAi(ai);
    return NextResponse.json({ ok: true, label: ai.label, ms: r.ms, reply: r.reply });
  } catch (err) {
    return NextResponse.json({ ok: false, label: ai.label, error: err instanceof Error ? err.message : "AI test failed" }, { status: 502 });
  }
}
