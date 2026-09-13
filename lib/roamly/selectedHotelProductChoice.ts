import type { SelectedHotelProductAvailabilityResult, SelectedHotelProductFactualChange } from "./selectedHotelProductAvailability.ts";

/**
 * A choice is an explicit customer intent observed for one selected property.
 * providerProductId is the provider's observed product identifier, not a
 * permanent rate-plan identity and not booking authorization.
 */
export type HotelProductChoice = {
  selectedHotelCandidateId: string;
  provider: "booking_demand";
  providerPropertyId: string;
  providerProductId: string;
  chosenAt: string;
  choiceSource: "CUSTOMER_EXPLICIT";
  revalidatedAt: string;
  bookingContinuity: "UNVERIFIED";
  actionability: "INFORMATIONAL_ONLY";
};

export type HotelProductChoiceStatus =
  | "ACTIVE_CHOICE"
  | "SUPPRESSED_BY_CONFIRMED_BOOKING"
  | "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT"
  | "INVALID_CHOICE";

export type HotelProductChoiceReason =
  | "CURRENT_REVALIDATION_REQUIRED"
  | "CONFIRMED_BOOKING_AUTHORITATIVE"
  | "MATERIAL_FACTUAL_CHANGE"
  | "SELECTED_HOTEL_MISMATCH"
  | "PRODUCT_MISMATCH"
  | "REVALIDATION_EVIDENCE_MISSING"
  | "INVALID_HOTEL_IDENTITY"
  | "INVALID_PRODUCT_IDENTITY"
  | "UNKNOWN_FACTUAL_CHANGE"
  | "ACKNOWLEDGEMENT_MISMATCH";

export type TrustedSelectedHotelIdentity = {
  selectedHotelCandidateId: string;
  providerPropertyId: string;
  provider: "booking_demand";
};

export type CreateHotelProductChoiceInput = {
  selectedHotel: TrustedSelectedHotelIdentity | null;
  revalidation: SelectedHotelProductAvailabilityResult | null;
  confirmedBooking: boolean;
  chosenAt: string;
  /** Trusted server-side acknowledgment of exactly the current factual change set. */
  acknowledgedMaterialChanges?: SelectedHotelProductFactualChange[];
};

export type HotelProductChoiceResult = {
  status: HotelProductChoiceStatus;
  choice: HotelProductChoice | null;
  reasonCodes: HotelProductChoiceReason[];
  materialChanges: SelectedHotelProductFactualChange[];
  bookingContinuity: "UNVERIFIED";
};

export type ValidateHotelProductChoiceInput = {
  choice: HotelProductChoice | null;
  selectedHotel: TrustedSelectedHotelIdentity | null;
  confirmedBooking: boolean;
};

export type HotelProductChoiceValidation = {
  status: "VALID" | "SUPPRESSED_BY_CONFIRMED_BOOKING" | "INVALID";
  reasonCodes: HotelProductChoiceReason[];
};

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validTimestamp(value: unknown): value is string {
  return validId(value) && Number.isFinite(Date.parse(value));
}

const MATERIAL_CHANGES: SelectedHotelProductFactualChange[] = [
  "PRICE_CHANGED",
  "CURRENCY_CHANGED",
  "ROOM_DESCRIPTION_CHANGED",
  "CANCELLATION_CHANGED",
  "CHARGES_CHANGED",
  "AVAILABILITY_CHANGED"
];

function uniqueChanges(value: unknown): SelectedHotelProductFactualChange[] {
  if (!Array.isArray(value)) return [];
  return MATERIAL_CHANGES.filter((change) => value.includes(change));
}

function hasUnknownChanges(value: unknown) {
  return Array.isArray(value) && value.some((change) => !MATERIAL_CHANGES.includes(change));
}

function exactChangeSet(expected: SelectedHotelProductFactualChange[], acknowledged: unknown) {
  return Array.isArray(acknowledged) && acknowledged.length === expected.length && new Set(acknowledged).size === acknowledged.length && expected.every((change) => acknowledged.includes(change));
}

function invalidResult(reasonCodes: HotelProductChoiceReason[]): HotelProductChoiceResult {
  return { status: "INVALID_CHOICE", choice: null, reasonCodes, materialChanges: [], bookingContinuity: "UNVERIFIED" };
}

/**
 * Creates an in-memory intent only after a trusted caller proves that the
 * exact product is CURRENT for the exact selected property. No persistence,
 * provider call, budget mutation, or booking authorization occurs here.
 */
export function createHotelProductChoice(input: CreateHotelProductChoiceInput): HotelProductChoiceResult {
  if (input.confirmedBooking) {
    return { status: "SUPPRESSED_BY_CONFIRMED_BOOKING", choice: null, reasonCodes: ["CONFIRMED_BOOKING_AUTHORITATIVE"], materialChanges: [], bookingContinuity: "UNVERIFIED" };
  }
  const selected = input.selectedHotel;
  if (!selected || !validId(selected.selectedHotelCandidateId) || !validId(selected.providerPropertyId) || selected.provider !== "booking_demand") {
    return invalidResult(["INVALID_HOTEL_IDENTITY"]);
  }
  const evidence = input.revalidation;
  if (!evidence || evidence.status !== "CURRENT" || !validTimestamp(evidence.searchedAt)) {
    return invalidResult(["CURRENT_REVALIDATION_REQUIRED", "REVALIDATION_EVIDENCE_MISSING"]);
  }
  if (evidence.selectedHotelCandidateId !== selected.selectedHotelCandidateId || evidence.providerPropertyId !== selected.providerPropertyId) {
    return invalidResult(["SELECTED_HOTEL_MISMATCH"]);
  }
  const productId = evidence.intendedProviderProductId;
  if (!validId(productId)) return invalidResult(["INVALID_PRODUCT_IDENTITY"]);
  if (!evidence.refreshedProduct || evidence.refreshedProduct.providerProductId !== productId) {
    return invalidResult(["PRODUCT_MISMATCH"]);
  }
  if (!validTimestamp(input.chosenAt)) return invalidResult(["REVALIDATION_EVIDENCE_MISSING"]);
  if (hasUnknownChanges(evidence.factualChanges)) return invalidResult(["UNKNOWN_FACTUAL_CHANGE"]);
  const materialChanges = uniqueChanges(evidence.factualChanges);
  if (materialChanges.length && !exactChangeSet(materialChanges, input.acknowledgedMaterialChanges)) {
    return { status: "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT", choice: null, reasonCodes: ["MATERIAL_FACTUAL_CHANGE"], materialChanges, bookingContinuity: "UNVERIFIED" };
  }
  if (!materialChanges.length && Array.isArray(input.acknowledgedMaterialChanges) && input.acknowledgedMaterialChanges.length) return invalidResult(["ACKNOWLEDGEMENT_MISMATCH"]);
  const choice: HotelProductChoice = {
    selectedHotelCandidateId: selected.selectedHotelCandidateId,
    provider: "booking_demand",
    providerPropertyId: selected.providerPropertyId,
    providerProductId: productId,
    chosenAt: input.chosenAt,
    choiceSource: "CUSTOMER_EXPLICIT",
    revalidatedAt: evidence.searchedAt,
    bookingContinuity: "UNVERIFIED",
    actionability: "INFORMATIONAL_ONLY"
  };
  return { status: "ACTIVE_CHOICE", choice, reasonCodes: [], materialChanges, bookingContinuity: "UNVERIFIED" };
}

/** Validates binding to the currently selected property without revalidating or booking. */
export function validateHotelProductChoice(input: ValidateHotelProductChoiceInput): HotelProductChoiceValidation {
  if (input.confirmedBooking) return { status: "SUPPRESSED_BY_CONFIRMED_BOOKING", reasonCodes: ["CONFIRMED_BOOKING_AUTHORITATIVE"] };
  const choice = input.choice;
  const selected = input.selectedHotel;
  if (!choice || !selected || !validId(choice.selectedHotelCandidateId) || !validId(choice.providerPropertyId) || !validId(choice.providerProductId) || choice.provider !== "booking_demand" || choice.bookingContinuity !== "UNVERIFIED" || choice.actionability !== "INFORMATIONAL_ONLY") {
    return { status: "INVALID", reasonCodes: ["INVALID_HOTEL_IDENTITY"] };
  }
  if (choice.selectedHotelCandidateId !== selected.selectedHotelCandidateId || choice.providerPropertyId !== selected.providerPropertyId) {
    return { status: "INVALID", reasonCodes: ["SELECTED_HOTEL_MISMATCH"] };
  }
  return { status: "VALID", reasonCodes: [] };
}

/** Replaces one pending intent with exactly one newer active intent. */
export function replaceHotelProductChoice(current: HotelProductChoice | null, next: HotelProductChoiceResult): HotelProductChoice | null {
  void current;
  return next.status === "ACTIVE_CHOICE" ? next.choice : null;
}
