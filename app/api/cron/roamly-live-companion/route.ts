import { NextRequest, NextResponse } from "next/server";
import { processLiveCompanionTimeLifecycle } from "@/lib/roamly/liveCompanionLifecycle";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";

export async function GET(request: NextRequest) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return NextResponse.json({ ok: false, error: "Notification cron secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, expected)) return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });
  const result = await processLiveCompanionTimeLifecycle();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
