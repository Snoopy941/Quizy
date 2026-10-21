import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";
import { transcribeWav, voiceAvailable } from "@/lib/voice";

/** GET — is voice input available? POST (body: 16 kHz mono WAV, ?lang=xx) → { text } */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  return NextResponse.json({ available: voiceAvailable() });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length < 1000) return NextResponse.json({ error: "No audio recorded" }, { status: 400 });
  if (buf.length > 12 * 1024 * 1024) return NextResponse.json({ error: "Recording is too long" }, { status: 413 });
  if (buf.subarray(0, 4).toString("ascii") !== "RIFF") return NextResponse.json({ error: "Expected WAV audio" }, { status: 400 });
  try {
    const text = await transcribeWav(buf, req.nextUrl.searchParams.get("lang"));
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't transcribe" }, { status: 409 });
  }
}
