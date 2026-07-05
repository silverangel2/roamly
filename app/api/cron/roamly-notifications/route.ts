import { NextRequest, NextResponse } from "next/server";
import { sendScheduledTripNotifications } from "@/lib/roamly/pushServer";

export async function GET(request: NextRequest) {
  const secret = process.env.ROAMLY_NOTIFICATION_CRON_SECRET;
  const headerSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const providedSecret = request.nextUrl.searchParams.get("secret") || headerSecret;
  if (secret && providedSecret !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });
  }

  const result = await sendScheduledTripNotifications();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
