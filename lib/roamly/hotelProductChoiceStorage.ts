import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HotelProductChoice,
  HotelProductChoiceResult
} from "./selectedHotelProductChoice.ts";
import type { SelectedHotelProductFactualChange } from "./selectedHotelProductAvailability.ts";

/**
 * Storage accepts a choice that was already validated by the choice domain.
 * It stores pending intent only; it is not current availability or booking truth.
 */
export type ValidatedHotelProductChoiceForStorage = {
  choice: HotelProductChoice;
  acknowledgedMaterialChanges: SelectedHotelProductFactualChange[];
};

export type StoredHotelProductChoice = ValidatedHotelProductChoiceForStorage & {
  tripId: string;
};

type ChoiceRow = {
  trip_id: string;
  provider: HotelProductChoice["provider"];
  provider_property_id: string;
  selected_hotel_candidate_id: string;
  provider_product_id: string;
  revalidated_at: string;
  chosen_at: string;
  acknowledged_material_changes: SelectedHotelProductFactualChange[];
};

const RELEASED_CHANGES: SelectedHotelProductFactualChange[] = [
  "PRICE_CHANGED",
  "CURRENCY_CHANGED",
  "ROOM_DESCRIPTION_CHANGED",
  "CANCELLATION_CHANGED",
  "CHARGES_CHANGED",
  "AVAILABILITY_CHANGED"
];

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validTimestamp(value: unknown): value is string {
  return validId(value) && Number.isFinite(Date.parse(value));
}

function canonicalChanges(value: unknown) {
  if (!Array.isArray(value)) return null;
  const changes = value.filter((item): item is SelectedHotelProductFactualChange =>
    typeof item === "string" && RELEASED_CHANGES.includes(item as SelectedHotelProductFactualChange)
  );
  if (changes.length !== value.length || new Set(changes).size !== changes.length) return null;
  return RELEASED_CHANGES.filter((change) => changes.includes(change));
}

function rowFromValidatedChoice(tripId: string, input: ValidatedHotelProductChoiceForStorage): ChoiceRow | null {
  const choice = input.choice;
  const acknowledged = canonicalChanges(input.acknowledgedMaterialChanges);
  if (
    !validId(tripId) ||
    !validId(choice.selectedHotelCandidateId) ||
    choice.provider !== "booking_demand" ||
    !validId(choice.providerPropertyId) ||
    !validId(choice.providerProductId) ||
    !validTimestamp(choice.revalidatedAt) ||
    !validTimestamp(choice.chosenAt) ||
    choice.choiceSource !== "CUSTOMER_EXPLICIT" ||
    choice.bookingContinuity !== "UNVERIFIED" ||
    choice.actionability !== "INFORMATIONAL_ONLY" ||
    !acknowledged
  ) return null;

  return {
    trip_id: tripId,
    provider: choice.provider,
    provider_property_id: choice.providerPropertyId,
    selected_hotel_candidate_id: choice.selectedHotelCandidateId,
    provider_product_id: choice.providerProductId,
    revalidated_at: choice.revalidatedAt,
    chosen_at: choice.chosenAt,
    acknowledged_material_changes: acknowledged
  };
}

function choiceFromRow(row: ChoiceRow): StoredHotelProductChoice | null {
  const acknowledged = canonicalChanges(row.acknowledged_material_changes);
  if (!validId(row.trip_id) || !validId(row.provider_property_id) || !validId(row.selected_hotel_candidate_id) || !validId(row.provider_product_id) || row.provider !== "booking_demand" || !validTimestamp(row.revalidated_at) || !validTimestamp(row.chosen_at) || !acknowledged) return null;
  return {
    tripId: row.trip_id,
    acknowledgedMaterialChanges: acknowledged,
    choice: {
      selectedHotelCandidateId: row.selected_hotel_candidate_id,
      provider: row.provider,
      providerPropertyId: row.provider_property_id,
      providerProductId: row.provider_product_id,
      chosenAt: row.chosen_at,
      choiceSource: "CUSTOMER_EXPLICIT",
      revalidatedAt: row.revalidated_at,
      bookingContinuity: "UNVERIFIED",
      actionability: "INFORMATIONAL_ONLY"
    }
  };
}

/** Reads saved pending intent; callers must validate it against current hotel/revalidation truth. */
export async function getPendingHotelProductChoice(supabase: SupabaseClient, tripId: string) {
  const result = await supabase
    .from("roamly_pending_hotel_product_choices")
    .select("trip_id,provider,provider_property_id,selected_hotel_candidate_id,provider_product_id,revalidated_at,chosen_at,acknowledged_material_changes")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (result.error) return { choice: null, error: result.error.message };
  return { choice: result.data ? choiceFromRow(result.data as ChoiceRow) : null, error: null };
}

/** Atomically replaces the one pending intent for this trip; no trip metadata is read or written. */
export async function replacePendingHotelProductChoice(
  supabase: SupabaseClient,
  tripId: string,
  input: ValidatedHotelProductChoiceForStorage
) {
  const row = rowFromValidatedChoice(tripId, input);
  if (!row) return { choice: null, error: "INVALID_VALIDATED_HOTEL_PRODUCT_CHOICE" };
  const result = await supabase
    .from("roamly_pending_hotel_product_choices")
    .upsert(row, { onConflict: "trip_id" })
    .select("trip_id,provider,provider_property_id,selected_hotel_candidate_id,provider_product_id,revalidated_at,chosen_at,acknowledged_material_changes")
    .single();
  if (result.error) return { choice: null, error: result.error.message };
  return { choice: choiceFromRow(result.data as ChoiceRow), error: null };
}

/** Explicitly clears pending intent without touching the trip or confirmed bookings. */
export async function clearPendingHotelProductChoice(supabase: SupabaseClient, tripId: string) {
  const result = await supabase
    .from("roamly_pending_hotel_product_choices")
    .delete()
    .eq("trip_id", tripId);
  return { ok: !result.error, error: result.error?.message || null };
}

/** Bridges a validated domain result without deciding whether its evidence was sufficient. */
export function storageInputFromActiveChoiceResult(result: HotelProductChoiceResult): ValidatedHotelProductChoiceForStorage | null {
  if (result.status !== "ACTIVE_CHOICE" || !result.choice) return null;
  return { choice: result.choice, acknowledgedMaterialChanges: result.materialChanges };
}
