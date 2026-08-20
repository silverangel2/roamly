import { NextResponse } from "next/server";
import {
  ROAMLY_ADMIN_COOKIE,
  verifyRoamlyAdminSessionValue
} from "@/lib/roamly/adminAccess";
import {
  disconnectRoamlyFacebookConnection
} from "@/lib/roamly/facebookConnector";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    return NextResponse.json(
      {
        ok: false,
        error: "ADMIN_AUTH_REQUIRED"
      },
      {
        status: 401
      }
    );
  }

  try {
    await disconnectRoamlyFacebookConnection();

    return NextResponse.redirect(
      new URL("/admin/social/automation?facebook=disconnected", request.url),
      303
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not disconnect Facebook."
      },
      {
        status: 500
      }
    );
  }
}
