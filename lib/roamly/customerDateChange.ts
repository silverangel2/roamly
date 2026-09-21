import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import { getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";

export const DATE_CHANGE_PROPOSAL_STATUSES = ["awaiting_approval", "reserved", "generating", "applied", "failed", "stale", "rejected"] as const;
export type DateChangeProposalStatus = (typeof DATE_CHANGE_PROPOSAL_STATUSES)[number];

export type DateChangeEligibility = { ok: true } | { ok: false; code: string; message: string };

export function validateRequestedDateChange(startDate: string, endDate: string, currentStart: string | null, currentEnd: string | null): DateChangeEligibility {
  const range = calculateTripDateRange(startDate, endDate);
  if (!range.ok || !startDate || !endDate) return { ok: false, code: "INVALID_DATE_RANGE", message: "Choose a valid start and end date." };
  if (currentStart === startDate && currentEnd === endDate) return { ok: false, code: "DATES_UNCHANGED", message: "Choose dates different from the current trip." };
  return { ok: true };
}

export function dateChangeLifecycleAllowed(status: string | null | undefined) {
  return status === "generated" || status === "locked" || status === "planned";
}

export function evaluateDateChangeBookingStatuses(statuses: string[]): DateChangeEligibility {
  for (const raw of statuses) {
    const status = raw.toLowerCase();
    if (["booked", "paid", "reserved"].includes(status)) return { ok: false, code: "CONFIRMED_BOOKING_BLOCKS_DATE_CHANGE", message: "This trip has a booking that Roamly will not change." };
    if (status === "cancelled" || status === "unknown") return { ok: false, code: "BOOKING_REVIEW_REQUIRED", message: "This trip has booking evidence that needs review before its dates can change." };
    return { ok: false, code: "UNKNOWN_BOOKING_STATE", message: "Roamly could not safely verify the trip's booking state." };
  }
  return { ok: true };
}

export function buildSuccessorIntentSnapshot(trip: Record<string, unknown>) {
  const planning = { ...getTripPlanningMetadata(trip.metadata) };
  delete planning.startDate;
  delete planning.endDate;
  delete planning.daysCount;
  delete planning.priceDiscoveryId;
  delete planning.budgetConstraint;
  delete planning.generation;
  delete planning.generatedItinerary;
  return {
    origin: trip.origin ?? planning.origin ?? null,
    destination: trip.destination ?? planning.destination ?? null,
    destinationName: trip.destination_name ?? planning.destination ?? null,
    destinationCity: trip.destination_city ?? planning.destinationCity ?? null,
    destinationCountry: trip.destination_country ?? planning.destinationCountry ?? null,
    destinationRegion: trip.destination_region ?? planning.destinationRegion ?? null,
    travelersCount: trip.travelers_count ?? planning.travelersCount ?? 1,
    budgetAmount: trip.budget_amount ?? planning.budgetAmount ?? planning.budget_amount ?? planning.budget_total ?? null,
    budgetCurrency: trip.budget_currency ?? planning.budgetCurrency ?? "CAD",
    travelStyle: trip.travel_style ?? planning.travelStyle ?? null,
    interests: trip.interests ?? planning.interests ?? [],
    accommodationPreference: trip.accommodation_preference ?? planning.accommodationPreference ?? null,
    transportationPreference: trip.transportation_preference ?? planning.transportationPreference ?? null,
    specialNotes: trip.special_notes ?? planning.specialNotes ?? null,
    planning
  };
}

export async function buildBookingSnapshot(supabase: SupabaseClient, userId: string, tripId: string) {
  const canonical = await supabase.from("roamly_bookings").select("id,booking_status,traveler_confirmed,updated_at,superseded_by_booking_id").eq("user_id", userId).eq("trip_id", tripId).is("superseded_by_booking_id", null).order("id");
  if (canonical.error) return { error: canonical.error.message || "BOOKING_STATE_UNAVAILABLE", snapshot: null as null, statuses: [] as string[] };
  const statuses = (canonical.data || []).map((row) => String(row.booking_status || "unknown"));
  return {
    error: null,
    statuses,
    snapshot: {
      bookings: (canonical.data || []).map((row) => ({ id: row.id, booking_status: row.booking_status, traveler_confirmed: row.traveler_confirmed, updated_at_epoch: row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null, superseded_by_booking_id: row.superseded_by_booking_id }))
    }
  };
}

export function buildDateChangePreview(params: { currentStart: string | null; currentEnd: string | null; requestedStart: string; requestedEnd: string; bookingStatuses: string[] }) {
  return {
    currentStartDate: params.currentStart,
    currentEndDate: params.currentEnd,
    requestedStartDate: params.requestedStart,
    requestedEndDate: params.requestedEnd,
    existingBookingsChanged: false,
    bookingStatuses: params.bookingStatuses,
    refreshes: ["flights", "hotels", "activities", "events", "prices", "routing"],
    note: "Existing bookings will not be changed."
  };
}
