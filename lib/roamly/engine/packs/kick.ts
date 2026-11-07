import { drainQueuedBuilds, KICK_BUILD_BUDGET_MS, primaryCollector, type PackCollector } from "@/lib/roamly/engine/packs/builder";
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
 *   - The kick NEVER steals a held job (2026-10-22/23 kill-loop
 *     fix): a "building" job whose lease has EXPIRED is RECYCLED
 *     to "queued" under the store's release fencing — never
 *     built on — and the ordinary queued drain then starts it
 *     fresh inside the kick budget. The steal is what re-armed
 *     the kill loop, so it is gone from kick context entirely.
 *   - Every kick build runs inside KICK_BUILD_BUDGET_MS (45 s):
 *     when the collector outlasts the budget the job is released
 *     back to "queued" (no failure recorded) instead of being
 *     hard-killed mid-claim; the 300 s hourly cron does the real
 *     build.
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
   *  reaches the kick only with an expired lease (see decidePackKick):
   *  runPackKick recycles it to "queued" via releaseBuild (never a
   *  steal) and then runs the ordinary queued drain inside the kick
   *  budget. */
  jobStatus: "queued" | "building" | null;
  /** The job's current lease fencing token (set only when
   *  jobStatus is "building"): runPackKick presents it to
   *  releaseBuild. */
  leaseId: string | null;
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
  if (ready) return { kick: false, reason: "pack-ready", jobId: null, jobStatus: null, leaseId: null };
  const jobs = await store.listBuildJobs(destinationId);
  // Enqueue coalescing guarantees at most one live job per
  // destination; the find is over that single candidate.
  const live = jobs.find((j) => j.status === "queued" || j.status === "building");
  if (!live) return { kick: false, reason: "no-queued-build", jobId: null, jobStatus: null, leaseId: null };
  if (live.status === "building") {
    const leaseLive = live.lease !== null && new Date(live.lease.expiresAt).getTime() > now.getTime();
    if (leaseLive) return { kick: false, reason: "build-in-flight", jobId: live.jobId, jobStatus: "building", leaseId: null };
    // Expired lease: the holder is gone. The kick recycles the
    // job to "queued" (releaseBuild, fencing-guarded) instead of
    // stealing it — see runPackKick. It is exactly as kickable as
    // a queued one, with none of the steal's kill-loop risk.
    return { kick: true, reason: "queued-build-waiting", jobId: live.jobId, jobStatus: "building", leaseId: live.lease ? live.lease.leaseId : null };
  }
  return { kick: true, reason: "queued-build-waiting", jobId: live.jobId, jobStatus: "queued", leaseId: null };
}

export interface RunPackKickOptions {
  collectorFor?: (destinationId: string) => PackCollector;
  workerId?: string;
  /** Override for the kick-scoped build budget (default
   *  KICK_BUILD_BUDGET_MS); tests use short budgets. */
  kickBudgetMs?: number;
}

/* ------------------------------------------------------------------ */
/* Continuous pack drive (SPEED FIX, 2026-11-07)                       */
/*                                                                     */
/* The kick above starts a build; it was never able to FINISH a       */
/* big-city one — its 45 s budget releases the job back to queued     */
/* by design, and only the hourly pack-refresh cron could complete    */
/* the build (CRAWL-INVESTIGATION-REPORT: fresh trips waited 41–78    */
/* minutes, 87–94% of it pure timer wait). drivePackBuild closes      */
/* that: it is the kick, looped inside the requesting trip's own      */
/* post-response work, with each attempt's budget sized to the        */
/* drive's remaining lifetime instead of 45 s. A budget-released      */
/* build is re-decided and re-claimed IMMEDIATELY (same function,     */
/* same fencing — the release is the store's own, under the lease     */
/* the attempt held), so a build runs to completion in the window     */
/* of the request that needs it. The hourly cron stays as the         */
/* backstop for builds that outlast even the drive budget and for     */
/* stale-pack refreshes, exactly as before.                           */
/*                                                                     */
/* The drive stops at the first terminal signal: pack published,      */
/* pack already serving, no live build, a build claimed under a       */
/* live lease by someone else (their drive owns it), or a recorded    */
/* build failure (the job failed honestly inside the drain — the      */
/* trip keeps waiting for the next wake; looping on a failed          */
/* collector would just spin against a broken upstream). It never     */
/* throws, mirroring runPackKick.                                     */
/* ------------------------------------------------------------------ */

/** Total wall-clock budget for one continuous drive. Sized to the
 *  longest function lifetime the drive can run inside (the 300 s
 *  class) with margin for the final release/publish writes; the
 *  live Overpass collection deadline (210 s) fits inside it, and
 *  an extract-lane build (seconds) barely touches it. Env
 *  override: ROAMLY_PACK_DRIVE_BUDGET_MS. */
export const PACK_DRIVE_BUDGET_MS = Math.max(
  60_000,
  Number(process.env.ROAMLY_PACK_DRIVE_BUDGET_MS || 270_000) || 270_000
);

export type PackDriveOutcome =
  /** A version published during this drive. */
  | "published"
  /** A ready pack already serves (or published mid-drive). */
  | "pack-ready"
  /** No live build exists for the destination. */
  | "no-queued-build"
  /** A build is claimed under a live lease — another driver owns it. */
  | "build-in-flight"
  /** The drain recorded a build failure; the job carries the error. */
  | "build-failed"
  /** The drive budget ran out with the build still unfinished;
   *  the job is back at "queued" (budget release, no failure
   *  recorded) for the next wake or the hourly backstop. */
  | "budget-exhausted";

export interface PackDriveResult {
  outcome: PackDriveOutcome;
  /** The last kick decision the drive made. */
  decision: PackKickDecision;
  publishedPackVersionIds: string[];
  /** Drain attempts the drive made (1 = the common case). */
  attempts: number;
  elapsedMs: number;
  error: string | null;
}

export interface DrivePackBuildOptions extends RunPackKickOptions {
  /** Total drive budget (default PACK_DRIVE_BUDGET_MS). */
  driveBudgetMs?: number;
  /** Injectable clock (proofs drive the deadline without waiting). */
  now?: () => number;
}

/** Drive one destination's pack build to completion inside the
 *  caller's own window — see the section header. Each attempt is
 *  an ordinary runPackKick whose kick budget is the drive's
 *  remaining time, so an attempt can never be hard-killed
 *  mid-claim by the drive itself: runBuildJob's budget race
 *  releases the job cleanly first. */
export async function drivePackBuild(
  store: PackStore,
  destinationId: string,
  options: DrivePackBuildOptions = {}
): Promise<PackDriveResult> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const deadline = startedAt + (options.driveBudgetMs ?? PACK_DRIVE_BUDGET_MS);
  const publishedPackVersionIds: string[] = [];
  let attempts = 0;
  let lastDecision: PackKickDecision = {
    kick: false,
    reason: "no-queued-build",
    jobId: null,
    jobStatus: null,
    leaseId: null
  };
  const finish = (outcome: PackDriveOutcome, error: string | null = null): PackDriveResult => ({
    outcome,
    decision: lastDecision,
    publishedPackVersionIds,
    attempts,
    elapsedMs: now() - startedAt,
    error
  });
  for (;;) {
    const remainingMs = deadline - now();
    if (attempts > 0 && remainingMs <= 0) return finish("budget-exhausted");
    // Spin guard: a healthy drive needs a handful of attempts at
    // most (each runs the collector until it finishes or the
    // remaining budget expires). A drive that keeps re-deciding
    // without progress is wedged on something the backstop owns.
    if (attempts >= 32) return finish("budget-exhausted");
    attempts += 1;
    const result = await runPackKick(store, destinationId, {
      collectorFor: options.collectorFor,
      workerId: options.workerId ?? "pack-drive",
      kickBudgetMs: Math.max(1_000, remainingMs)
    });
    lastDecision = result.decision;
    publishedPackVersionIds.push(...result.publishedPackVersionIds);
    if (result.error) return finish("build-failed", result.error);
    if (publishedPackVersionIds.length > 0) return finish("published");
    if (!result.decision.kick) {
      if (result.decision.reason === "pack-ready") return finish("pack-ready");
      if (result.decision.reason === "build-in-flight") return finish("build-in-flight");
      return finish("no-queued-build");
    }
    // The decision was to kick and the attempt ended without a
    // publish and without an error: the build was budget-released
    // back to "queued" (or recycled). Loop: re-decide and
    // re-claim immediately, inside the same drive window.
  }
}

/** Decide, and when the decision is to kick, drain this
 *  destination's queued build through the same drain the cron
 *  calls — with the kick budget so a metro-scale build can never
 *  be hard-killed mid-claim. Never throws: a failed drain is a
 *  returned error, and the caller's trip stays honestly waiting
 *  either way. */
export async function runPackKick(
  store: PackStore,
  destinationId: string,
  options: RunPackKickOptions = {}
): Promise<PackKickResult> {
  const decision = await decidePackKick(store, destinationId);
  if (!decision.kick || !decision.jobId) return { decision, publishedPackVersionIds: [], error: null };
  const collectorFor = options.collectorFor ?? (() => primaryCollector());
  const workerId = options.workerId ?? "pack-kick";
  const kickBudgetMs = options.kickBudgetMs ?? KICK_BUILD_BUDGET_MS;
  try {
    if (decision.jobStatus === "building") {
      // Expired-lease recycle (kill-loop fix): yield the dead job
      // back to "queued" under release fencing instead of stealing
      // the build. A lost race (null) means someone else recycled
      // it first — the honest outcome either way is "the queue
      // owns the job", so continue to the ordinary queued drain.
      if (decision.leaseId) {
        await store.releaseBuild(decision.jobId, decision.leaseId);
      }
    }
    const published = await drainQueuedBuilds(store, collectorFor, {
      workerId,
      onlyDestinationId: destinationId,
      kickBudgetMs
    });
    return { decision, publishedPackVersionIds: published.map((v) => v.dto.packVersionId), error: null };
  } catch (err) {
    return { decision, publishedPackVersionIds: [], error: err instanceof Error ? err.message : String(err) };
  }
}
