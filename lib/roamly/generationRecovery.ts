/**
 * KF-2 STRANDED-GENERATION RECOVERY SWEEP (2026-11-02).
 *
 * The staged state machine can re-drive a mid-flight generation after
 * its leases lapse, but several driver failures (see
 * harness/diagnosis/KF2-DIAGNOSIS.md, mechanisms M1–M4/M6) leave a
 * trip with a non-terminal staged state that no automatic path ever
 * drives again: a running job whose driver died, a retry-exhausted
 * failed job whose staged state is still mid-flight, or a staged
 * state with no active job at all. This sweep finds those trips by
 * PROGRESS evidence — never by wall-clock-since-creation alone — and
 * drives each one through the ordinary targeted worker path
 * (processGenerationQueue by trip), which claims/reclaims the job
 * through the existing claim RPCs. It never alters job-creation
 * semantics, the get-or-create RPC contract, or stage transitions:
 * the only write it makes itself is the guarded reopen of a
 * retry-exhausted failed job (class B), mirroring
 * reopenResumableFailedJob's field set.
 *
 * Detection law:
 *  - STRANDED = no progress for >= STRANDED_GENERATION_MIN_AGE_MS
 *    (285s = the staged stage lease, 240s, plus the longest day-stage
 *    timeout, 45s — the same geometry the staged watchdog uses for
 *    stranded batches) AND the staged state's worker lease is absent
 *    or expired.
 *  - Progress timestamp = staged state.updatedAt; a batch flipped to
 *    "generating" with a recent updatedAt also counts as progress
 *    (its updatedAt is the freshest evidence a stage is alive).
 *  - SKIP, always: completed generations (never resurrect), terminal
 *    failed states, live staged leases, fresh progress, terminal
 *    trips, and jobs with a live queue lease.
 *  - STATE SOURCE (GAP-CLOSURE 5a): the staged state is read from
 *    roamly_trip_generation_states when a row exists for the trip
 *    (the table wins on any disagreement) and from trip metadata
 *    otherwise — see resolveState below.
 *  - PERSISTED TRACE (RECOVERY-EVENTS ADDENDUM 2026-11-03): every
 *    candidate ACTION this sweep takes also writes one
 *    `generation_recovery` row to the existing roamly_app_events
 *    store (via recordAppEvent — the same helper/pattern as the
 *    cron heartbeats), so stranded-incident counts and recovery
 *    outcomes stay readable after the fact; before this, the sweep
 *    logged to console only and its reopen erased the job's error
 *    fields. Scan-level skips stay aggregate-only (summary
 *    counters), by design: they are not actions taken on a
 *    candidate. Event volume is inherently tiny — recoveries are
 *    rare, at most `limit` (default 3) actions per sweep run.
 *    Emission is FAIL-SOFT: a failed event write never blocks or
 *    alters the recovery action it describes.
 *
 * F8 ADDENDUM (SPEED FIX, 2026-11-07) — two structural blind spots
 * the crawl investigation found in this sweep:
 *  - PACK-WAIT INVISIBILITY: a trip waiting for its destination's
 *    pack build persisted a fresh updatedAt on every wait cycle,
 *    so its progress clock never aged and the sweep could never
 *    see it (trips waited 41–78 min invisibly). The engine now
 *    stamps a NAMED state (state.waitingOnPack, since = the first
 *    wait cycle). Here: (a) the progress clock caps at
 *    waitingOnPack.since — wait cycles are not progress; (b)
 *    phases 1–2 do not misclassify a waiting trip as a driver
 *    failure (its own wakes + the pack lanes own it; a waiting
 *    trip whose job has VANISHED still lands in class C, where a
 *    drive is the cure); (c) Phase 3 below surfaces any wait
 *    older than PACK_WAIT_ALARM_MS in the summary and as a
 *    throttled `pack_wait_alarm` recovery event.
 *  - ZOMBIE SATURATION: a job whose reopen -> fail cycle repeats
 *    forever consumed one of the sweep's `limit` drives on every
 *    run, oldest-first, starving real recoveries (2026-11-07:
 *    184 recovery actions, all on the same 7 tester trips). The
 *    sweep now counts a trip's completed reopen cycles from its
 *    own persisted trace; at DEAD_LETTER_MAX_REOPENS the trip is
 *    DEAD-LETTERED instead of reopened: a named
 *    `generation_recovery_dead_letter` event surfaces it as a
 *    zombie, and the sweep never spends another drive on it. The
 *    traveller's own wakes are unaffected (they never consult
 *    this sweep) — only the sweep's budget is protected. The
 *    ledger read is FAIL-SOFT like event emission: an unreadable
 *    trace degrades to today's behaviour, never to a broken sweep.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAppEvent } from "@/lib/roamly/events";
import { logGenerationDiagnostic } from "@/lib/roamly/generationDiagnostics";
import { generationTripIsTerminal } from "@/lib/roamly/generationLifecycle";
import { processGenerationQueue } from "@/lib/roamly/generationWorker";
import {
  canResumeStagedGeneration,
  getStagedGenerationState,
  STAGED_GENERATION_STAGE_TIMEOUTS_MS,
  type StagedGenerationState
} from "@/lib/roamly/stagedItineraryGeneration";
import {
  readGenerationStateRow,
  readGenerationStateRows,
  type GenerationStateRow
} from "@/lib/roamly/generationStateStore";

// STAGE_LEASE_MS in stagedItineraryGeneration.ts (line ~225) is
// `Number(env.ROAMLY_STAGED_GENERATION_LEASE_MS || 4 * 60_000)` and is
// not exported; its 240s default is mirrored here so the stranded age
// below stays tied to the staged module's own watchdog geometry
// (STRANDED_BATCH_MIN_AGE_MS there = STAGE_LEASE_MS + DAY_TIMEOUT_MS).
const STAGE_LEASE_MS = 240_000;
export const STRANDED_GENERATION_MIN_AGE_MS =
  STAGE_LEASE_MS + STAGED_GENERATION_STAGE_TIMEOUTS_MS.day_batch; // 285_000

const RECOVERY_DRIVE_BUDGET_MS = 270_000;
const SCAN_LIMIT = 50;
const ACTIVE_JOB_STATUSES = ["queued", "running", "waiting"];

export const GENERATION_RECOVERY_EVENT_TYPE = "generation_recovery";

/** F8: the dead-letter event type — the persisted, named surfacing
 *  of a zombie trip (see the header addendum). */
export const GENERATION_DEAD_LETTER_EVENT_TYPE = "generation_recovery_dead_letter";

/** F8: completed reopen -> fail cycles after which a job is
 *  dead-lettered instead of reopened again. Three full cycles is
 *  a generous budget for a genuinely recoverable job (each cycle
 *  is a fresh claim + a full drive); past it, the failure is a
 *  property of the trip, not of the driver. */
export const DEAD_LETTER_MAX_REOPENS = 3;

/** F8: a pack wait older than this is surfaced by Phase 3 (the
 *  crawl's waits ran 41–78 min; a healthy drive finishes a build
 *  in well under 10). */
export const PACK_WAIT_ALARM_MS = 600_000;

/** F8: minimum spacing between pack_wait_alarm events for one
 *  trip, so a long wait surfaces repeatedly but never floods. */
const PACK_WAIT_ALARM_REPEAT_MS = 1_800_000;

/** F8: bound on the per-run recovery-ledger read (the sweep's own
 *  trace: recovery + dead-letter events, newest first). Past this
 *  many events a trip's older cycles age out of the count — the
 *  count only gates the dead-letter, and recent cycles are the
 *  evidence that matters. */
const RECOVERY_LEDGER_LIMIT = 1000;

type RecoveryEventCandidate = {
  tripId: string;
  userId: string;
  jobId: string | null;
  cls: StrandedGenerationRecoveryClass;
  progressMs: number;
};

/**
 * Persist one `generation_recovery` app event for a candidate action
 * (see the header's PERSISTED TRACE note). Metadata mirrors the
 * candidate record: tripId, jobId, recoveryClass, action, outcome,
 * plus the staleness actually observed when the candidate was found.
 * FAIL-SOFT by law: recordAppEvent already resolves with an error
 * field instead of throwing on insert failures, and any unexpected
 * throw is swallowed here too — observability must never break the
 * recovery it observes (same law as recordCronHeartbeat).
 */
async function recordRecoveryEvent(
  admin: SupabaseClient,
  candidate: RecoveryEventCandidate,
  action: string,
  outcome: string,
  nowMs: number,
  extra?: { reopened?: boolean }
) {
  try {
    await recordAppEvent(admin, {
      userId: candidate.userId,
      eventType: GENERATION_RECOVERY_EVENT_TYPE,
      metadata: {
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        recoveryClass: candidate.cls,
        action,
        outcome,
        stalenessSeconds: Math.max(0, Math.round((nowMs - candidate.progressMs) / 1000)),
        ...(extra?.reopened ? { reopened: true } : {})
      }
    });
  } catch {
    // Swallowed deliberately — see the fail-soft law above.
  }
}

export type StrandedGenerationRecoveryClass =
  | "dead_driver"
  | "retry_exhausted"
  | "no_active_job"
  /** F8: the trip is in the named pack-wait state (Phase 3
   *  visibility only — never a drive class). */
  | "waiting_on_pack";

/**
 * Persist the F8 dead-letter surfacing for one zombie trip: a
 * `generation_recovery_dead_letter` app event naming the trip, its
 * job, and the reopen-cycle count that condemned it. This event
 * is the operator surface for zombies (the sweep's later runs
 * read it back through the ledger and skip the trip). FAIL-SOFT,
 * same law as recordRecoveryEvent.
 */
async function recordDeadLetterEvent(
  admin: SupabaseClient,
  candidate: RecoveryEventCandidate,
  reopenCycles: number,
  nowMs: number
) {
  try {
    await recordAppEvent(admin, {
      userId: candidate.userId,
      eventType: GENERATION_DEAD_LETTER_EVENT_TYPE,
      metadata: {
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        recoveryClass: candidate.cls,
        action: "dead_letter",
        outcome: "zombie_dead_lettered",
        reopenCycles,
        stalenessSeconds: Math.max(0, Math.round((nowMs - candidate.progressMs) / 1000))
      }
    });
  } catch {
    // Swallowed deliberately — see the fail-soft law above.
  }
}

/** The sweep's own persisted trace, read back once per run (F8):
 *  which trips are already dead-lettered, how many completed
 *  reopen cycles each trip has burned, and when each trip last
 *  raised a pack-wait alarm. FAIL-SOFT: any read failure yields
 *  an empty ledger and the sweep behaves exactly as it did
 *  before F8 — observability never breaks recovery. */
type RecoveryLedger = {
  deadLetteredTripIds: Set<string>;
  reopenCounts: Map<string, number>;
  lastPackWaitAlarmMs: Map<string, number>;
};

async function loadRecoveryLedger(admin: SupabaseClient): Promise<RecoveryLedger> {
  const ledger: RecoveryLedger = {
    deadLetteredTripIds: new Set(),
    reopenCounts: new Map(),
    lastPackWaitAlarmMs: new Map()
  };
  try {
    const { data, error } = await admin
      .from("roamly_app_events")
      .select("event_type,metadata,created_at")
      .in("event_type", [GENERATION_RECOVERY_EVENT_TYPE, GENERATION_DEAD_LETTER_EVENT_TYPE])
      .order("created_at", { ascending: false })
      .limit(RECOVERY_LEDGER_LIMIT);
    if (error || !Array.isArray(data)) return ledger;
    for (const row of data as { event_type?: unknown; metadata?: unknown; created_at?: unknown }[]) {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const tripId = typeof metadata.tripId === "string" ? metadata.tripId : null;
      if (!tripId) continue;
      if (row.event_type === GENERATION_DEAD_LETTER_EVENT_TYPE) {
        ledger.deadLetteredTripIds.add(tripId);
        continue;
      }
      if (metadata.action === "reopen_and_drive" && metadata.reopened === true) {
        ledger.reopenCounts.set(tripId, (ledger.reopenCounts.get(tripId) ?? 0) + 1);
      }
      if (metadata.action === "pack_wait_alarm") {
        const at = parseMs(typeof row.created_at === "string" ? row.created_at : null);
        if (at > (ledger.lastPackWaitAlarmMs.get(tripId) ?? 0)) {
          ledger.lastPackWaitAlarmMs.set(tripId, at);
        }
      }
    }
  } catch {
    // Fail-soft — see the header of this function.
  }
  return ledger;
}

export type StrandedGenerationRecoveryCandidate = {
  tripId: string;
  jobId: string | null;
  class: StrandedGenerationRecoveryClass;
  action: string;
  result: unknown;
};

export type StrandedGenerationRecoverySummary = {
  scanned: number;
  candidates: StrandedGenerationRecoveryCandidate[];
  reopened: number;
  driven: number;
  skippedLive: number;
  /** F8: trips dead-lettered on THIS run (they also appear in
   *  `zombies`). */
  deadLettered: number;
  /** F8: candidates skipped because their trip was already
   *  dead-lettered on an earlier run. */
  skippedDeadLettered: number;
  /** F8: the zombies surfaced on this run — named, with the
   *  reopen-cycle count that condemned them. */
  zombies: { tripId: string; jobId: string | null; reopenCycles: number }[];
  /** F8: pack waits older than PACK_WAIT_ALARM_MS seen on this
   *  run (Phase 3), oldest first. Visibility only: no drive is
   *  spent on them. */
  packWaits: { tripId: string; destinationId: string; ageSeconds: number }[];
  /** F8: pack_wait_alarm events actually emitted on this run
   *  (throttled per trip). */
  packWaitAlarms: number;
  /** Set only by callers reporting a sweep-level failure fallback. */
  error?: string;
};

type JobRow = {
  id: string;
  trip_id: string;
  user_id: string;
  status: string;
  retry_count: number | null;
  lease_expires_at: string | null;
  completed_at: string | null;
};

type TripRow = {
  id: string;
  user_id: string;
  metadata: unknown;
  status?: string | null;
  itinerary_status?: string | null;
};

const JOB_COLUMNS = "id,trip_id,user_id,status,retry_count,lease_expires_at,completed_at,updated_at";
const TRIP_COLUMNS = "id,user_id,metadata,status,itinerary_status,updated_at";

function parseMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Freshest progress evidence on the staged state (see header).
 *  F8: a pack-waiting state's progress is capped at the wait's
 *  start — every wait cycle re-persists the state (refreshing
 *  updatedAt), but waiting is not progress, so the freshest
 *  honest progress evidence for a waiting trip is the moment it
 *  entered the wait. */
function lastProgressMs(state: StagedGenerationState) {
  let latest = parseMs(state.updatedAt);
  for (const batch of Object.values(state.batches || {})) {
    if (batch.status !== "generating") continue;
    latest = Math.max(latest, parseMs(batch.updatedAt || batch.startedAt));
  }
  if (state.waitingOnPack?.since) {
    latest = Math.min(latest, parseMs(state.waitingOnPack.since));
  }
  return latest;
}

function stagedLeaseLive(state: StagedGenerationState, nowMs: number) {
  return parseMs(state.worker?.leaseExpiresAt) > nowMs;
}

function isStranded(state: StagedGenerationState, nowMs: number) {
  return nowMs - lastProgressMs(state) >= STRANDED_GENERATION_MIN_AGE_MS;
}

function isTerminalFailedState(state: StagedGenerationState) {
  return (state.status === "failed" || state.status === "partially_failed") && !canResumeStagedGeneration(state);
}

/** Mid-flight statuses that are continuable by an ordinary advance. */
function isNonTerminalState(state: StagedGenerationState) {
  return state.status !== "complete" && state.status !== "failed" && state.status !== "partially_failed";
}

export async function runStrandedGenerationRecovery(
  admin: SupabaseClient,
  opts: {
    now?: Date;
    limit?: number;
    drive?: (tripId: string, userId: string) => Promise<unknown>;
  } = {}
): Promise<StrandedGenerationRecoverySummary> {
  const summary: StrandedGenerationRecoverySummary = {
    scanned: 0,
    candidates: [],
    reopened: 0,
    driven: 0,
    skippedLive: 0,
    deadLettered: 0,
    skippedDeadLettered: 0,
    zombies: [],
    packWaits: [],
    packWaitAlarms: 0
  };
  if (!admin) return summary;

  // F8: the sweep's own trace, read once (fail-soft — an empty
  // ledger reproduces the pre-F8 behaviour exactly).
  const ledger = await loadRecoveryLedger(admin);

  const now = opts.now || new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(10, Math.round(opts.limit ?? 3)));
  const drive =
    opts.drive ||
    ((tripId: string, userId: string) =>
      processGenerationQueue({
        tripId,
        userId,
        reason: "stranded_generation_recovery",
        executionDeadlineMs: nowMs + RECOVERY_DRIVE_BUDGET_MS
      }));

  type Found = {
    tripId: string;
    userId: string;
    jobId: string | null;
    cls: StrandedGenerationRecoveryClass;
    progressMs: number;
  };
  const found: Found[] = [];
  const seenTripIds = new Set<string>();

  const loadTrip = async (tripId: string): Promise<TripRow | null> => {
    const { data, error } = await admin
      .from("roamly_trips")
      .select(TRIP_COLUMNS)
      .eq("id", tripId)
      .maybeSingle();
    if (error || !data) return null;
    return data as TripRow;
  };

  // GAP-CLOSURE 5a — STATE-FIRST READS with metadata fallback.
  // DISAGREEMENT RULE: when a row exists in
  // roamly_trip_generation_states it is authoritative — the table
  // state wins over the metadata state, even when they disagree.
  // Trip metadata is consulted ONLY when no row exists (mixed fleet:
  // a trip mid-generation when the migration landed carries state
  // only in metadata until its next persist dual-writes it) or when
  // the states read failed — the store helpers are fail-soft and
  // return null / an empty map on any error, including the table not
  // existing yet pre-migration, so this sweep behaves exactly as
  // before in a metadata-only world.
  const resolveState = (trip: TripRow, row: GenerationStateRow | null): StagedGenerationState | null =>
    row
      ? getStagedGenerationState({ generation: row.state }, trip.id)
      : getStagedGenerationState(trip.metadata, trip.id);

  // Shared state-side gates for every class. Returns the state when it
  // is a recovery candidate shape, or null (counting live-lease skips).
  const strandedState = (trip: TripRow, state: StagedGenerationState | null): StagedGenerationState | null => {
    if (!state) return null;
    if (state.status === "complete") return null; // never resurrect a completed generation
    if (isTerminalFailedState(state)) return null;
    if (stagedLeaseLive(state, nowMs)) {
      summary.skippedLive += 1;
      return null;
    }
    if (!isStranded(state, nowMs)) return null;
    return state;
  };

  // --- Phase 1: jobs that can no longer drive themselves -----------
  // Class A (dead_driver): running job, queue lease expired.
  // Class B (retry_exhausted): failed job, retry_count >= 3,
  // completed_at null, staged state still mid-flight / resumable.
  const jobsResult = await admin
    .from("roamly_trip_generation_jobs")
    .select(JOB_COLUMNS)
    .in("status", ["running", "failed"])
    .order("updated_at", { ascending: true })
    .limit(SCAN_LIMIT);
  if (jobsResult.error) {
    logGenerationDiagnostic("generation_recovery_scan_failed", {
      route: "generationRecovery",
      errorCode: jobsResult.error.message,
      phase: "jobs"
    });
    return summary;
  }
  for (const rawJob of jobsResult.data || []) {
    const job = rawJob as JobRow;
    if (!job.trip_id || seenTripIds.has(job.trip_id)) continue;
    seenTripIds.add(job.trip_id);
    const trip = await loadTrip(job.trip_id);
    if (!trip) continue;
    summary.scanned += 1;
    if (generationTripIsTerminal(trip)) continue;
    const stateRow = await readGenerationStateRow(admin, trip.id);
    const state = strandedState(trip, resolveState(trip, stateRow));
    if (!state) continue;
    // F8: a trip in the named pack-wait state is not a driver
    // failure — its stall has a named owner (the pack lanes) and
    // a named surface (Phase 3). Phase 1 never reopens or
    // "recovers" it; if its job has vanished entirely, Phase 2's
    // no-active-job class is where a drive can still cure it.
    if (state.waitingOnPack) continue;

    if (job.status === "running") {
      const queueLeaseExpired = !job.lease_expires_at || parseMs(job.lease_expires_at) <= nowMs;
      if (!queueLeaseExpired) {
        summary.skippedLive += 1;
        continue;
      }
      if (!isNonTerminalState(state)) continue;
      found.push({
        tripId: trip.id,
        userId: trip.user_id,
        jobId: job.id,
        cls: "dead_driver",
        progressMs: lastProgressMs(state)
      });
      continue;
    }

    // job.status === "failed"
    if ((job.retry_count ?? 0) < 3 || job.completed_at) continue;
    const resumable = canResumeStagedGeneration(state);
    const midFlight = state.status === "generating_outline" || state.status === "generating_day";
    if (!resumable && !midFlight) continue;
    found.push({
      tripId: trip.id,
      userId: trip.user_id,
      jobId: job.id,
      cls: "retry_exhausted",
      progressMs: lastProgressMs(state)
    });
  }

  // --- Phase 2: legacy scan set, staged state, no active job -------
  // Class C (no_active_job): the sweeper's own adoption set
  // (itinerary_status in generating/generated/locked) with a stranded
  // non-terminal state and no queued/running/waiting job. Driving it
  // targeted lets ensureTripJob create the job via the atomic RPC.
  const tripsResult = await admin
    .from("roamly_trips")
    .select(TRIP_COLUMNS)
    .in("itinerary_status", ["generating", "generated", "locked"])
    .order("updated_at", { ascending: true })
    .limit(SCAN_LIMIT);
  if (tripsResult.error) {
    logGenerationDiagnostic("generation_recovery_scan_failed", {
      route: "generationRecovery",
      errorCode: tripsResult.error.message,
      phase: "trips"
    });
    return summary;
  }
  // GAP-CLOSURE 5a: one batched states read for the whole trip scan
  // (bounded by the same SCAN_LIMIT as the scan itself) — a trip with
  // a row is judged by its table state, the rest by metadata.
  const scannedTripIds = ((tripsResult.data || []) as TripRow[])
    .map((trip) => trip.id)
    .filter((tripId): tripId is string => Boolean(tripId));
  const stateRows = await readGenerationStateRows(admin, scannedTripIds);
  for (const rawTrip of tripsResult.data || []) {
    const trip = rawTrip as TripRow;
    if (!trip.id || seenTripIds.has(trip.id)) continue;
    seenTripIds.add(trip.id);
    summary.scanned += 1;
    if (generationTripIsTerminal(trip)) continue;
    const state = strandedState(trip, resolveState(trip, stateRows.get(trip.id) ?? null));
    if (!state) continue;
    if (!isNonTerminalState(state) && !canResumeStagedGeneration(state)) continue;

    const activeResult = await admin
      .from("roamly_trip_generation_jobs")
      .select("id,status")
      .eq("trip_id", trip.id)
      .in("status", ACTIVE_JOB_STATUSES)
      .limit(1);
    if (activeResult.error || (activeResult.data || []).length > 0) continue;

    found.push({
      tripId: trip.id,
      userId: trip.user_id,
      jobId: null,
      cls: "no_active_job",
      progressMs: lastProgressMs(state)
    });
  }

  // Oldest progress first; at most `limit` drives per run.
  found.sort((a, b) => a.progressMs - b.progressMs);
  logGenerationDiagnostic("generation_recovery_scan_completed", {
    route: "generationRecovery",
    scanned: summary.scanned,
    candidateCount: found.length,
    selectedCount: Math.min(limit, found.length),
    skippedLive: summary.skippedLive
  });

  let drivesUsed = 0;
  for (const candidate of found) {
    // F8 DEAD-LETTER GATE — applied here, at selection, never
    // during the candidate scan above: a run that skips
    // everything must leave the store byte-identical (the
    // stranded suite's skip cases pin that), and a dead-letter
    // write is a state change that belongs to a selected
    // candidate. A dead-lettered trip consumes NO drive slot, so
    // zombies can no longer starve the limit (header addendum).
    if (ledger.deadLetteredTripIds.has(candidate.tripId)) {
      summary.skippedDeadLettered += 1;
      logGenerationDiagnostic("generation_recovery_dead_lettered_skip", {
        route: "generationRecovery",
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        candidateClass: candidate.cls
      });
      continue;
    }
    if (candidate.cls === "retry_exhausted") {
      const reopenCycles = ledger.reopenCounts.get(candidate.tripId) ?? 0;
      if (reopenCycles >= DEAD_LETTER_MAX_REOPENS) {
        await recordDeadLetterEvent(admin, candidate, reopenCycles, nowMs);
        ledger.deadLetteredTripIds.add(candidate.tripId);
        summary.deadLettered += 1;
        summary.zombies.push({ tripId: candidate.tripId, jobId: candidate.jobId, reopenCycles });
        logGenerationDiagnostic("generation_recovery_dead_lettered", {
          route: "generationRecovery",
          tripId: candidate.tripId,
          jobId: candidate.jobId,
          reopenCycles
        });
        continue;
      }
    }
    if (drivesUsed >= limit) break;
    drivesUsed += 1;

    if (candidate.cls === "retry_exhausted" && candidate.jobId) {
      // Generalized reopen (KF-2 §4.4 case 2): the same field set as
      // reopenResumableFailedJob, but guarded on the exhausted shape
      // itself (status='failed' AND retry_count>=3) so a concurrent
      // claim/reopen wins the race and this update simply misses.
      const reopen = await admin
        .from("roamly_trip_generation_jobs")
        .update({
          status: "waiting",
          retry_count: 0,
          next_attempt_at: nowIso,
          locked_at: null,
          locked_by: null,
          lease_expires_at: null,
          last_error_code: null,
          last_error_message: null
        })
        .eq("id", candidate.jobId)
        .eq("status", "failed")
        .gte("retry_count", 3)
        .select("id");
      const reopenedRows = Array.isArray(reopen.data) ? reopen.data : null;
      if (reopen.error || (reopenedRows !== null && reopenedRows.length === 0)) {
        logGenerationDiagnostic("generation_recovery_reopen_missed", {
          route: "generationRecovery",
          tripId: candidate.tripId,
          jobId: candidate.jobId,
          errorCode: reopen.error?.message || "REOPEN_RACE_LOST"
        });
        const missedOutcome = reopen.error ? "reopen_failed" : "reopen_race_lost";
        summary.candidates.push({
          tripId: candidate.tripId,
          jobId: candidate.jobId,
          class: candidate.cls,
          action: "reopen_and_drive",
          result: missedOutcome
        });
        await recordRecoveryEvent(admin, candidate, "reopen_and_drive", missedOutcome, nowMs);
        continue;
      }
      summary.reopened += 1;
      logGenerationDiagnostic("generation_recovery_reopened", {
        route: "generationRecovery",
        tripId: candidate.tripId,
        jobId: candidate.jobId
      });
    }

    const action = candidate.cls === "retry_exhausted" ? "reopen_and_drive" : "drive";
    try {
      const result = await drive(candidate.tripId, candidate.userId);
      summary.driven += 1;
      logGenerationDiagnostic("generation_recovery_driven", {
        route: "generationRecovery",
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        candidateClass: candidate.cls,
        action
      });
      summary.candidates.push({
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        class: candidate.cls,
        action,
        result
      });
      await recordRecoveryEvent(admin, candidate, action, "driven", nowMs, {
        reopened: candidate.cls === "retry_exhausted"
      });
    } catch (error) {
      logGenerationDiagnostic("generation_recovery_drive_failed", {
        route: "generationRecovery",
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        candidateClass: candidate.cls,
        errorCode: error instanceof Error ? error.message : "GENERATION_RECOVERY_DRIVE_FAILED"
      });
      summary.candidates.push({
        tripId: candidate.tripId,
        jobId: candidate.jobId,
        class: candidate.cls,
        action,
        result: "drive_failed"
      });
      await recordRecoveryEvent(admin, candidate, action, "drive_failed", nowMs, {
        reopened: candidate.cls === "retry_exhausted"
      });
    }
  }

  // Phase 3 (F8): PACK-WAIT VISIBILITY. Trips in the named
  // pack-wait state hold a `waiting` job, so phases 1–2 never see
  // them as stranded — by design: the pack lanes own the wait.
  // What the sweep owes them is a NAME and an ALARM when the wait
  // outlasts a healthy build: every wait older than
  // PACK_WAIT_ALARM_MS lands in summary.packWaits, and one
  // throttled pack_wait_alarm recovery event per trip per
  // PACK_WAIT_ALARM_REPEAT_MS makes it queryable in the same
  // trace as every other recovery action. No drive is spent here.
  const waitingResult = await admin
    .from("roamly_trip_generation_jobs")
    .select(JOB_COLUMNS)
    .eq("status", "waiting")
    .order("updated_at", { ascending: true })
    .limit(SCAN_LIMIT);
  if (!waitingResult.error) {
    const seenWaitingTripIds = new Set<string>();
    for (const row of (waitingResult.data || []) as JobRow[]) {
      if (!row.trip_id || seenWaitingTripIds.has(row.trip_id)) continue;
      seenWaitingTripIds.add(row.trip_id);
      const trip = await loadTrip(row.trip_id);
      if (!trip || generationTripIsTerminal(trip)) continue;
      const stateRow = await readGenerationStateRow(admin, trip.id);
      const state = resolveState(trip, stateRow);
      const wait = state?.waitingOnPack;
      if (!wait) continue;
      const sinceMs = parseMs(wait.since);
      if (!sinceMs) continue;
      const ageMs = nowMs - sinceMs;
      if (ageMs < PACK_WAIT_ALARM_MS) continue;
      summary.packWaits.push({
        tripId: trip.id,
        destinationId: wait.destinationId,
        ageSeconds: Math.round(ageMs / 1000)
      });
      const lastAlarmMs = ledger.lastPackWaitAlarmMs.get(trip.id) ?? 0;
      if (nowMs - lastAlarmMs >= PACK_WAIT_ALARM_REPEAT_MS) {
        await recordRecoveryEvent(
          admin,
          { tripId: trip.id, userId: trip.user_id, jobId: row.id, cls: "waiting_on_pack", progressMs: sinceMs },
          "pack_wait_alarm",
          "waiting_on_pack",
          nowMs
        );
        ledger.lastPackWaitAlarmMs.set(trip.id, nowMs);
        summary.packWaitAlarms += 1;
      }
    }
    summary.packWaits.sort((a, b) => b.ageSeconds - a.ageSeconds);
  }

  return summary;
}
