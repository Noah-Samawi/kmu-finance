import { NextResponse, type NextRequest } from "next/server";

// Schnelle Vorprüfung ohne DB: ohne Session-Cookie direkt zum Login.
// Die echte Prüfung (gültig? gesperrt? Rolle?) passiert serverseitig in jeder Seite/Route.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("kmu_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/me/:path*", "/super/:path*"] };
