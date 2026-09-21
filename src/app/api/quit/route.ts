import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";

/**
 * POST /api/quit — stop the local server.
 * Only available in the portable desktop build (QUIZY_PORTABLE=1):
 *  - signed-in users can quit from the app, or
 *  - the Quit Quizy.exe helper can quit via the local x-quizy-quit token.
 * The deployed site always returns 404 here.
 */
export async function POST(req: NextRequest) {
  if (process.env.QUIZY_PORTABLE !== "1") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const token = req.headers.get("x-quizy-quit");
  const tokenOk = Boolean(process.env.QUIZY_QUIT_TOKEN) && token === process.env.QUIZY_QUIT_TOKEN;
  if (!tokenOk) {
    const userId = await getUserId(req);
    if (!userId) return unauthorized();
  }

  setTimeout(() => {
    process.exit(0);
  }, 300);
  return NextResponse.json({ ok: true, bye: true });
}
