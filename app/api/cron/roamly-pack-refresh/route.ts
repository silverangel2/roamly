import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore";
import { drainQueuedBuilds, liveCollector } from "@/lib/roamly/engine/packs/builder";

/**
 * Pack-refresh drain (DESIGN-PRODUCTION.md §2.2 attach point;
 * SHIP-MANIFEST §4 step 4, landed with the 2026-10-22 production
 * ship): drain every queued destination-pack build through the
 * live Overpass collector — claim (lease) -> collect -> publish —
 * so a cold destination's first pack, and stale packs' refreshes,
 * are built by this cron and never inside a traveler's request.
 *
 * The generation seam enqueues builds on cold reads and waits
 * (busy) until a version publishes here; this route is the only
 * writer of live-collected packs.
 *
 * Auth is the house cron pattern: CRON_SECRET fail-closed (503 when
 * unconfigured, 401 when unauthorized), same as every sibling cron.
 *
 * Attach point: vercel.json gains
 *   { "path": "/api/cron/roamly-pack-refresh", "schedule": "15 * * * *" }
 * with this release (hourly at :15, offset from the lifecycle
 * sweep's :00 so the two pack-adjacent jobs never start together).
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

  const store = new SupabasePackStore(admin);
  try {
    const published = await drainQueuedBuilds(store, () => liveCollector(), {
      workerId: "pack-refresh-cron"
    });
    return NextResponse.json({
      ok: true,
      published: published.map((version) => ({
        packVersionId: version.dto.packVersionId,
        destinationId: version.dto.destinationId,
        version: version.version,
        candidates: version.dto.counts.candidates
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Pack drain failed."
      },
      { status: 500 }
    );
  }
}
