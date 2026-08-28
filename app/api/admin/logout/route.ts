import { NextRequest, NextResponse } from "next/server";
import {
  ROAMLY_ADMIN_COOKIE,
  roamlyAdminCookieOptions
} from "@/lib/roamly/adminAccess";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/admin-access", request.url),
    303
  );

  response.cookies.set(
    ROAMLY_ADMIN_COOKIE,
    "",
    roamlyAdminCookieOptions(0)
  );

  return response;
}
