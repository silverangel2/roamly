import { NextRequest, NextResponse } from "next/server";
import { processLiveCompanionTimeLifecycle } from "@/lib/roamly/liveCompanionLifecycle";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordCronHeartbeat } from "@/lib/roamly/cronHeartbeat";

export async function GET(request: NextRequest) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return NextResponse.json({ ok: false, error: "Notification cron secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, expected)) return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });
  const result = await processLiveCompanionTimeLifecycle();
  // Heartbeat (finding L11): a cron that never runs must leave a detectable
  // absence — one roamly_app_events row per invocation. Best-effort only.
  const admin = createSupabaseAdminClient();
  const heartbeatRecorded = admin ? await recordCronHeartbeat(admin, "roamly-live-companion", result.ok === true) : false;
  return NextResponse.json({ ...result, heartbeatRecorded }, { status: result.ok ? 200 : 207 });
}
