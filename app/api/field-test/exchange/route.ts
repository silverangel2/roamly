import { NextRequest, NextResponse } from "next/server";
import { exchangeFieldTestCapability, fieldTestCookieOptions, ROAMLY_FIELD_TEST_COOKIE } from "@/lib/roamly/fieldTestAccess";

export async function GET(request: NextRequest) {
  const tripId = request.nextUrl.searchParams.get("tripId") || "";
  const capability = request.nextUrl.searchParams.get("capability") || "";
  let exchanged = null;
  try {
    exchanged = await exchangeFieldTestCapability(tripId, capability);
  } catch (error) {
    if (error instanceof Error && error.message === "ROAMLY_FIELD_TEST_SECRET_NOT_CONFIGURED") {
      return NextResponse.json(
        { ok: false, error: "Field-test capability is unavailable: ROAMLY_FIELD_TEST_SECRET is not configured." },
        { status: 500 }
      );
    }
    throw error;
  }
  const destination = new URL(`/field-test/${encodeURIComponent(tripId)}`, request.url);
  if (!exchanged) destination.searchParams.set("error", "invalid");
  const response = NextResponse.redirect(destination);
  if (exchanged) response.cookies.set(ROAMLY_FIELD_TEST_COOKIE, exchanged.cookieValue, fieldTestCookieOptions());
  return response;
}
