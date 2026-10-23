import { drainQueuedBuilds, liveCollector, runBuildJob, type PackCollector } from "@/lib/roamly/engine/packs/builder";
import type { PackStore } from "@/lib/roamly/engine/packs/store";

/*
 * Pack-build kick — the immediate-drain seam (owner order
 * 2026-10-22: a first-time destination's trip must not wait for
 * the hourly pack-refresh cron before its build even STARTS).
 *
 * The shipped design built packs only in the hourly cron drain
 * (app/api/cron/roamly-pack-refresh). The generation seam enqueued
 * a build on a cold read and the trip waited — up to ~1 hour of
 * pure queue latency before the build began (crowd test 2026-10-22:
 * Halifax/Banff waited 90+ minutes; the one drain in the window
 * missed them), while the itinerary generation itself takes under
 * a minute once a pack exists.
 *
 * The kick closes exactly that gap and nothing else: when the
 * outline stage finds its destination's build freshly enqueued
 * (or still queued, never attempted), it schedules this drain —
 * the SAME drainQueuedBuilds the cron calls, filtered to the one
 * destination — as post-response work (Next.js after(), injected
 * by the production deps factory). The traveler's request is never
 * blocked by a build; the hourly cron remains the backstop and is
 * untouched.
 *
 * Discipline:
 *   - No kick when a ready pack already serves the destination
 *     (stale-pack refreshes stay the cron's job — a stale pack
 *     still serves, so no traveler is waiting on them).
 *   - No kick when a build is already claimed under a live lease.
 *     A "building" job whose lease has EXPIRED is kickable: its
 *     holder is gone, and the kick routes that one job straight to
 *     runBuildJob (the drain's own per-job unit — the drain's queue
 *     scan feeds it only "queued" jobs), whose claim steals it
 *     under the store's fencing rules.
 *   - Stampede safety is the store's claim, not a lock here: the
 *     Supabase claim is a conditional UPDATE guarded by the job's
 *     current status (and, for a steal, its current lease_id +
 *     epoch) — two concurrent kicks race the claim and exactly one
 *     wins; the loser drains nothing. Enqueue is likewise
 *     single-flight (the partial unique index + coalescing), so a
 *     destination never has two live jobs to double-build.
 *   - Collection honesty is unchanged (fix #4): the kick runs the
 *     live collector with its bounded deadline, chunk ladder and
 *     partial acceptance. A kick during an upstream outage fails
 *     the build job with the error recorded and leaves the trip
 *     honestly waiting — runPackKick reports the failure in its
 *     result and NEVER throws into the caller.
 */

export type PackKickReason =
  /** A queued build is waiting unclaimed — drain it now. */
  | "queued-build-waiting"
  /** A ready pack already serves this destination. */
  | "pack-ready"
  /** No live (queued|building) build exists for this destination. */
  | "no-queued-build"
  /** A build is already claimed under a live lease. */
  | "build-in-flight";

export interface PackKickDecision {
  kick: boolean;
  reason: PackKickReason;
  jobId: string | null;
  /** The live job's status when the decision was made. "building"
   *  reaches the kick only with an expired lease (see decidePackKick)
   *  and routes to a direct runBuildJob steal attempt: the drain's
   *  queue scan feeds it only "queued" jobs by design. */
  jobStatus: "queued" | "building" | null;
}

export interface PackKickResult {
  decision: PackKickDecision;
  publishedPackVersionIds: string[];
  /** The drain's failure, when it failed. The build job itself
   *  carries the same error (runBuildJob fails the job before the
   *  drain rethrows); the trip simply keeps waiting. */
  error: string | null;
}

export async function decidePackKick(
  store: PackStore,
  destinationId: string,
  now: Date = new Date()
): Promise<PackKickDecision> {
  const ready = await store.getReadyVersion(destinationId);
  if (ready) return { kick: false, reason: "pack-ready", jobId: null, jobStatus: null };
  const jobs = await store.listBuildJobs(destinationId);
  // Enqueue coalescing guarantees at most one live job per
  // destination; the find is over that single candidate.
  const live = jobs.find((j) => j.status === "queued" || j.status === "building");
  if (!live) return { kick: false, reason: "no-queued-build", jobId: null, jobStatus: null };
  if (live.status === "building") {
    const leaseLive = live.lease !== null && new Date(live.lease.expiresAt).getTime() > now.getTime();
    if (leaseLive) return { kick: false, reason: "build-in-flight", jobId: live.jobId, jobStatus: "building" };
    // Expired lease: the holder stopped heartbeating and is gone.
    // The job is claimable again — by steal, under fencing — so it
    // is exactly as kickable as a queued one.
    return { kick: true, reason: "queued-build-waiting", jobId: live.jobId, jobStatus: "building" };
  }
  return { kick: true, reason: "queued-build-waiting", jobId: live.jobId, jobStatus: "queued" };
}

export interface RunPackKickOptions {
  collectorFor?: (destinationId: string) => PackCollector;
  workerId?: string;
}

/** Decide, and when the decision is to kick, drain this
 *  destination's queued build through the same drain the cron
 *  calls. Never throws: a failed drain is a returned error, and
 *  the caller's trip stays honestly waiting either way. */
export async function runPackKick(
  store: PackStore,
  destinationId: string,
  options: RunPackKickOptions = {}
): Promise<PackKickResult> {
  const decision = await decidePackKick(store, destinationId);
  if (!decision.kick || !decision.jobId) return { decision, publishedPackVersionIds: [], error: null };
  const collectorFor = options.collectorFor ?? (() => liveCollector());
  const workerId = options.workerId ?? "pack-kick";
  try {
    if (decision.jobStatus === "building") {
      // Expired-lease steal: runBuildJob's claim is the arbiter — it
      // steals under fencing, or returns null if a fresh claim raced
      // in first (published nothing, no error: someone else owns
      // the build now, which is the honest outcome).
      const done = await runBuildJob(store, decision.jobId, collectorFor(destinationId), { workerId });
      return { decision, publishedPackVersionIds: done ? [done.dto.packVersionId] : [], error: null };
    }
    const published = await drainQueuedBuilds(store, collectorFor, { workerId, onlyDestinationId: destinationId });
    return { decision, publishedPackVersionIds: published.map((v) => v.dto.packVersionId), error: null };
  } catch (err) {
    return { decision, publishedPackVersionIds: [], error: err instanceof Error ? err.message : String(err) };
  }
}
