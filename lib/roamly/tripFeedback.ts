import type { SupabaseClient } from "@supabase/supabase-js";
import { TRAVELER_PREFERENCE_KEYS, type TravelerPreferenceKey } from "@/lib/roamly/travelerMemory";

export type TripFeedbackType = "post_trip" | "in_trip";

export type TripFeedbackInput = {
  feedbackType?: TripFeedbackType;
  tripDay?: number | null;
  overallSatisfaction?: number | null;
  itineraryPace?: "too_busy" | "too_slow" | "right" | string | null;
  transportationSatisfaction?: number | null;
  hotelLocationSatisfaction?: number | null;
  hotelQualitySatisfaction?: number | null;
  budgetAccuracy?: number | null;
  scheduleRealism?: number | null;
  favouriteActivities?: string[];
  disappointingActivities?: string[];
  skippedActivities?: string[];
  reasonsForSkipping?: Record<string, string>;
  wouldUseRoamlyAgain?: boolean | null;
  freeTextFeedback?: string | null;
  todayPace?: "too_busy" | "too_slow" | "right" | string | null;
  transportationDifficult?: boolean | null;
  adjustTomorrow?: boolean | null;
  recommendationUsefulness?: number | null;
};

export type TripFeedbackRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  feedback_type: TripFeedbackType;
  trip_day: number | null;
  overall_satisfaction: number | null;
  itinerary_pace: string | null;
  transportation_satisfaction: number | null;
  hotel_location_satisfaction: number | null;
  hotel_quality_satisfaction: number | null;
  budget_accuracy: number | null;
  schedule_realism: number | null;
  favourite_activities: string[];
  disappointing_activities: string[];
  skipped_activities: string[];
  reasons_for_skipping: Record<string, string>;
  would_use_roamly_again: boolean | null;
  free_text_feedback: string | null;
  today_pace: string | null;
  transportation_difficult: boolean | null;
  adjust_tomorrow: boolean | null;
  recommendation_usefulness: number | null;
  learned_preferences_json: TripFeedbackPreferenceProposal[];
  created_at: string;
  updated_at: string;
};

export type TripFeedbackPreferenceProposal = {
  preference_key: TravelerPreferenceKey;
  proposed_value: unknown;
  reason: string;
  confidence: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function cleanStringArray(value: unknown, limit = 30) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, limit);
}

function cleanScore(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
  if (number == null || !Number.isFinite(number)) return null;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function cleanDay(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
  if (number == null || !Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}

function cleanBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function preference(key: TravelerPreferenceKey, proposedValue: unknown, reason: string, confidence: number): TripFeedbackPreferenceProposal {
  return {
    preference_key: key,
    proposed_value: proposedValue,
    reason,
    confidence: Math.min(1, Math.max(0, confidence))
  };
}

function knownPreferenceKey(key: string): key is TravelerPreferenceKey {
  return TRAVELER_PREFERENCE_KEYS.includes(key as TravelerPreferenceKey);
}

export function proposePreferenceUpdatesFromFeedback(input: TripFeedbackInput): TripFeedbackPreferenceProposal[] {
  const proposals: TripFeedbackPreferenceProposal[] = [];
  const pace = cleanString(input.todayPace || input.itineraryPace, 40);
  if (pace === "too_busy") {
    proposals.push(preference("preferred_travel_pace", "slower", "Traveler said the itinerary pace was too busy.", 0.72));
  } else if (pace === "too_slow") {
    proposals.push(preference("preferred_travel_pace", "faster", "Traveler said the itinerary pace was too slow.", 0.66));
  } else if (pace === "right") {
    proposals.push(preference("preferred_travel_pace", "balanced", "Traveler said the itinerary pace felt right.", 0.54));
  }

  if (input.transportationDifficult === true || (input.transportationSatisfaction != null && input.transportationSatisfaction <= 2)) {
    proposals.push(preference("transportation_preferences", ["simpler routes", "fewer transfers"], "Traveler reported transportation difficulty.", 0.7));
    proposals.push(preference("maximum_acceptable_transfers", 1, "Traveler reported transportation difficulty.", 0.58));
  }

  if (input.hotelLocationSatisfaction != null && input.hotelLocationSatisfaction <= 2) {
    proposals.push(preference("hotel_priorities", ["better location", "shorter daily travel times"], "Traveler was not satisfied with hotel location.", 0.68));
  }

  if (input.hotelQualitySatisfaction != null && input.hotelQualitySatisfaction <= 2) {
    proposals.push(preference("hotel_priorities", ["cleanliness", "review quality", "room comfort"], "Traveler was not satisfied with hotel quality.", 0.68));
  }

  if (input.budgetAccuracy != null && input.budgetAccuracy <= 2) {
    proposals.push(preference("typical_budget_level", "needs conservative cost estimates", "Traveler said budget accuracy was low.", 0.62));
  }

  const favourites = cleanStringArray(input.favouriteActivities);
  if (favourites.length) {
    proposals.push(preference("likes", favourites, "Traveler marked these activities as favorites.", 0.76));
  }

  const disappointments = cleanStringArray(input.disappointingActivities);
  if (disappointments.length) {
    proposals.push(preference("dislikes", disappointments, "Traveler marked these activities as disappointing.", 0.74));
  }

  const skipped = cleanStringArray(input.skippedActivities);
  if (skipped.length) {
    proposals.push(preference("dislikes", skipped, "Traveler skipped these planned activities.", 0.5));
  }

  return proposals.filter((proposal) => knownPreferenceKey(proposal.preference_key));
}

function normalizeFeedbackRow(row: Record<string, unknown>): TripFeedbackRecord {
  return {
    id: String(row.id || ""),
    trip_id: String(row.trip_id || ""),
    user_id: String(row.user_id || ""),
    feedback_type: row.feedback_type === "in_trip" ? "in_trip" : "post_trip",
    trip_day: cleanDay(row.trip_day),
    overall_satisfaction: cleanScore(row.overall_satisfaction),
    itinerary_pace: cleanString(row.itinerary_pace, 40) || null,
    transportation_satisfaction: cleanScore(row.transportation_satisfaction),
    hotel_location_satisfaction: cleanScore(row.hotel_location_satisfaction),
    hotel_quality_satisfaction: cleanScore(row.hotel_quality_satisfaction),
    budget_accuracy: cleanScore(row.budget_accuracy),
    schedule_realism: cleanScore(row.schedule_realism),
    favourite_activities: cleanStringArray(row.favourite_activities),
    disappointing_activities: cleanStringArray(row.disappointing_activities),
    skipped_activities: cleanStringArray(row.skipped_activities),
    reasons_for_skipping: Object.fromEntries(
      Object.entries(record(row.reasons_for_skipping)).map(([key, value]) => [key, cleanString(value, 240)]).filter(([, value]) => value)
    ),
    would_use_roamly_again: cleanBoolean(row.would_use_roamly_again),
    free_text_feedback: cleanString(row.free_text_feedback, 2000) || null,
    today_pace: cleanString(row.today_pace, 40) || null,
    transportation_difficult: cleanBoolean(row.transportation_difficult),
    adjust_tomorrow: cleanBoolean(row.adjust_tomorrow),
    recommendation_usefulness: cleanScore(row.recommendation_usefulness),
    learned_preferences_json: Array.isArray(row.learned_preferences_json)
      ? (row.learned_preferences_json as TripFeedbackPreferenceProposal[])
      : [],
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

function feedbackPayload(userId: string, tripId: string, input: TripFeedbackInput, proposals: TripFeedbackPreferenceProposal[]) {
  return {
    trip_id: tripId,
    user_id: userId,
    feedback_type: input.feedbackType === "in_trip" ? "in_trip" : "post_trip",
    trip_day: cleanDay(input.tripDay),
    overall_satisfaction: cleanScore(input.overallSatisfaction),
    itinerary_pace: cleanString(input.itineraryPace, 40) || null,
    transportation_satisfaction: cleanScore(input.transportationSatisfaction),
    hotel_location_satisfaction: cleanScore(input.hotelLocationSatisfaction),
    hotel_quality_satisfaction: cleanScore(input.hotelQualitySatisfaction),
    budget_accuracy: cleanScore(input.budgetAccuracy),
    schedule_realism: cleanScore(input.scheduleRealism),
    favourite_activities: cleanStringArray(input.favouriteActivities),
    disappointing_activities: cleanStringArray(input.disappointingActivities),
    skipped_activities: cleanStringArray(input.skippedActivities),
    reasons_for_skipping: record(input.reasonsForSkipping),
    would_use_roamly_again: cleanBoolean(input.wouldUseRoamlyAgain),
    free_text_feedback: cleanString(input.freeTextFeedback, 2000) || null,
    today_pace: cleanString(input.todayPace, 40) || null,
    transportation_difficult: cleanBoolean(input.transportationDifficult),
    adjust_tomorrow: cleanBoolean(input.adjustTomorrow),
    recommendation_usefulness: cleanScore(input.recommendationUsefulness),
    learned_preferences_json: proposals
  };
}

export async function getTripFeedback(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}) {
  const { data, error } = await params.supabase
    .from("trip_feedback")
    .select("*")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .order("created_at", { ascending: false });
  if (error) return { feedback: [] as TripFeedbackRecord[], error: error.message };
  return {
    feedback: (data || []).map((row) => normalizeFeedbackRow(row as Record<string, unknown>)),
    error: null
  };
}

export async function submitTripFeedback(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  input: TripFeedbackInput;
}) {
  const trip = await params.supabase
    .from("roamly_trips")
    .select("id")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (trip.error) return { ok: false as const, error: trip.error.message };
  if (!trip.data) return { ok: false as const, error: "TRIP_NOT_FOUND" };

  const proposals = proposePreferenceUpdatesFromFeedback(params.input);
  const { data, error } = await params.supabase
    .from("trip_feedback")
    .insert(feedbackPayload(params.userId, params.tripId, params.input, proposals))
    .select("*")
    .single();
  if (error) return { ok: false as const, error: error.message };
  const feedback = normalizeFeedbackRow(data as Record<string, unknown>);

  if (proposals.length) {
    await params.supabase.from("traveler_preference_events").insert(
      proposals.map((proposal) => ({
        user_id: params.userId,
        source_trip_id: params.tripId,
        source_feedback_id: feedback.id,
        preference_key: proposal.preference_key,
        proposed_value: proposal.proposed_value,
        reason: proposal.reason,
        source: "trip_feedback",
        confidence: proposal.confidence,
        status: "proposed"
      }))
    );
  }

  return {
    ok: true as const,
    feedback,
    proposedPreferences: proposals,
    message: proposals.length ? "Here is what Roamly learned from your trip." : "Feedback saved."
  };
}
