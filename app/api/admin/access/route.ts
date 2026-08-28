import { NextRequest, NextResponse } from "next/server";
import {
  ROAMLY_ADMIN_COOKIE,
  createRoamlyAdminSession,
  isRoamlyAdminConfigured,
  roamlyAdminCookieOptions,
  verifyRoamlyAdminCode
} from "@/lib/roamly/adminAccess";

export async function POST(request: NextRequest) {
  if (!isRoamlyAdminConfigured()) {
    return NextResponse.redirect(
      new URL("/admin-access?error=setup", request.url),
      303
    );
  }

  const form = await request.formData();

  const password = String(form.get("password") || "");

  const valid = await verifyRoamlyAdminCode(password);

  if (!valid) {
    return NextResponse.redirect(
      new URL("/admin-access?error=invalid", request.url),
      303
    );
  }

  const session = await createRoamlyAdminSession();

  const response = NextResponse.redirect(
    new URL("/admin", request.url),
    303
  );

  response.cookies.set(
    ROAMLY_ADMIN_COOKIE,
    session.value,
    roamlyAdminCookieOptions(session.maxAge)
  );

  return response;
}
