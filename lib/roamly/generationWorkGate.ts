/**
 * EGRESS DIET (2026-11-02, F2) — work gate for the generation cron
 * sweeper (GET /api/cron/roamly-itinerary-generation).
 *
 * Events first: generation work is created by writes — the trip
 * generation routes insert/claim job rows and drive the worker
 * in-request (POST here is the targeted wake). This GET is only the
 * timer safety net for orphans (the KF-2 stranded-generation mode),
 * so it first answers "is there any work?" with three head/count
 * checks and exits if not:
 *
 *   1. due generation jobs — status queued/running, or waiting with
 *      next_attempt_at already due (a waiting job inside its backoff
 *      is not work yet; the sweeper that lands after its due time
 *      counts it). Pack-wait terminal candidates are a subset of
 *      queued/waiting jobs, and the stuck-generation detector's
 *      subjects are non-terminal jobs / generating trips, so both
 *      stay covered by 1+2.
 *
 * PARITY RULE (KF-2, M4): term 1's definition of work must match
 * what the claim RPCs can claim PLUS what the stranded-generation
 * recovery sweep (lib/roamly/generationRecovery.ts) can reopen or
 * drive — a job the sweep could act on must never be invisible to
 * the gate, or the gated GET exits before either runs. So term 1
 * also counts: failed jobs with next_attempt_at due and
 * retry_count < 3 (claimable by the claim RPC's failed branch),
 * and failed jobs with retry_count >= 3 and completed_at null
 * (not claimable, but exactly the recovery sweep's reopen class).
 *   2. trips stuck at status/itinerary_status "generating" — the
 *      legacy staged orphans enqueueLegacyTripJobs exists to adopt.
 *   3. communication ledger rows in the stuck detector's own scan
 *      set (pending/claimed/failed within its 30-day window).
 *
 * Fail-open: any count error → work is assumed present.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { anyWorkPresent, countWorkRows } from "@/lib/roamly/workGate";

export async function generationSweeperHasWork(
  admin: SupabaseClient,
  now: Date = new Date()
): Promise<boolean> {
  const nowIso = now.toISOString();
  const ledgerCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const counts = await Promise.all([
    countWorkRows(admin, "roamly_trip_generation_jobs", (query) =>
      query.or(
        `status.in.(queued,running),and(status.eq.waiting,next_attempt_at.lte.${nowIso}),and(status.eq.failed,next_attempt_at.lte.${nowIso},retry_count.lt.3),and(status.eq.failed,retry_count.gte.3,completed_at.is.null)`
      )
    ),
    countWorkRows(admin, "roamly_trips", (query) =>
      query.or("status.eq.generating,itinerary_status.eq.generating")
    ),
    countWorkRows(admin, "roamly_communication_ledger", (query) =>
      query.in("status", ["pending", "claimed", "failed"]).gte("scheduled_for", ledgerCutoff)
    )
  ]);
  return anyWorkPresent(counts);
}
