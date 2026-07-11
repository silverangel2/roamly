import { NextRequest, NextResponse } from "next/server";
import { safeAuthNextPath } from "@/lib/navigation";

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token") && cookie.value.length > 0);
}

function loginRedirectUrl(request: NextRequest) {
  const next = safeAuthNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, "/plan");
  const url = new URL("/login", request.url);
  url.searchParams.set("next", next);
  return url;
}

export function middleware(request: NextRequest) {
  if (hasSupabaseAuthCookie(request)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(loginRedirectUrl(request));
}

export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/notifications/:path*",
    "/preview/:path*",
    "/trip/:path*"
  ]
};
