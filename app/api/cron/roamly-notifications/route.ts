import { NextRequest, NextResponse } from "next/server";
import { processQueuedCompanionNotifications } from "@/lib/roamly/companionNotifications";
import { schedulePreTripReminders } from "@/lib/roamly/preTripReminders";
import { sendScheduledTripNotifications } from "@/lib/roamly/pushServer";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { runPaidActivationMissingDetector } from "@/lib/roamly/silentFailureDetectors";

export async function GET(request: NextRequest) {
  const secret = (
    process.env.ROAMLY_NOTIFICATION_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();

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

  const briefingResult =
    await Promise.resolve(
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

  const [preTrip, paidActivation] = await Promise.all([
    schedulePreTripReminders().catch((error) => ({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Pre-trip reminder scheduling failed."
    })),
    runPaidActivationMissingDetector().catch(() => ({ ok: false, detected: 0, recovered: 0, error: "DETECTOR_FAILED" }))
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

  return NextResponse.json(
    {
      ok,
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
