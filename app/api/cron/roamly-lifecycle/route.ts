import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { build2LifecycleEnabled } from "@/lib/roamly/build2Flags";
import {
  createLifecycleDeps,
  runLifecycleSweep
} from "@/lib/roamly/tripLifecycle";

/**
 * Hourly lifecycle sweep (DESIGN-PRODUCTION.md Phase 11): advance
 * every open trip through the lifecycle machine — end trips whose
 * final day has passed, close post-trip loops on review-window
 * expiry, archive at close, and (only when
 * ROAMLY_BUILD2_LIFECYCLE_ENABLED is on) purge the live copies of
 * closed trips behind the ingest + FK precondition gates.
 *
 * The flag gates ONLY the purge step: with it off, trips still end,
 * close, and archive — nothing purges (the safe default).
 *
 * Attach point: vercel.json gains
 *   { "path": "/api/cron/roamly-lifecycle", "schedule": "0 * * * *" }
 * with the Phase 11 release (recorded in PHASE11-REPORT.md; the
 * route is inert until the entry lands, the same posture as
 * Phase 3's pack-refresh route).
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret)
    return NextResponse.json(
      { ok: false, error: "Cron secret is not configured." },
      { status: 503 }
    );
  if (!isCronRequestAuthorized(request.headers, secret))
    return NextResponse.json(
      { ok: false, error: "Unauthorized cron." },
      { status: 401 }
    );

  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { ok: false, error: "Supabase service role is not configured." },
      { status: 503 }
    );

  const deps = createLifecycleDeps(admin);
  const summary = await runLifecycleSweep(deps, new Date().toISOString(), {
    purgeEnabled: build2LifecycleEnabled(),
    actor: "lifecycle-sweep"
  });
  return NextResponse.json(
    { ok: summary.errors.length === 0, ...summary },
    { status: summary.errors.length === 0 ? 200 : 207 }
  );
}
