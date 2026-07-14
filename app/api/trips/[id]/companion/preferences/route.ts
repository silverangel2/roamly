import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import {
  getCompanionPreferences,
  type CompanionControlMode
} from "@/lib/roamly/companionPreferences";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateBody = {
  controlMode?: CompanionControlMode;
  allowFreeScheduleChanges?: boolean;
  allowOptionalActivityChanges?: boolean;
  allowMealChanges?: boolean;
  allowRouteTimeUpdates?: boolean;
  maxAutomaticCostChange?: number;
  currency?: string | null;
  dailyBriefingEnabled?: boolean;
  importantTravelAlertsEnabled?: boolean;
  bookingNotificationsEnabled?: boolean;
  checkInRemindersEnabled?: boolean;
  marketingEnabled?: boolean;
};

const VALID_MODES: CompanionControlMode[] = [
  "suggest_changes",
  "fix_simple_changes",
  "fix_within_rules"
];

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const preferences = await getCompanionPreferences({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id
  });

  return NextResponse.json({
    ok: true,
    preferences
  });
}

export async function PUT(
  request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let body: UpdateBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON" },
      { status: 400 }
    );
  }

  if (
    body.controlMode !== undefined &&
    !VALID_MODES.includes(body.controlMode)
  ) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CONTROL_MODE" },
      { status: 400 }
    );
  }

  const maxAutomaticCostChange =
    typeof body.maxAutomaticCostChange === "number" &&
    Number.isFinite(body.maxAutomaticCostChange) &&
    body.maxAutomaticCostChange >= 0
      ? body.maxAutomaticCostChange
      : 0;

  const row = {
    user_id: auth.user.id,
    trip_id: id,
    control_mode: body.controlMode ?? "suggest_changes",
    allow_free_schedule_changes:
      body.allowFreeScheduleChanges === true,
    allow_optional_activity_changes:
      body.allowOptionalActivityChanges === true,
    allow_meal_changes:
      body.allowMealChanges === true,
    allow_route_time_updates:
      body.allowRouteTimeUpdates === true,
    max_automatic_cost_change: maxAutomaticCostChange,
    currency:
      typeof body.currency === "string" && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : null,
    daily_briefing_enabled:
      body.dailyBriefingEnabled !== false,
    important_travel_alerts_enabled:
      body.importantTravelAlertsEnabled !== false,
    booking_notifications_enabled:
      body.bookingNotificationsEnabled !== false,
    check_in_reminders_enabled:
      body.checkInRemindersEnabled !== false,
    marketing_enabled:
      body.marketingEnabled === true
  };

  const result = await auth.supabase
    .from("roamly_companion_preferences")
    .upsert(row, {
      onConflict: "user_id,trip_id"
    })
    .select("*")
    .single();

  if (result.error) {
    return NextResponse.json(
      { ok: false, error: result.error.message },
      { status: 400 }
    );
  }

  const preferences = await getCompanionPreferences({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id
  });

  return NextResponse.json({
    ok: true,
    preferences
  });
}
