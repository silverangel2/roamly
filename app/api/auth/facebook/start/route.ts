import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  buildRoamlyFacebookAuthorizationUrl,
  ROAMLY_FACEBOOK_STATE_COOKIE
} from "@/lib/roamly/facebookConnector";
import {
  ROAMLY_ADMIN_COOKIE,
  verifyRoamlyAdminSessionValue
} from "@/lib/roamly/adminAccess";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";

  const adminCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ROAMLY_ADMIN_COOKIE}=`));

  const adminSession = adminCookie
    ? decodeURIComponent(adminCookie.split("=").slice(1).join("="))
    : "";

  const validAdmin =
    adminSession &&
    (await verifyRoamlyAdminSessionValue(adminSession));

  if (!validAdmin) {
    return NextResponse.redirect(
      new URL("/admin-access", request.url)
    );
  }

  const state = randomBytes(24).toString("hex");

  const response = NextResponse.redirect(
    buildRoamlyFacebookAuthorizationUrl(state)
  );

  response.cookies.set(
    ROAMLY_FACEBOOK_STATE_COOKIE,
    state,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60
    }
  );

  return response;
}
