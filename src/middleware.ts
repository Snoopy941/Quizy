import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/share", "/forgot"];

function hasSessionCookie(req: NextRequest) {
  return Boolean(req.cookies.get("quizy_session")?.value);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = hasSessionCookie(req);

  if (pathname.startsWith("/api")) return NextResponse.next();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!authed && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (authed && (pathname === "/login" || pathname === "/signup")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|fonts/|brand/|.*\\.png$|.*\\.svg$|.*\\.woff2$).*)"],
};
