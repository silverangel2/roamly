import { NextRequest, NextResponse } from "next/server";
import { runScheduledBookingMonitor } from "@/lib/roamly/bookingMonitor";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";

export const maxDuration = 300;

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

  if (!isCronRequestAuthorized(request.headers, expected)) {
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
