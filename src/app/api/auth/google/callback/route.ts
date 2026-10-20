import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeCode, finishPending, getPending, loadGoogleConfig } from "@/lib/google";

function page(title: string, message: string, ok: boolean) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – Quizy</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f5f2e8;font:400 17px/1.6 "Segoe UI",system-ui,sans-serif}
main{max-width:420px;padding:32px;text-align:center}.i{width:56px;height:56px;border-radius:50%;margin:0 auto 20px;display:grid;place-items:center;font-size:26px;background:${ok ? "#f5f2e8" : "#2a2a2a"};color:${ok ? "#0a0a0a" : "#f5f2e8"}}
h1{font-size:24px;margin:0 0 8px}p{color:#a3a3a3;margin:0}</style></head>
<body><main><div class="i">${ok ? "&#10003;" : "!"}</div><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** GET — Google sends the browser here after the user picks an account. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = q.get("state") || "";
  const p = getPending(state);
  if (!p || p.status !== "pending") {
    return page("This sign-in link has expired", "Go back to Quizy and click Continue with Google again.", false);
  }
  if (q.get("error")) {
    const msg = q.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed (${q.get("error")}).`;
    finishPending(state, { error: msg });
    return page("Sign-in cancelled", "You can close this tab and go back to Quizy.", false);
  }
  const cfg = loadGoogleConfig();
  const code = q.get("code");
  if (!cfg || !code) {
    finishPending(state, { error: "Google sign-in didn't complete. Please try again." });
    return page("Something went wrong", "Go back to Quizy and try again.", false);
  }
  try {
    const id = await exchangeCode(cfg, p, code);
    let user = await prisma.user.findUnique({ where: { googleSub: id.sub } });
    if (!user) {
      if (!id.emailVerified) throw new Error("Your Google email address isn't verified yet. Verify it with Google, then try again.");
      const existing = await prisma.user.findUnique({ where: { email: id.email } });
      if (existing) {
        // Same email as an account on this computer: link them.
        user = await prisma.user.update({ where: { id: existing.id }, data: { googleSub: id.sub } });
      } else {
        user = await prisma.user.create({
          data: { email: id.email, name: id.name.slice(0, 80), passwordHash: "", googleSub: id.sub, settings: { create: {} } },
        });
      }
    }
    finishPending(state, { userId: user.id });
    return page("You're signed in", "You can close this tab and go back to Quizy.", true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Google sign-in failed";
    console.error("[google] sign-in failed:", msg);
    finishPending(state, { error: msg });
    return page("Couldn't sign you in", `${msg} You can close this tab.`, false);
  }
}
