import { NextRequest, NextResponse } from "next/server";
import { runScheduledBookingMonitor } from "@/lib/roamly/bookingMonitor";

export const maxDuration = 300;

function cronSecret(request: NextRequest) {
  return (
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ||
    request.headers
      .get("x-cron-secret")
      ?.trim() ||
    request.nextUrl.searchParams
      .get("secret")
      ?.trim() ||
    ""
  );
}

export async function GET(request: NextRequest) {
  const expected = (
    process.env.ROAMLY_NOTIFICATION_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();

  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "Booking monitor cron secret is not configured."
      },
      { status: 503 }
    );
  }

  if (cronSecret(request) !== expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized cron."
      },
      { status: 401 }
    );
  }

  const result =
    await runScheduledBookingMonitor();

  return NextResponse.json(result, {
    status:
      result.ok || result.skipped
        ? 200
        : 207
  });
}
