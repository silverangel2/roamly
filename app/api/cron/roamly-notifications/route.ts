import { NextRequest, NextResponse } from "next/server";
import { processQueuedCompanionNotifications } from "@/lib/roamly/companionNotifications";
import { schedulePreTripReminders } from "@/lib/roamly/preTripReminders";
import { sendScheduledTripNotifications } from "@/lib/roamly/pushServer";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { runPaidActivationMissingDetector } from "@/lib/roamly/silentFailureDetectors";
import { recordNotificationSchedulerSuccess } from "@/lib/roamly/communicationHealth";
import { detectorFailureResult, recordBackgroundDetectorFailure } from "@/lib/roamly/observabilityDetectorDiagnostics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordCronHeartbeat } from "@/lib/roamly/cronHeartbeat";
import { anyWorkPresent, countWorkRows } from "@/lib/roamly/workGate";

export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Notification cron secret is not configured."
      },
      { status: 503 }
    );
  }

  if (!isCronRequestAuthorized(request.headers, secret)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized cron."
      },
      { status: 401 }
    );
  }

  // Queue-only mode (triggered by the frequent vercel cron) processes
  // time-sensitive deliveries without re-running the daily work
  // (pre-trip reminders, paid-activation detector).
  const queueOnly = new URL(request.url).searchParams.get("mode") === "queue";

  // EGRESS DIET (F2): work gate for queue mode. Deliveries are
  // created by writes (companion lifecycle queues them, the event
  // scheduler inserts them); this */15 run is the sweeper. Its work
  // rows are exactly the ones its two processors scan:
  //   - companion events due (status scheduled, scheduled_for <= now)
  //   - companion events holding an interrupted email claim
  //     (metadata emailDeliveryState claimed/in_flight/ambiguous —
  //     the reconciliation pass inside sendScheduledTripNotifications)
  //   - notification deliveries due (queued/retrying and due) or
  //     holding a stale "sending" claim (>15 min, the recovery pass)
  // Zero across all three → record the heartbeat (silence is the
  // stale signal; a gated run is still a run) and exit. The daily
  // full mode is NOT gated: it also creates pre-trip reminders,
  // whose work is the calendar itself. Fail-open on any count error.
  if (queueOnly) {
    const gateAdmin = createSupabaseAdminClient();
    if (gateAdmin) {
      const nowIso = new Date().toISOString();
      const staleSendingAt = new Date(Date.now() - 15 * 60_000).toISOString();
      const counts = await Promise.all([
        countWorkRows(gateAdmin, "roamly_trip_companion_events", (query) =>
          query.eq("status", "scheduled").lte("scheduled_for", nowIso)
        ),
        countWorkRows(gateAdmin, "roamly_trip_companion_events", (query) =>
          query.or(
            "metadata->>emailDeliveryState.eq.claimed,metadata->>emailDeliveryState.eq.in_flight,metadata->>emailDeliveryState.eq.ambiguous"
          )
        ),
        countWorkRows(gateAdmin, "roamly_companion_notification_deliveries", (query) =>
          query.or(
            `and(status.in.(queued,retrying),scheduled_for.lte.${nowIso},next_attempt_at.lte.${nowIso}),and(status.eq.sending,updated_at.lt.${staleSendingAt})`
          )
        )
      ]);
      if (!anyWorkPresent(counts)) {
        const heartbeatRecorded = await recordCronHeartbeat(gateAdmin, "roamly-notifications-queue", true);
        return NextResponse.json(
          {
            ok: true,
            gated: true,
            reason: "no_due_notification_work",
            notificationHealthRecorded: false,
            heartbeatRecorded,
            processedAt: new Date().toISOString()
          },
          { status: 200 }
        );
      }
    }
  }

  const briefingResult = queueOnly
    ? { ok: true as const, scheduled: 0, skipped: true, reason: "Queue-only mode." }
    : await Promise.resolve(
      Promise.resolve({
      ok: true,
      scheduled: 0,
      skipped: true,
      reason: "Individual Live Companion push mode is enabled."
    })
    ).catch((error) => ({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Companion briefing scheduling failed."
    }));

  const [preTrip, paidActivation] = queueOnly
    ? [
        { ok: true as const, skipped: true as const, reason: "Queue-only mode." },
        { ok: true as const, skipped: true as const, reason: "Queue-only mode." }
      ]
    : await Promise.all([
      schedulePreTripReminders().catch((error) => ({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Pre-trip reminder scheduling failed."
      })),
      runPaidActivationMissingDetector().catch(async () => {
        await recordBackgroundDetectorFailure({ detector: "paid_activation_missing", route: "/api/cron/roamly-notifications" });
        return detectorFailureResult("paid_activation_missing");
      })
    ]);

  const [scheduledResult, companionResult] =
    await Promise.allSettled([
      sendScheduledTripNotifications(),
      processQueuedCompanionNotifications({
        limit: 25
      })
    ]);

  const scheduled =
    scheduledResult.status === "fulfilled"
      ? scheduledResult.value
      : {
          ok: false,
          error:
            scheduledResult.reason instanceof Error
              ? scheduledResult.reason.message
              : "Scheduled notification processing failed."
        };

  const companion =
    companionResult.status === "fulfilled"
      ? companionResult.value
      : {
          ok: false,
          error:
            companionResult.reason instanceof Error
              ? companionResult.reason.message
              : "Companion notification processing failed."
        };

  const ok =
    briefingResult.ok === true &&
    preTrip.ok === true &&
    scheduled.ok === true &&
    companion.ok === true;

  // Health is recorded only after all required notification work succeeds.
  // A monitoring write failure must not change the established cron response.
  const notificationHealthRecorded = ok
    ? await recordNotificationSchedulerSuccess()
    : false;

  // Heartbeat (finding L11): recorded on EVERY queue-mode invocation,
  // success or failure — silence (no row) is the stale signal. The daily
  // full run shares this handler but is not the */15 queue heartbeat.
  const heartbeatAdmin = queueOnly ? createSupabaseAdminClient() : null;
  const heartbeatRecorded = heartbeatAdmin
    ? await recordCronHeartbeat(heartbeatAdmin, "roamly-notifications-queue", ok)
    : false;

  return NextResponse.json(
    {
      ok,
      notificationHealthRecorded,
      heartbeatRecorded,
      briefings: briefingResult,
      preTrip,
      paidActivation,
      scheduled,
      companion,
      processedAt: new Date().toISOString()
    },
    {
      status: ok ? 200 : 207
    }
  );
}
