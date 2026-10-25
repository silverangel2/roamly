import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getGenerationWorkerSecrets, scheduleStagedGenerationAdvance } from "@/lib/roamly/stagedGenerationBackground";
import { processGenerationQueue, type RoamlyGenerationWorkerSummary } from "@/lib/roamly/generationWorker";
import { runStuckGenerationDetector } from "@/lib/roamly/silentFailureDetectors";
import { runPackWaitTerminalTransition } from "@/lib/roamly/packWaitTerminalTransition";
import { runBookingMonitorHealthDetector } from "@/lib/roamly/bookingMonitorHealth";
import { runCommunicationStuckDetector } from "@/lib/roamly/communicationStuckDetector";
import { detectorFailureResult, recordBackgroundDetectorFailure } from "@/lib/roamly/observabilityDetectorDiagnostics";

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

  return NextResponse.json({ ...summary, packWaitTerminalTransition: packWaitTerminal, silentFailureDetector: detector }, { status: summary.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  const executionDeadlineMs = Date.now() + ROUTE_EXECUTION_BUDGET_MS;
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const requestId = randomUUID();
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

  return NextResponse.json({ ...summary, packWaitTerminalTransition: packWaitTerminal, silentFailureDetector: detector, bookingMonitorHealth, communicationStuck }, { status: summary.ok ? 200 : 500 });
}
