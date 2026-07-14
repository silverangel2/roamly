import type { SupabaseClient } from "@supabase/supabase-js";

export const TRAVELER_PREFERENCE_KEYS = [
  "preferred_travel_pace",
  "maximum_comfortable_driving_hours",
  "preferred_departure_windows",
  "airport_preferences",
  "transportation_preferences",
  "maximum_acceptable_transfers",
  "accommodation_types",
  "hotel_priorities",
  "preferred_neighbourhood_style",
  "nightlife_interests",
  "food_interests",
  "culture_interests",
  "nature_interests",
  "shopping_interests",
  "walking_tolerance",
  "room_preferences",
  "hotel_change_tolerance",
  "typical_budget_level",
  "likes",
  "dislikes"
] as const;

export type TravelerPreferenceKey = (typeof TRAVELER_PREFERENCE_KEYS)[number];

export type TravelerProfile = {
  id: string;
  user_id: string;
  preferred_travel_pace: string | null;
  maximum_comfortable_driving_hours: number | null;
  preferred_departure_windows: string[];
  airport_preferences: string[];
  transportation_preferences: string[];
  maximum_acceptable_transfers: number | null;
  accommodation_types: string[];
  hotel_priorities: string[];
  preferred_neighbourhood_style: string | null;
  nightlife_interests: string | null;
  food_interests: string[];
  culture_interests: string[];
  nature_interests: string[];
  shopping_interests: string | null;
  walking_tolerance: string | null;
  room_preferences: string[];
  hotel_change_tolerance: string | null;
  typical_budget_level: string | null;
  likes: string[];
  dislikes: string[];
  confirmed_preferences: Record<string, unknown>;
  inferred_preferences: Record<string, unknown>;
  preference_confidence: Record<string, unknown>;
  personalization_enabled: boolean;
  last_updated_at: string;
  created_at: string;
  updated_at: string;
};

export type TravelerPreferenceEvent = {
  id: string;
  user_id: string;
  profile_id: string | null;
  source_trip_id: string | null;
  source_feedback_id: string | null;
  preference_key: string;
  previous_value: unknown;
  proposed_value: unknown;
  reason: string | null;
  source: string;
  confidence: number | null;
  status: "proposed" | "accepted" | "rejected" | "reverted" | "deleted";
  accepted_at: string | null;
  rejected_at: string | null;
  reverted_at: string | null;
  created_at: string;
};

const arrayKeys = new Set<TravelerPreferenceKey>([
  "preferred_departure_windows",
  "airport_preferences",
  "transportation_preferences",
  "accommodation_types",
  "hotel_priorities",
  "food_interests",
  "culture_interests",
  "nature_interests",
  "room_preferences",
  "likes",
  "dislikes"
]);

const numericKeys = new Set<TravelerPreferenceKey>(["maximum_comfortable_driving_hours", "maximum_acceptable_transfers"]);

function cleanString(value: unknown, limit = 120) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function cleanStringArray(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 30);
}

function cleanNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeProfile(row: Record<string, unknown>): TravelerProfile {
  return {
    id: String(row.id || ""),
    user_id: String(row.user_id || ""),
    preferred_travel_pace: cleanString(row.preferred_travel_pace) || null,
    maximum_comfortable_driving_hours: cleanNumber(row.maximum_comfortable_driving_hours),
    preferred_departure_windows: cleanStringArray(row.preferred_departure_windows),
    airport_preferences: cleanStringArray(row.airport_preferences),
    transportation_preferences: cleanStringArray(row.transportation_preferences),
    maximum_acceptable_transfers: cleanNumber(row.maximum_acceptable_transfers),
    accommodation_types: cleanStringArray(row.accommodation_types),
    hotel_priorities: cleanStringArray(row.hotel_priorities),
    preferred_neighbourhood_style: cleanString(row.preferred_neighbourhood_style) || null,
    nightlife_interests: cleanString(row.nightlife_interests) || null,
    food_interests: cleanStringArray(row.food_interests),
    culture_interests: cleanStringArray(row.culture_interests),
    nature_interests: cleanStringArray(row.nature_interests),
    shopping_interests: cleanString(row.shopping_interests) || null,
    walking_tolerance: cleanString(row.walking_tolerance) || null,
    room_preferences: cleanStringArray(row.room_preferences),
    hotel_change_tolerance: cleanString(row.hotel_change_tolerance) || null,
    typical_budget_level: cleanString(row.typical_budget_level) || null,
    likes: cleanStringArray(row.likes),
    dislikes: cleanStringArray(row.dislikes),
    confirmed_preferences: record(row.confirmed_preferences),
    inferred_preferences: record(row.inferred_preferences),
    preference_confidence: record(row.preference_confidence),
    personalization_enabled: row.personalization_enabled !== false,
    last_updated_at: String(row.last_updated_at || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

function normalizeEvent(row: Record<string, unknown>): TravelerPreferenceEvent {
  return {
    id: String(row.id || ""),
    user_id: String(row.user_id || ""),
    profile_id: typeof row.profile_id === "string" ? row.profile_id : null,
    source_trip_id: typeof row.source_trip_id === "string" ? row.source_trip_id : null,
    source_feedback_id: typeof row.source_feedback_id === "string" ? row.source_feedback_id : null,
    preference_key: cleanString(row.preference_key),
    previous_value: row.previous_value ?? null,
    proposed_value: row.proposed_value ?? null,
    reason: cleanString(row.reason, 500) || null,
    source: cleanString(row.source) || "system",
    confidence: cleanNumber(row.confidence),
    status:
      row.status === "accepted" || row.status === "rejected" || row.status === "reverted" || row.status === "deleted"
        ? row.status
        : "proposed",
    accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : null,
    rejected_at: typeof row.rejected_at === "string" ? row.rejected_at : null,
    reverted_at: typeof row.reverted_at === "string" ? row.reverted_at : null,
    created_at: String(row.created_at || "")
  };
}

export function cleanTravelerPreferenceUpdates(value: unknown) {
  const input = record(value);
  const updates: Record<string, unknown> = {};
  const confirmed: Record<string, unknown> = {};

  for (const key of TRAVELER_PREFERENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    if (arrayKeys.has(key)) {
      const cleaned = cleanStringArray(input[key]);
      updates[key] = cleaned;
      confirmed[key] = cleaned;
    } else if (numericKeys.has(key)) {
      const cleaned = cleanNumber(input[key]);
      updates[key] = cleaned;
      confirmed[key] = cleaned;
    } else {
      const cleaned = cleanString(input[key], 240);
      updates[key] = cleaned || null;
      confirmed[key] = cleaned || null;
    }
  }

  if (Object.keys(confirmed).length) updates.confirmed_preferences = confirmed;
  return updates;
}

export async function getTravelerMemory(supabase: SupabaseClient, userId: string) {
  const [{ data: profileData, error: profileError }, { data: eventData, error: eventError }] = await Promise.all([
    supabase.from("traveler_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("traveler_preference_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50)
  ]);

  if (profileError) return { profile: null, events: [] as TravelerPreferenceEvent[], error: profileError.message };
  if (eventError) return { profile: profileData ? normalizeProfile(profileData as Record<string, unknown>) : null, events: [], error: eventError.message };
  return {
    profile: profileData ? normalizeProfile(profileData as Record<string, unknown>) : null,
    events: (eventData || []).map((event) => normalizeEvent(event as Record<string, unknown>)),
    error: null
  };
}

export async function upsertTravelerProfile(params: {
  supabase: SupabaseClient;
  userId: string;
  updates: Record<string, unknown>;
}) {
  const payload = {
    user_id: params.userId,
    ...cleanTravelerPreferenceUpdates(params.updates),
    ...(Object.prototype.hasOwnProperty.call(params.updates, "personalization_enabled")
      ? { personalization_enabled: params.updates.personalization_enabled !== false }
      : {}),
    last_updated_at: new Date().toISOString()
  };

  const { data, error } = await params.supabase
    .from("traveler_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) return { profile: null, error: error.message };
  return { profile: normalizeProfile(data as Record<string, unknown>), error: null };
}

export async function deleteTravelerPreference(params: {
  supabase: SupabaseClient;
  userId: string;
  key: string;
}) {
  if (!TRAVELER_PREFERENCE_KEYS.includes(params.key as TravelerPreferenceKey)) {
    return { ok: false as const, error: "UNKNOWN_PREFERENCE_KEY" };
  }
  const key = params.key as TravelerPreferenceKey;
  const updates: Record<string, unknown> = {
    [key]: arrayKeys.has(key) ? [] : null,
    last_updated_at: new Date().toISOString()
  };
  const { error } = await params.supabase.from("traveler_profiles").update(updates).eq("user_id", params.userId);
  if (error) return { ok: false as const, error: error.message };
  await params.supabase.from("traveler_preference_events").insert({
    user_id: params.userId,
    preference_key: key,
    proposed_value: null,
    source: "user",
    status: "deleted",
    reason: "User deleted this saved travel preference."
  });
  return { ok: true as const };
}

export async function deleteTravelerMemory(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.from("traveler_profiles").delete().eq("user_id", userId);
  if (error) return { ok: false as const, error: error.message };
  await supabase.from("traveler_preference_events").delete().eq("user_id", userId);
  return { ok: true as const };
}

export async function updatePreferenceEventStatus(params: {
  supabase: SupabaseClient;
  userId: string;
  eventId: string;
  status: "accepted" | "rejected" | "reverted";
  editedValue?: unknown;
}) {
  const { data: event, error: eventError } = await params.supabase
    .from("traveler_preference_events")
    .select("*")
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (eventError) return { ok: false as const, error: eventError.message };
  if (!event) return { ok: false as const, error: "Preference event not found." };

  const row = normalizeEvent(event as Record<string, unknown>);
  const now = new Date().toISOString();
  const statusUpdate = {
    status: params.status,
    accepted_at: params.status === "accepted" ? now : row.accepted_at,
    rejected_at: params.status === "rejected" ? now : row.rejected_at,
    reverted_at: params.status === "reverted" ? now : row.reverted_at,
    ...(params.editedValue !== undefined ? { proposed_value: params.editedValue } : {})
  };

  const { error } = await params.supabase
    .from("traveler_preference_events")
    .update(statusUpdate)
    .eq("id", params.eventId)
    .eq("user_id", params.userId);
  if (error) return { ok: false as const, error: error.message };

  if (params.status === "accepted") {
    const proposed = params.editedValue !== undefined ? params.editedValue : row.proposed_value;
    await upsertTravelerProfile({
      supabase: params.supabase,
      userId: params.userId,
      updates: { [row.preference_key]: proposed }
    });
  }

  return { ok: true as const };
}

export function preferenceInfluenceSummary(profile: TravelerProfile | null) {
  if (!profile || profile.personalization_enabled === false) return [];
  const influences: Array<{ key: TravelerPreferenceKey; value: unknown; confidence: unknown }> = [];
  for (const key of TRAVELER_PREFERENCE_KEYS) {
    const value = profile[key];
    if (Array.isArray(value) ? value.length === 0 : value === null || value === "") continue;
    influences.push({ key, value, confidence: profile.preference_confidence[key] ?? null });
  }
  return influences;
}
