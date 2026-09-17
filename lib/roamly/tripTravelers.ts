import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCountryCode } from "@/lib/roamly/placeResolver";
import { deriveTravelRequirements, type TravelRequirement } from "@/lib/roamly/travelRequirements";

export type TripTravelerRole = "companion";
export type TripTravelerType = "adult" | "child" | "infant";

export type TripTravelerRecord = {
  id: string;
  trip_id: string;
  traveler_order: number;
  role: TripTravelerRole | "account_holder";
  traveler_type: TripTravelerType;
  passport_issuing_country: string | null;
  created_at: string;
  updated_at: string;
};

export type TripTravelerSlot = {
  id: string | null;
  travelerOrder: number;
  role: TripTravelerRole | "account_holder";
  travelerType: TripTravelerType;
  label: string;
  passportIssuingCountry: string | null;
  persisted: boolean;
};

export type TripTravelerRequirementEvaluation = {
  id: string;
  label: string;
  role: "account_holder" | "companion";
  travelerType: TripTravelerType;
  travelerOrder: number;
  passportIssuingCountry: string | null;
  persisted: boolean;
  requirements: TravelRequirement[];
};

type TripShape = {
  id: string;
  travelers_count?: number | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  metadata?: unknown;
};

type Composition = {
  total: number;
  adults: number;
  children: number;
  infants: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function getComposition(trip: TripShape): Composition | null {
  const total = typeof trip.travelers_count === "number" && Number.isInteger(trip.travelers_count) && trip.travelers_count >= 1
    ? trip.travelers_count
    : null;
  const planning = record(record(trip.metadata).planning);
  const travelers = record(planning.travelers);
  const adults = nonNegativeInteger(travelers.adults);
  const children = nonNegativeInteger(travelers.children) ?? 0;
  const infants = nonNegativeInteger(travelers.infants) ?? 0;
  if (total === null) return null;
  if (total === 1 && adults === null) return { total, adults: 1, children: 0, infants: 0 };
  if (adults === null || adults < 1 || adults + children + infants !== total) return null;
  return { total, adults, children, infants };
}

function companionSlots(composition: Composition): Array<{ travelerOrder: number; travelerType: TripTravelerType; label: string }> {
  if (composition.total <= 1) return [];
  const types: TripTravelerType[] = [
    ...Array.from({ length: Math.max(0, composition.adults - 1) }, () => "adult" as const),
    ...Array.from({ length: composition.children }, () => "child" as const),
    ...Array.from({ length: composition.infants }, () => "infant" as const)
  ];
  const occurrences: Record<TripTravelerType, number> = { adult: 1, child: 1, infant: 1 };
  return types.map((travelerType, index) => ({
    travelerOrder: index + 2,
    travelerType,
    label: `${travelerType[0].toUpperCase()}${travelerType.slice(1)} ${occurrences[travelerType]++ + (travelerType === "adult" ? 1 : 0)}`
  }));
}

function normalizeRow(value: Record<string, unknown>): TripTravelerRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.trip_id !== "string" ||
    typeof value.traveler_order !== "number" ||
    (value.role !== "companion" && value.role !== "account_holder") ||
    (value.traveler_type !== "adult" && value.traveler_type !== "child" && value.traveler_type !== "infant")
  ) return null;
  return {
    id: value.id,
    trip_id: value.trip_id,
    traveler_order: value.traveler_order,
    role: value.role,
    traveler_type: value.traveler_type,
    passport_issuing_country: typeof value.passport_issuing_country === "string"
      ? normalizeCountryCode(value.passport_issuing_country)
      : null,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    updated_at: typeof value.updated_at === "string" ? value.updated_at : ""
  };
}

export function tripTravelerComposition(trip: TripShape) {
  return getComposition(trip);
}

export function expectedTripTravelerSlots(trip: TripShape): TripTravelerSlot[] {
  const composition = getComposition(trip);
  if (!composition) {
    const total = typeof trip.travelers_count === "number" && Number.isInteger(trip.travelers_count) && trip.travelers_count > 1
      ? trip.travelers_count
      : 0;
    return total ? [{
      id: null,
      travelerOrder: 1,
      role: "account_holder" as const,
      travelerType: "adult" as const,
      label: "You",
      passportIssuingCountry: null,
      persisted: false
    }] : [];
  }
  const slots: TripTravelerSlot[] = [
    {
      id: null,
      travelerOrder: 1,
      role: "account_holder" as const,
      travelerType: "adult" as const,
      label: "You",
      passportIssuingCountry: null,
      persisted: false
    },
    ...companionSlots(composition).map((slot): TripTravelerSlot => ({
      id: null,
      travelerOrder: slot.travelerOrder,
      role: "companion" as const,
      travelerType: slot.travelerType as TripTravelerType,
      label: slot.label,
      passportIssuingCountry: null,
      persisted: false
    }))
  ];
  return slots.slice(0, composition.total);
}

export async function listTripTravelers(supabase: SupabaseClient, tripId: string) {
  const result = await supabase
    .from("roamly_trip_travelers")
    .select("id,trip_id,traveler_order,role,traveler_type,passport_issuing_country,created_at,updated_at")
    .eq("trip_id", tripId)
    .order("traveler_order", { ascending: true });
  if (result.error) return { travelers: [] as TripTravelerRecord[], error: result.error.message };
  return {
    travelers: (result.data || []).map((row) => normalizeRow(row as Record<string, unknown>)).filter((row): row is TripTravelerRecord => Boolean(row)),
    error: null
  };
}

export async function reconcileTripCompanionSlots(params: {
  admin: SupabaseClient;
  trip: TripShape;
}) {
  const composition = getComposition(params.trip);
  if (!composition) return { ok: false as const, error: "TRAVELER_COMPOSITION_UNAVAILABLE", travelers: [] as TripTravelerRecord[] };

  const existingResult = await listTripTravelers(params.admin, params.trip.id);
  if (existingResult.error) return { ok: false as const, error: existingResult.error, travelers: [] as TripTravelerRecord[] };
  const existing = existingResult.travelers.filter((row) => row.role === "companion");
  const slots = companionSlots(composition);
  const validOrders = new Set(slots.map((slot) => slot.travelerOrder));

  for (const row of existing) {
    if (!validOrders.has(row.traveler_order)) {
      const removed = await params.admin
        .from("roamly_trip_travelers")
        .delete()
        .eq("id", row.id)
        .eq("trip_id", params.trip.id)
        .eq("role", "companion");
      if (removed.error) return { ok: false as const, error: removed.error.message, travelers: [] as TripTravelerRecord[] };
    }
  }

  for (const slot of slots) {
    const row = existing.find((candidate) => candidate.traveler_order === slot.travelerOrder);
    if (!row) {
      const inserted = await params.admin.from("roamly_trip_travelers").insert({
        trip_id: params.trip.id,
        traveler_order: slot.travelerOrder,
        role: "companion",
        traveler_type: slot.travelerType
      });
      if (inserted.error && inserted.error.code !== "23505") {
        return { ok: false as const, error: inserted.error.message, travelers: [] as TripTravelerRecord[] };
      }
    } else if (row.traveler_type !== slot.travelerType) {
      const changed = await params.admin
        .from("roamly_trip_travelers")
        .update({ traveler_type: slot.travelerType, passport_issuing_country: null })
        .eq("id", row.id)
        .eq("trip_id", params.trip.id)
        .eq("role", "companion");
      if (changed.error) return { ok: false as const, error: changed.error.message, travelers: [] as TripTravelerRecord[] };
    }
  }

  const refreshed = await listTripTravelers(params.admin, params.trip.id);
  if (refreshed.error) return { ok: false as const, error: refreshed.error, travelers: [] as TripTravelerRecord[] };
  return { ok: true as const, travelers: refreshed.travelers };
}

export function buildTripTravelerRequirements(params: {
  trip: TripShape;
  travelers: TripTravelerRecord[];
  accountHolderPassportCountry?: string | null;
}) {
  const slots = expectedTripTravelerSlots(params.trip);
  const companionRows = new Map(
    params.travelers
      .filter((row) => row.role === "companion")
      .map((row) => [row.traveler_order, row])
  );
  const planning = record(record(params.trip.metadata).planning);
  const destination = params.trip.destination_country || (typeof planning.destinationCountry === "string" ? planning.destinationCountry : null);
  const startDate = params.trip.start_date || (typeof planning.startDate === "string" ? planning.startDate : null);
  const endDate = params.trip.end_date || (typeof planning.endDate === "string" ? planning.endDate : null);
  const requirementsFor = (slot: TripTravelerSlot, country: string | null) => deriveTravelRequirements({
    destinationCountry: destination,
    passportIssuingCountry: country,
    startDate: typeof startDate === "string" ? startDate : null,
    endDate: typeof endDate === "string" ? endDate : null,
    travelerCount: slot.role === "account_holder" && !getComposition(params.trip) ? params.trip.travelers_count : 1
  }).map((requirement) => ({
    ...requirement,
    accountHolderOnly: slot.role === "account_holder"
  }));

  const evaluations = slots.map((slot) => {
    const row = slot.role === "companion" ? companionRows.get(slot.travelerOrder) : null;
    const country = slot.role === "account_holder" ? normalizeCountryCode(params.accountHolderPassportCountry || null) : row?.passport_issuing_country || null;
    return {
      id: row?.id || `traveler-slot-${slot.travelerOrder}`,
      label: slot.role === "account_holder" ? "You" : slot.label,
      role: slot.role,
      travelerType: slot.travelerType,
      travelerOrder: slot.travelerOrder,
      passportIssuingCountry: country,
      persisted: Boolean(row),
      requirements: requirementsFor(slot, country)
    } satisfies TripTravelerRequirementEvaluation;
  });
  return {
    composition: getComposition(params.trip),
    evaluations,
    needsReconciliation: Boolean(getComposition(params.trip)?.total && getComposition(params.trip)!.total > 1 && companionRows.size !== Math.max(0, getComposition(params.trip)!.total - 1))
  };
}
