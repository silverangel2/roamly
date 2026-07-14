import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stableBookingKey, type TripBookingRecord } from "@/lib/roamly/bookingWallet";
import { ROAMLY_BRAIN_VERSION, type BrainStageDefinition, type RoamlyBrainStageType } from "@/lib/roamly/brain/stages";
import { processCompanionBookingChange } from "@/lib/roamly/companionOrchestrator";

export const BOOKING_RECONCILIATION_STAGE = {
  type: "booking_reconciliation",
  sequence: 17,
  label: "Reviewing your bookings",
  version: "1.0.0",
  dependencies: ["final_assembly"],
  retryClass: "deterministic",
  providerRequirements: ["none"],
  evidenceRequirements: ["provider_sources", "decision_scores"],
  invalidatedBy: ["travel_dates", "transport", "hotel", "activity", "budget"],
  inputSchema: {
    type: "object",
    required: ["tripId", "userId", "bookings"],
    properties: { tripId: "string", userId: "string", bookings: "array", itineraryAssumptions: "object" }
  },
  outputSchema: {
    type: "object",
    required: ["activeBookings", "duplicateGroups", "affectedLayers"],
    properties: { activeBookings: "array", duplicateGroups: "array", affectedLayers: "array", recommendationHistoryPreserved: "boolean" }
  }
} as const satisfies BrainStageDefinition;

type ReconciliationBooking = Pick<
  TripBookingRecord,
  | "id"
  | "booking_type"
  | "booking_status"
  | "provider"
  | "provider_booking_id"
  | "confirmation_code"
  | "recommendation_id"
  | "source_type"
  | "source_reference"
  | "title"
  | "start_time"
  | "origin"
  | "destination"
  | "flight_number"
  | "traveler_confirmed"
  | "updated_at"
>;

const statusRank: Record<string, number> = {
  confirmed: 100,
  modified: 90,
  detected: 70,
  needs_confirmation: 60,
  recommended: 30,
  clicked: 20,
  completed: 10,
  cancelled: 0,
  refunded: 0
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function keyForBooking(userId: string, booking: ReconciliationBooking) {
  return stableBookingKey({
    userId,
    provider: booking.provider,
    providerBookingId: booking.provider_booking_id,
    confirmationCode: booking.confirmation_code,
    bookingType: booking.booking_type,
    flightNumber: booking.flight_number,
    startTime: booking.start_time,
    origin: booking.origin,
    destination: booking.destination,
    title: booking.title
  });
}

function betterBooking(a: ReconciliationBooking, b: ReconciliationBooking) {
  const rankDiff = (statusRank[b.booking_status] || 0) - (statusRank[a.booking_status] || 0);
  if (rankDiff !== 0) return rankDiff;
  if (b.traveler_confirmed !== a.traveler_confirmed) return b.traveler_confirmed ? 1 : -1;
  return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
}

function affectedLayersForBooking(booking: ReconciliationBooking): RoamlyBrainStageType[] {
  if (["flight", "train", "bus", "ferry", "rental_car", "transfer"].includes(booking.booking_type)) {
    return [
      "transport_decision",
      "daily_itinerary_generation",
      "itinerary_logistics_validation",
      "budget_validation",
      "schedule_validation",
      "backup_plan_generation",
      "final_assembly"
    ];
  }
  if (booking.booking_type === "hotel") {
    return [
      "accommodation_decision",
      "daily_itinerary_generation",
      "itinerary_logistics_validation",
      "budget_validation",
      "schedule_validation",
      "backup_plan_generation",
      "final_assembly"
    ];
  }
  if (["activity", "restaurant"].includes(booking.booking_type)) {
    return ["daily_itinerary_generation", "itinerary_logistics_validation", "budget_validation", "schedule_validation", "backup_plan_generation", "final_assembly"];
  }
  return ["budget_validation", "final_assembly"];
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function mergeMissingFields(primary: ReconciliationBooking, duplicate: ReconciliationBooking) {
  const update: Record<string, unknown> = {};
  [
    "provider_booking_id",
    "confirmation_code",
    "start_time",
    "origin",
    "destination",
    "flight_number"
  ].forEach((key) => {
    if (!clean(primary[key as keyof ReconciliationBooking]) && clean(duplicate[key as keyof ReconciliationBooking])) {
      update[key] = duplicate[key as keyof ReconciliationBooking];
    }
  });
  return update;
}

async function updatePrimaryFromDuplicates(params: {
  supabase: SupabaseClient;
  primary: ReconciliationBooking;
  duplicates: ReconciliationBooking[];
}) {
  const update = params.duplicates.reduce((acc, duplicate) => ({ ...acc, ...mergeMissingFields(params.primary, duplicate) }), {});
  if (Object.keys(update).length === 0) return false;
  await params.supabase.from("roamly_bookings").update({ ...update, last_synced_at: new Date().toISOString() }).eq("id", params.primary.id);
  return true;
}

export function reconcileBookingRecords(userId: string, bookings: ReconciliationBooking[]) {
  const groups = new Map<string, ReconciliationBooking[]>();
  for (const booking of bookings) {
    const key = keyForBooking(userId, booking);
    const existing = groups.get(key) || [];
    existing.push(booking);
    groups.set(key, existing);
  }

  const activeBookings = [];
  const duplicateGroups = [];
  const affectedLayers = new Set<RoamlyBrainStageType>();
  for (const [stableKey, group] of groups.entries()) {
    const sorted = [...group].sort(betterBooking);
    const primary = sorted[0];
    activeBookings.push(primary);
    affectedLayersForBooking(primary).forEach((layer) => affectedLayers.add(layer));
    if (sorted.length > 1) {
      duplicateGroups.push({
        stableKey,
        primaryBookingId: primary.id,
        duplicateBookingIds: sorted.slice(1).map((booking) => booking.id),
        recommendationIds: unique(sorted.map((booking) => booking.recommendation_id).filter(Boolean))
      });
    }
  }

  return {
    activeBookings,
    duplicateGroups,
    affectedLayers: [...affectedLayers].sort(),
    recommendationHistoryPreserved: bookings.some((booking) => Boolean(booking.recommendation_id)),
    generationVersion: ROAMLY_BRAIN_VERSION,
    stageVersion: BOOKING_RECONCILIATION_STAGE.version
  };
}

export async function reconcileTripBookings(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  sourceBookingId?: string | null;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { data: trip } = await writer.from("roamly_trips").select("id").eq("id", params.tripId).eq("user_id", params.userId).maybeSingle();
  if (!trip) return { ok: false as const, error: "TRIP_NOT_FOUND" };

  const { data, error } = await writer
    .from("roamly_bookings")
    .select("id,booking_type,booking_status,provider,provider_booking_id,confirmation_code,recommendation_id,source_type,source_reference,title,start_time,origin,destination,flight_number,traveler_confirmed,updated_at")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId);
  if (error) return { ok: false as const, error: error.message };

  const bookings = (data || []) as ReconciliationBooking[];
  const output = reconcileBookingRecords(params.userId, bookings);
  for (const group of output.duplicateGroups) {
    const primary = bookings.find((booking) => booking.id === group.primaryBookingId);
    const duplicates = bookings.filter((booking) => group.duplicateBookingIds.includes(booking.id));
    if (primary) await updatePrimaryFromDuplicates({ supabase: writer, primary, duplicates }).catch(() => null);
  }

  await writer.from("booking_reconciliation_runs").insert({
    trip_id: params.tripId,
    user_id: params.userId,
    source_booking_id: params.sourceBookingId || null,
    status: output.duplicateGroups.length ? "needs_confirmation" : "completed",
    input_json: {
      stage: BOOKING_RECONCILIATION_STAGE.type,
      bookingCount: bookings.length,
      sourceBookingId: params.sourceBookingId || null
    },
    output_json: output,
    affected_layers: output.affectedLayers
  });

  let companionWorkflow = null;

  if (params.sourceBookingId) {
    const sourceBooking = bookings.find(
      (booking) => booking.id === params.sourceBookingId
    );

    if (sourceBooking) {
      const bookingLabel =
        sourceBooking.title ||
        sourceBooking.flight_number ||
        sourceBooking.provider ||
        "Travel booking";

      const bookingStatus =
        sourceBooking.booking_status || "updated";

      companionWorkflow = await processCompanionBookingChange({
        supabase: writer,
        userId: params.userId,
        tripId: params.tripId,
        bookingId: sourceBooking.id,
        eventType:
          bookingStatus === "cancelled"
            ? "booking_cancelled"
            : bookingStatus === "confirmed"
              ? "booking_confirmed"
              : "booking_updated",
        severity:
          bookingStatus === "cancelled"
            ? "critical"
            : bookingStatus === "confirmed"
              ? "routine"
              : "important",
        title:
          bookingStatus === "cancelled"
            ? `${bookingLabel} was cancelled`
            : bookingStatus === "confirmed"
              ? `${bookingLabel} is confirmed`
              : `${bookingLabel} was updated`,
        summary:
          bookingStatus === "cancelled"
            ? "Roamly detected a cancelled booking and checked the itinerary for affected plans."
            : bookingStatus === "confirmed"
              ? "Roamly confirmed this booking and checked it against the current itinerary."
              : "Roamly detected a booking update and checked the itinerary for timing or planning conflicts.",
        newValue: {
          bookingStatus,
          bookingType: sourceBooking.booking_type,
          provider: sourceBooking.provider,
          confirmationCode: sourceBooking.confirmation_code,
          startTime: sourceBooking.start_time,
          origin: sourceBooking.origin,
          destination: sourceBooking.destination,
          flightNumber: sourceBooking.flight_number,
          travelerConfirmed: sourceBooking.traveler_confirmed
        },
        source: sourceBooking.source_type || "booking_reconciliation",
        effectiveAt: sourceBooking.updated_at || new Date().toISOString(),
        affectedLayers: output.affectedLayers,
        requiresUserApproval:
          bookingStatus === "cancelled" ||
          output.duplicateGroups.length > 0,
        fingerprintParts: [
          sourceBooking.updated_at || null,
          bookingStatus,
          output.duplicateGroups.length
        ]
      }).catch((error) => ({
        ok: false as const,
        stage: "orchestrator_exception" as const,
        error:
          error instanceof Error
            ? error.message
            : "Companion orchestration failed."
      }));
    }
  }

  return {
    ok: true as const,
    output,
    companionWorkflow
  };
}
