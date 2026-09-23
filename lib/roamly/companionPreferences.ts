import type { SupabaseClient } from "@supabase/supabase-js";

export type CompanionControlMode =
  | "suggest_changes"
  | "fix_simple_changes"
  | "fix_within_rules";

export type CompanionPreferences = {
  controlMode: CompanionControlMode;
  allowFreeScheduleChanges: boolean;
  allowOptionalActivityChanges: boolean;
  allowMealChanges: boolean;
  allowRouteTimeUpdates: boolean;
  maxAutomaticCostChange: number;
  currency: string | null;
  dailyBriefingEnabled: boolean;
  importantTravelAlertsEnabled: boolean;
  bookingNotificationsEnabled: boolean;
  checkInRemindersEnabled: boolean;
  marketingEnabled: boolean;
  liveCompanionEnabled: boolean;
  liveCompanionPausedUntil: string | null;
  backgroundLocationEnabled: boolean;
};

export type CommunicationPreferenceKey =
  | "dailyBriefingEnabled"
  | "importantTravelAlertsEnabled"
  | "bookingNotificationsEnabled"
  | "checkInRemindersEnabled";

const DEFAULT_PREFERENCES: CompanionPreferences = {
  controlMode: "suggest_changes",
  allowFreeScheduleChanges: false,
  allowOptionalActivityChanges: false,
  allowMealChanges: false,
  allowRouteTimeUpdates: false,
  maxAutomaticCostChange: 0,
  currency: null,
  dailyBriefingEnabled: true,
  importantTravelAlertsEnabled: true,
  bookingNotificationsEnabled: true,
  checkInRemindersEnabled: true,
  marketingEnabled: false,
  liveCompanionEnabled: true,
  liveCompanionPausedUntil: null,
  backgroundLocationEnabled: false
};

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

export function mapCompanionPreferences(
  row: Record<string, unknown> | null
): CompanionPreferences {
  if (!row) return DEFAULT_PREFERENCES;

  const mode = row.control_mode;

  return {
    controlMode:
      mode === "fix_simple_changes" || mode === "fix_within_rules"
        ? mode
        : "suggest_changes",
    allowFreeScheduleChanges:
      row.allow_free_schedule_changes === true,
    allowOptionalActivityChanges:
      row.allow_optional_activity_changes === true,
    allowMealChanges: row.allow_meal_changes === true,
    allowRouteTimeUpdates: row.allow_route_time_updates === true,
    maxAutomaticCostChange: numberValue(
      row.max_automatic_cost_change
    ),
    currency:
      typeof row.currency === "string" ? row.currency : null,
    dailyBriefingEnabled:
      row.daily_briefing_enabled !== false,
    importantTravelAlertsEnabled:
      row.important_travel_alerts_enabled !== false,
    bookingNotificationsEnabled:
      row.booking_notifications_enabled !== false,
    checkInRemindersEnabled:
      row.check_in_reminders_enabled !== false,
    marketingEnabled: row.marketing_enabled === true,
    liveCompanionEnabled:
      row.live_companion_enabled !== false,
    liveCompanionPausedUntil:
      typeof row.live_companion_paused_until === "string"
        ? row.live_companion_paused_until
        : null,
    backgroundLocationEnabled:
      row.background_location_enabled === true
  };
}

export async function getCompanionPreferences(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}): Promise<CompanionPreferences> {
  const tripResult = await params.supabase
    .from("roamly_companion_preferences")
    .select("*")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .maybeSingle();

  if (!tripResult.error && tripResult.data) {
    return mapCompanionPreferences(tripResult.data);
  }

  const accountResult = await params.supabase
    .from("roamly_companion_preferences")
    .select("*")
    .eq("user_id", params.userId)
    .is("trip_id", null)
    .maybeSingle();

  if (!accountResult.error && accountResult.data) {
    return mapCompanionPreferences(accountResult.data);
  }

  return DEFAULT_PREFERENCES;
}

/** Returns null on database errors; delivery code must not treat a failed read as consent. */
export async function getCompanionPreferencesForDelivery(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}): Promise<CompanionPreferences | null> {
  const tripResult = await params.supabase
    .from("roamly_companion_preferences")
    .select("*")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .maybeSingle();
  if (tripResult.error) return null;
  if (tripResult.data) return mapCompanionPreferences(tripResult.data);

  const accountResult = await params.supabase
    .from("roamly_companion_preferences")
    .select("*")
    .eq("user_id", params.userId)
    .is("trip_id", null)
    .maybeSingle();
  if (accountResult.error) return null;
  return mapCompanionPreferences(accountResult.data);
}

export function communicationPreferenceForPurpose(
  purpose: string
): CommunicationPreferenceKey | null {
  if (["pretrip_7d", "pretrip_1d", "travel_day", "daily_trip_briefing"].includes(purpose)) {
    return "dailyBriefingEnabled";
  }
  if (purpose === "booking_material_change") return "bookingNotificationsEnabled";
  return null;
}

export async function getCommunicationPreferenceState(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string | null | undefined;
  purpose: string;
}): Promise<"enabled" | "disabled" | "unavailable"> {
  const preferenceKey = communicationPreferenceForPurpose(params.purpose);
  if (!preferenceKey) return "enabled";
  if (!params.tripId) return "unavailable";
  const preferences = await getCompanionPreferencesForDelivery({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId
  });
  if (!preferences) return "unavailable";
  return preferences[preferenceKey] ? "enabled" : "disabled";
}

export function communicationPreferenceForNotificationType(
  type: string
): CommunicationPreferenceKey | null {
  if (["flight_delay", "flight_cancelled"].includes(type)) return "importantTravelAlertsEnabled";
  if (["booking_detected", "booking_confirmed", "booking_changed"].includes(type)) {
    return "bookingNotificationsEnabled";
  }
  if (["nearby_activity", "activity_start", "next_activity", "leave_by", "late", "arrival", "check_in_reminder"].includes(type)) {
    return "checkInRemindersEnabled";
  }
  if (["trip_predeparture_7d", "trip_predeparture_1d", "daily_briefing", "final_day_briefing"].includes(type)) {
    return "dailyBriefingEnabled";
  }
  return null;
}

function isPaidOrExternalAction(actionType: string): boolean {
  return /purchase|book|cancel|refund|payment|paid|reservation_change/i.test(
    actionType
  );
}

function isRouteOrTimingAction(actionType: string): boolean {
  return /route|travel_time|timing|departure_reminder|arrival_time/i.test(
    actionType
  );
}

function isOptionalActivityAction(actionType: string): boolean {
  return /optional_activity|move_activity|replace_activity|flexible_activity/i.test(
    actionType
  );
}

function isMealAction(actionType: string): boolean {
  return /meal|dinner|lunch|breakfast|restaurant/i.test(actionType);
}

export function canAutomaticallyApplyCompanionAction(params: {
  preferences: CompanionPreferences;
  actionType: string;
  requiresApproval: boolean;
  costChange?: number | null;
}): boolean {
  if (params.requiresApproval) return false;
  if (isPaidOrExternalAction(params.actionType)) return false;

  const costChange =
    typeof params.costChange === "number"
      ? params.costChange
      : 0;

  if (params.preferences.controlMode === "suggest_changes") {
    return false;
  }

  if (params.preferences.controlMode === "fix_simple_changes") {
    if (costChange !== 0) return false;

    return (
      isRouteOrTimingAction(params.actionType) ||
      isOptionalActivityAction(params.actionType) ||
      isMealAction(params.actionType)
    );
  }

  if (
    costChange >
    params.preferences.maxAutomaticCostChange
  ) {
    return false;
  }

  if (
    isRouteOrTimingAction(params.actionType) &&
    !params.preferences.allowRouteTimeUpdates
  ) {
    return false;
  }

  if (
    isOptionalActivityAction(params.actionType) &&
    !params.preferences.allowOptionalActivityChanges
  ) {
    return false;
  }

  if (
    isMealAction(params.actionType) &&
    !params.preferences.allowMealChanges
  ) {
    return false;
  }

  return params.preferences.allowFreeScheduleChanges;
}
