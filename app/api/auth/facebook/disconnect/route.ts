import { NextResponse } from "next/server";
import {
  ROAMLY_ADMIN_COOKIE,
  verifyRoamlyAdminSessionValue
} from "@/lib/roamly/adminAccess";
import {
  disconnectRoamlyFacebookConnection
} from "@/lib/roamly/facebookConnector";

export const dynamic = "force-dynamic";

function isSameOriginRequest(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    return origin === requestOrigin;
  }

  if (referer) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return true;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_ORIGIN"
      },
      {
        status: 403
      }
    );
  }

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
    await disconnectRoamlyFacebookConnection({
      source: "admin-request"
    });

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
