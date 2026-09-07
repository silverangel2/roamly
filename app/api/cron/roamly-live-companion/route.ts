import { NextRequest, NextResponse } from "next/server";
import { processLiveCompanionTimeLifecycle } from "@/lib/roamly/liveCompanionLifecycle";

export async function GET(request: NextRequest) {
  const expected = (process.env.ROAMLY_NOTIFICATION_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const provided = (
    request.headers.get("x-cron-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    request.nextUrl.searchParams.get("secret")?.trim() ||
    ""
  );
  if (!expected) return NextResponse.json({ ok: false, error: "Notification cron secret is not configured." }, { status: 503 });
  if (provided !== expected) return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });
  const result = await processLiveCompanionTimeLifecycle();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
