import { NextRequest, NextResponse } from "next/server";
import { processQueuedCompanionNotifications } from "@/lib/roamly/companionNotifications";
import { sendScheduledTripNotifications } from "@/lib/roamly/pushServer";
import { scheduleCompanionBriefings } from "@/lib/roamly/companionBriefings";

export async function GET(request: NextRequest) {
  const secret = (
    process.env.ROAMLY_NOTIFICATION_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();

  const headerSecret =
    request.headers.get("x-cron-secret")?.trim() ||
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ||
    "";

  const providedSecret =
    request.nextUrl.searchParams.get("secret")?.trim() ||
    headerSecret;

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Notification cron secret is not configured."
      },
      { status: 503 }
    );
  }

  if (providedSecret !== secret) {
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
      scheduleCompanionBriefings()
    ).catch((error) => ({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Companion briefing scheduling failed."
    }));

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
    scheduled.ok === true &&
    companion.ok === true;

  return NextResponse.json(
    {
      ok,
      briefings: briefingResult,
      scheduled,
      companion,
      processedAt: new Date().toISOString()
    },
    {
      status: ok ? 200 : 207
    }
  );
}
