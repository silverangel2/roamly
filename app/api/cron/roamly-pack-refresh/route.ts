import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore";
import { drainQueuedBuilds, primaryCollector } from "@/lib/roamly/engine/packs/builder";
import { anyWorkPresent, countWorkRows } from "@/lib/roamly/workGate";
import { recordCronHeartbeat } from "@/lib/roamly/cronHeartbeat";

/**
 * Pack-refresh drain (DESIGN-PRODUCTION.md §2.2 attach point;
 * SHIP-MANIFEST §4 step 4, landed with the 2026-10-22 production
 * ship): drain every queued destination-pack build through the
 * primary collector — claim (lease) -> collect -> publish.
 *
 * Since the 2026-11-07 speed fix this cron is the BACKSTOP, not
 * the only builder: the generation seam's pack drive
 * (packs/kick.ts drivePackBuild) drives a cold destination's
 * build to completion inside the requesting trip's own window,
 * and the primary collector builds from a prebuilt Overture
 * extract when one exists (live Overpass is its fallback). This
 * route still owns stale-pack refreshes and any build that
 * outlasted its drive.
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

  // EGRESS DIET (F2): work gate. Builds are enqueued by the
  // generation seam on cold reads (the event); this hourly drain is
  // the sweeper. drainQueuedBuilds processes rows with status
  // "queued" AND rows stuck at "building" whose lease has expired
  // (pack rescue, 2026-11-07: a kick keeps a build "building" for
  // most of every hour, so a queued-only gate let whole ticks pass
  // with reclaimable work invisible). One head/count on exactly
  // that predicate decides the run. Fail-open on a count error.
  const queuedBuilds = await countWorkRows(admin, "roamly_destination_pack_builds", (query) =>
    query.in("status", ["queued", "building"])
  );
  if (!anyWorkPresent([queuedBuilds])) {
    await recordCronHeartbeat(admin, "roamly-pack-refresh", true, { gated: true });
    return NextResponse.json({ ok: true, gated: true, reason: "no_queued_or_building_pack_builds", published: [] });
  }

  const store = new SupabasePackStore(admin);
  try {
    const published = await drainQueuedBuilds(store, () => primaryCollector(), {
      workerId: "pack-refresh-cron"
    });
    await recordCronHeartbeat(admin, "roamly-pack-refresh", true);
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
