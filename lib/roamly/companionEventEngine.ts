import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { analyzeCompanionImpact } from "@/lib/roamly/companionImpactAnalysis";
import type { LiveProviderResult } from "@/lib/roamly/liveProviderAdapters";

export type CompanionSeverity = "minor" | "routine" | "important" | "critical";
export type CompanionEventStatus = "new" | "processing" | "proposed" | "applied" | "dismissed" | "resolved" | "suppressed";

export type CompanionEventType =
  | "flight_delayed"
  | "flight_cancelled"
  | "gate_changed"
  | "terminal_changed"
  | "hotel_modified"
  | "hotel_cancelled"
  | "reservation_time_changed"
  | "weather_disruption"
  | "transit_disruption"
  | "attraction_closure"
  | "missed_connection_risk"
  | "late_hotel_arrival"
  | "check_in_conflict"
  | "itinerary_timing_conflict";

type BookingChangeInput = {
  bookingId: string;
  tripId: string;
  userId: string;
  eventType: CompanionEventType;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  source: string;
  effectiveAt?: string | null;
  severity?: CompanionSeverity;
};

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

export function companionEventFingerprint(input: Pick<BookingChangeInput, "bookingId" | "eventType" | "newValue" | "effectiveAt">) {
  return createHash("sha256")
    .update([input.bookingId, input.eventType, input.effectiveAt || "", stableJson(input.newValue || {})].join("|"))
    .digest("hex");
}

function eventCopy(eventType: CompanionEventType, severity: CompanionSeverity, newValue: Record<string, unknown>) {
  const delayMinutes = typeof newValue.delay_minutes === "number" ? newValue.delay_minutes : null;
  const titleMap: Record<CompanionEventType, string> = {
    flight_delayed: delayMinutes ? `Flight delayed by ${Math.round(delayMinutes / 60)} hour${delayMinutes >= 120 ? "s" : ""}` : "Flight delayed",
    flight_cancelled: "Flight cancelled",
    gate_changed: "Gate changed",
    terminal_changed: "Terminal changed",
    hotel_modified: "Hotel booking changed",
    hotel_cancelled: "Hotel cancelled",
    reservation_time_changed: "Reservation time changed",
    weather_disruption: "Weather may affect your plan",
    transit_disruption: "Transit disruption",
    attraction_closure: "Attraction closed",
    missed_connection_risk: "Connection may be tight",
    late_hotel_arrival: "Late hotel arrival risk",
    check_in_conflict: "Check-in conflict",
    itinerary_timing_conflict: "Plan timing conflict"
  };
  const summaryMap: Record<CompanionEventType, string> = {
    flight_delayed: "Roamly will check what this changes in your trip.",
    flight_cancelled: "Roamly will look for affected plans and safer options.",
    gate_changed: "Roamly updated the trip status with the new gate.",
    terminal_changed: "Roamly updated the trip status with the new terminal.",
    hotel_modified: "Roamly will check arrival, location, timing, and budget.",
    hotel_cancelled: "Roamly will identify affected nights and replacement needs.",
    reservation_time_changed: "Roamly will check whether nearby plans still fit.",
    weather_disruption: "Roamly will check indoor and backup options.",
    transit_disruption: "Roamly will check route timing and alternatives.",
    attraction_closure: "Roamly will find a replacement or move the plan.",
    missed_connection_risk: "Roamly will check transfer time and downstream plans.",
    late_hotel_arrival: "Roamly will adjust arrival timing and evening plans.",
    check_in_conflict: "Roamly will check whether timing needs to change.",
    itinerary_timing_conflict: "Roamly will repair affected schedule items."
  };
  return {
    title: titleMap[eventType],
    summary: severity === "critical" ? `${summaryMap[eventType]} You may need to act.` : summaryMap[eventType]
  };
}

export function affectedLayersForCompanionEvent(eventType: CompanionEventType) {
  if (["flight_delayed", "flight_cancelled", "missed_connection_risk", "gate_changed", "terminal_changed"].includes(eventType)) {
    return ["transport_decision", "daily_itinerary_generation", "itinerary_logistics_validation", "budget_validation", "schedule_validation", "final_assembly"];
  }
  if (["hotel_modified", "hotel_cancelled", "late_hotel_arrival", "check_in_conflict"].includes(eventType)) {
    return ["accommodation_decision", "daily_itinerary_generation", "itinerary_logistics_validation", "budget_validation", "schedule_validation", "final_assembly"];
  }
  if (["weather_disruption", "transit_disruption", "attraction_closure", "reservation_time_changed", "itinerary_timing_conflict"].includes(eventType)) {
    return ["daily_itinerary_generation", "itinerary_logistics_validation", "schedule_validation", "backup_plan_generation", "final_assembly"];
  }
  return ["final_assembly"];
}

export function approvalRequiredForEvent(eventType: CompanionEventType, severity: CompanionSeverity) {
  return severity === "critical" || ["flight_cancelled", "hotel_cancelled", "missed_connection_risk"].includes(eventType);
}

export async function recordBookingChangeEvent(params: {
  supabase: SupabaseClient;
  input: BookingChangeInput;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const fingerprint = companionEventFingerprint(params.input);
  const row = {
    booking_id: params.input.bookingId,
    trip_id: params.input.tripId,
    user_id: params.input.userId,
    event_type: params.input.eventType,
    old_value_json: params.input.oldValue || {},
    new_value_json: params.input.newValue || {},
    source: params.input.source,
    detected_at: new Date().toISOString(),
    effective_at: params.input.effectiveAt || null,
    severity: params.input.severity || "minor",
    event_fingerprint: fingerprint
  };
  const saved = await writer.from("booking_change_events").upsert(row, { onConflict: "user_id,event_fingerprint" }).select("*").maybeSingle();
  return {
    event: saved.data,
    fingerprint,
    deduplicated: Boolean(saved.data && saved.data.created_at && new Date(String(saved.data.created_at)).getTime() < Date.now() - 1000),
    error: saved.error?.message || null
  };
}

export async function recordCompanionEvent(params: {
  supabase: SupabaseClient;
  bookingChange: BookingChangeInput;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const fingerprint = companionEventFingerprint(params.bookingChange);
  const severity = params.bookingChange.severity || "minor";
  const copy = eventCopy(params.bookingChange.eventType, severity, params.bookingChange.newValue || {});
  const affectedLayers = affectedLayersForCompanionEvent(params.bookingChange.eventType);
  const row = {
    trip_id: params.bookingChange.tripId,
    user_id: params.bookingChange.userId,
    source_booking_id: params.bookingChange.bookingId,
    event_type: params.bookingChange.eventType,
    severity,
    status: approvalRequiredForEvent(params.bookingChange.eventType, severity) ? "proposed" : "new",
    title: copy.title,
    summary: copy.summary,
    affected_layers: affectedLayers,
    requires_user_approval: approvalRequiredForEvent(params.bookingChange.eventType, severity),
    event_fingerprint: fingerprint,
    detected_at: new Date().toISOString()
  };
  const saved = await writer.from("companion_events").upsert(row, { onConflict: "user_id,event_fingerprint" }).select("*").maybeSingle();
  return { event: saved.data, fingerprint, error: saved.error?.message || null };
}

export async function processBookingChangeEvent(params: {
  supabase: SupabaseClient;
  input: BookingChangeInput;
}) {
  const bookingChange = await recordBookingChangeEvent(params);
  if (bookingChange.error) return { ok: false as const, error: bookingChange.error };
  const companion = await recordCompanionEvent({ supabase: params.supabase, bookingChange: params.input });
  if (companion.error) return { ok: false as const, error: companion.error };
  const companionEventId = (companion.event as { id?: string } | null)?.id || "";
  const impact = companionEventId
    ? await analyzeCompanionImpact({ supabase: params.supabase, companionEventId }).catch(() => null)
    : null;
  await (createSupabaseAdminClient() || params.supabase)
    .from("booking_change_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("user_id", params.input.userId)
    .eq("event_fingerprint", bookingChange.fingerprint);
  return {
    ok: true as const,
    bookingChangeEvent: bookingChange.event,
    companionEvent: companion.event,
    impact: impact?.ok ? impact.impact : null,
    deduplicated: bookingChange.deduplicated,
    affectedLayers: affectedLayersForCompanionEvent(params.input.eventType)
  };
}

export function eventFromLiveProviderResult(params: {
  bookingId: string;
  tripId: string;
  userId: string;
  result: LiveProviderResult;
  previous?: Record<string, unknown> | null;
}): BookingChangeInput | null {
  const current = params.result.normalized_result || {};
  const status = typeof current.status === "string" ? current.status.toLowerCase() : "";
  if (params.result.kind === "live_flight_status" && /cancel/.test(status)) {
    return { bookingId: params.bookingId, tripId: params.tripId, userId: params.userId, eventType: "flight_cancelled", oldValue: params.previous || {}, newValue: current, source: params.result.provider, severity: "critical", effectiveAt: params.result.effective_at };
  }
  if (params.result.kind === "live_flight_status" && (/delay/.test(status) || typeof current.delay_minutes === "number")) {
    return { bookingId: params.bookingId, tripId: params.tripId, userId: params.userId, eventType: "flight_delayed", oldValue: params.previous || {}, newValue: current, source: params.result.provider, severity: "important", effectiveAt: params.result.effective_at };
  }
  if (params.result.kind === "airport_gate" && current.gate) {
    return { bookingId: params.bookingId, tripId: params.tripId, userId: params.userId, eventType: "gate_changed", oldValue: params.previous || {}, newValue: current, source: params.result.provider, severity: "important", effectiveAt: params.result.effective_at };
  }
  if (params.result.kind === "attraction_closure" && /closed|cancel/.test(status)) {
    return { bookingId: params.bookingId, tripId: params.tripId, userId: params.userId, eventType: "attraction_closure", oldValue: params.previous || {}, newValue: current, source: params.result.provider, severity: "important", effectiveAt: params.result.effective_at };
  }
  return null;
}
