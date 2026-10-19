import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";
import { encodeQr, qrSvg } from "@/lib/qr";

/** GET /api/qr?text=… — QR code as SVG (used for the phone pairing link). Signed-in users only. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();
  const text = req.nextUrl.searchParams.get("text") ?? "";
  if (!text || text.length > 500) return NextResponse.json({ error: "text required (max 500 chars)" }, { status: 400 });
  return new NextResponse(qrSvg(encodeQr(text), 6), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" },
  });
}
