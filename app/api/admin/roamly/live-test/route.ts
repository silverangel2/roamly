import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  buildLiveCompanionDebugReport,
  sendTestInAppNotification,
  sendTestPushNotification,
  simulateCheckIn,
  simulateCompanionReminder,
  simulateComplete,
  simulateSkip,
  simulateTripLocation,
  type LiveTestLocationMode,
  type LiveTestReminderType
} from "@/lib/roamly/liveCompanionTest";

const locationActions: Record<string, LiveTestLocationMode> = {
  simulate_near_first_activity: "first_activity",
  simulate_near_next_activity: "next_activity",
  simulate_near_hotel: "hotel",
  simulate_far_away: "far_away"
};

const reminderActions: Record<string, LiveTestReminderType> = {
  simulate_one_week_before: "one_week_before",
  simulate_one_day_before: "one_day_before",
  simulate_countdown_24h: "countdown_24h",
  simulate_travel_day_started: "travel_day_started"
};

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const action = typeof body.action === "string" ? body.action : "";

  if (!tripId || !action) {
    return NextResponse.json({ ok: false, error: "Trip and action are required." }, { status: 400 });
  }

  try {
    if (action in locationActions) {
      const result = await simulateTripLocation(tripId, locationActions[action]);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action in reminderActions) {
      const result = await simulateCompanionReminder(tripId, reminderActions[action]);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "send_test_in_app_notification") {
      const result = await sendTestInAppNotification(tripId);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "send_test_push_notification") {
      const result = await sendTestPushNotification(tripId);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "simulate_check_in") {
      const result = await simulateCheckIn(tripId);
      const { ok: actionOk, ...rest } = result;
      return NextResponse.json({ ok: true, action, activityCheckedIn: actionOk, ...rest });
    }
    if (action === "simulate_skip") {
      const result = await simulateSkip(tripId);
      const { ok: actionOk, ...rest } = result;
      return NextResponse.json({ ok: true, action, activitySkipped: actionOk, ...rest });
    }
    if (action === "simulate_complete") {
      const result = await simulateComplete(tripId);
      const { ok: actionOk, ...rest } = result;
      return NextResponse.json({ ok: true, action, activityCompleted: actionOk, ...rest });
    }
    if (action === "debug_report") {
      const debug = await buildLiveCompanionDebugReport(tripId);
      return NextResponse.json({ ok: true, action, debug });
    }
    return NextResponse.json({ ok: false, error: "Unsupported live test action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        action,
        error: error instanceof Error ? error.message : "Live test failed.",
        debug: await buildLiveCompanionDebugReport(tripId).catch(() => null)
      },
      { status: 500 }
    );
  }
}
