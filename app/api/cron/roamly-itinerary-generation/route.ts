import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getGenerationWorkerSecrets, scheduleStagedGenerationAdvance } from "@/lib/roamly/stagedGenerationBackground";
import { processGenerationQueue, type RoamlyGenerationWorkerSummary } from "@/lib/roamly/generationWorker";
import { runStuckGenerationDetector } from "@/lib/roamly/silentFailureDetectors";
import { runPackWaitTerminalTransition } from "@/lib/roamly/packWaitTerminalTransition";
import { runBookingMonitorHealthDetector } from "@/lib/roamly/bookingMonitorHealth";
import { runCommunicationStuckDetector } from "@/lib/roamly/communicationStuckDetector";
import { detectorFailureResult, recordBackgroundDetectorFailure } from "@/lib/roamly/observabilityDetectorDiagnostics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generationSweeperHasWork } from "@/lib/roamly/generationWorkGate";
import { runStrandedGenerationRecovery, type StrandedGenerationRecoverySummary } from "@/lib/roamly/generationRecovery";
import { recordCronHeartbeat } from "@/lib/roamly/cronHeartbeat";

export const runtime = "nodejs";
export const maxDuration = 300;

// Budget geometry: a single day stage needs its 45s timeout + the worker's 8s
// cleanup buffer (53s) measured AFTER claim/scan/load overhead, and the pool
// shares one deadline across jobs. The old 55s route budget left ~2s of
// slack, so cron wakes systematically yielded and stranded trips were never
// resumed. 270s keeps 30s of headroom under the 300s platform cap for the
// claim scan and the detector passes that run after the queue.
const ROUTE_EXECUTION_BUDGET_MS = 270_000;

// Re-arm the background driver chain for every trip this wake touched that
// is still in progress. The chain was previously armed only at trip
// creation, so one stall (or one hard-killed driver) disarmed it forever;
// the trip lease arbitrates against the chain duplicating a live driver.
function rearmInProgressTrips(summary: RoamlyGenerationWorkerSummary, request: NextRequest, requestId: string) {
  const origin = new URL(request.url).origin;
  for (const result of summary.results) {
    const status = result.progress?.status;
    if (!result.tripId || result.terminal || !status) continue;
    if (status === "complete" || status === "failed" || status === "partially_failed") continue;
    scheduleStagedGenerationAdvance({
      tripId: result.tripId,
      origin,
      reason: "cron_wake_rearm",
      requestId
    });
  }
}

// KF-2 stranded-generation recovery sweep: runs before the queue
// wake so retry-exhausted / driver-dead / job-less stranded trips are
// reopened and driven first. A sweep failure is recorded like any
// other background detector failure and never fails the wake itself.
async function runRecoverySweep(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<StrandedGenerationRecoverySummary | null> {
  if (!admin) return null;
  return runStrandedGenerationRecovery(admin).catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "stranded_generation_recovery", route: "/api/cron/roamly-itinerary-generation" });
    return {
      scanned: 0,
      candidates: [],
      reopened: 0,
      driven: 0,
      skippedLive: 0,
      deadLettered: 0,
      skippedDeadLettered: 0,
      zombies: [],
      packWaits: [],
      packWaitAlarms: 0,
      error: "STRANDED_GENERATION_RECOVERY_FAILED"
    } as StrandedGenerationRecoverySummary;
  });
}

function authorized(request: NextRequest) {
  const secrets = getGenerationWorkerSecrets();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(token && secrets.includes(token));
}

export async function POST(request: NextRequest) {
  const executionDeadlineMs = Date.now() + ROUTE_EXECUTION_BUDGET_MS;
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  const requestId = typeof body.requestId === "string" && body.requestId ? body.requestId : randomUUID();
  const reason = typeof body.reason === "string" ? body.reason : "protected_worker_wake";

  // Untargeted POSTs are sweeper wakes too: run the KF-2 recovery
  // sweep first (a targeted POST already names its trip).
  const strandedRecovery = tripId ? null : await runRecoverySweep(createSupabaseAdminClient());
  const summary = await processGenerationQueue({
    tripId: tripId || null,
    requestId,
    reason,
    executionDeadlineMs,
    config: tripId
      ? {
          batchSize: 3,
          concurrency: 1,
          maxLayersPerRun: 8
        }
      : undefined
  });
  rearmInProgressTrips(summary, request, requestId);
  // OPTIONAL (incident 2026-10-25, stream 2 — Junel's call, severable):
  // sweep-side pack-wait terminal transition, BEFORE the detector, so a
  // cap-past job is failed loudly instead of being requeued for another
  // wait cycle. Dropping this hunk + lib/roamly/packWaitTerminalTransition.ts
  // removes the option with no other change.
  const packWaitTerminal = await runPackWaitTerminalTransition().catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "pack_wait_terminal_transition", route: "/api/cron/roamly-itinerary-generation" });
    return { ok: false, transitioned: 0, skipped: 0, error: "PACK_WAIT_TERMINAL_FAILED" };
  });
  const detector = await runStuckGenerationDetector().catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "stuck_generation", route: "/api/cron/roamly-itinerary-generation" });
    return detectorFailureResult("stuck_generation");
  });

  return NextResponse.json({ ...summary, strandedRecovery, packWaitTerminalTransition: packWaitTerminal, silentFailureDetector: detector }, { status: summary.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  const executionDeadlineMs = Date.now() + ROUTE_EXECUTION_BUDGET_MS;
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const requestId = randomUUID();
  // EGRESS DIET (F2): work gate. The POST above is the event-driven
  // wake (a write creates a job, the write's request drives it); this
  // GET is only the orphan-recovery sweeper, so when no due jobs, no
  // generating trips and no stuck-ledger rows exist it exits after
  // three head/count checks. The booking-monitor health detector
  // still runs — it is three small reads and it is the watchdog for
  // a different lane. Fail-open: a gate error proceeds normally.
  const gateAdmin = createSupabaseAdminClient();
  const hasWork = gateAdmin ? await generationSweeperHasWork(gateAdmin).catch(() => true) : true;
  if (!hasWork) {
    const bookingMonitorHealth = await runBookingMonitorHealthDetector().catch(async () => {
      await recordBackgroundDetectorFailure({ detector: "booking_monitor_health", route: "/api/cron/roamly-itinerary-generation" });
      return detectorFailureResult("booking_monitor_health");
    });
    // Per-lane measurement (EGRESS DIET): a gated run still leaves
    // its heartbeat row, flagged gated, in roamly_app_events.
    if (gateAdmin) await recordCronHeartbeat(gateAdmin, "roamly-itinerary-generation", true, { gated: true });
    return NextResponse.json(
      {
        ok: true,
        gated: true,
        reason: "no_due_generation_work",
        requestId,
        claimed: 0,
        processed: 0,
        advanced: 0,
        completed: 0,
        failed: 0,
        busy: 0,
        results: [],
        bookingMonitorHealth
      },
      { status: 200 }
    );
  }
  // KF-2: after the gate passes, the stranded-generation recovery
  // sweep runs BEFORE the global queue wake (see runRecoverySweep).
  const strandedRecovery = await runRecoverySweep(gateAdmin);
  const summary = await processGenerationQueue({
    requestId,
    reason: "vercel_cron_wake",
    executionDeadlineMs
  });
  rearmInProgressTrips(summary, request, requestId);
  // OPTIONAL (incident 2026-10-25, stream 2 — Junel's call, severable):
  // see the POST handler note above; same placement, before the detector.
  const packWaitTerminal = await runPackWaitTerminalTransition().catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "pack_wait_terminal_transition", route: "/api/cron/roamly-itinerary-generation" });
    return { ok: false, transitioned: 0, skipped: 0, error: "PACK_WAIT_TERMINAL_FAILED" };
  });
  const detector = await runStuckGenerationDetector().catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "stuck_generation", route: "/api/cron/roamly-itinerary-generation" });
    return detectorFailureResult("stuck_generation");
  });
  const bookingMonitorHealth = await runBookingMonitorHealthDetector().catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "booking_monitor_health", route: "/api/cron/roamly-itinerary-generation" });
    return detectorFailureResult("booking_monitor_health");
  });
  const communicationStuck = await runCommunicationStuckDetector().catch(async () => {
    await recordBackgroundDetectorFailure({ detector: "communication_stuck", route: "/api/cron/roamly-itinerary-generation" });
    return detectorFailureResult("communication_stuck");
  });

  if (gateAdmin) await recordCronHeartbeat(gateAdmin, "roamly-itinerary-generation", summary.ok === true);
  return NextResponse.json({ ...summary, strandedRecovery, packWaitTerminalTransition: packWaitTerminal, silentFailureDetector: detector, bookingMonitorHealth, communicationStuck }, { status: summary.ok ? 200 : 500 });
}
