// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { type HotelCandidate, type HotelInventoryProvider, type HotelInventorySearchInput, type HotelProductOption } from "./hotelInventory.ts";

export type SelectedHotelProductAvailabilityStatus =
  | "CURRENT"
  | "DISAPPEARED"
  | "PROVIDER_ERROR"
  | "INVALID_PRODUCT_ID"
  | "SELECTED_HOTEL_MISSING"
  | "REQUEST_CONTEXT_MISSING"
  | "MALFORMED_PROVIDER_RESPONSE";

export type SelectedHotelProductFactualChange =
  | "PRICE_CHANGED"
  | "CURRENCY_CHANGED"
  | "ROOM_DESCRIPTION_CHANGED"
  | "CANCELLATION_CHANGED"
  | "CHARGES_CHANGED"
  | "AVAILABILITY_CHANGED";

export type SelectedHotelProductAvailabilityResult = {
  status: SelectedHotelProductAvailabilityStatus;
  selectedHotelCandidateId: string | null;
  providerPropertyId: string | null;
  intendedProviderProductId: string | null;
  refreshedProduct: HotelProductOption | null;
  previousProduct: HotelProductOption | null;
  searchedAt: string | null;
  factualChanges: SelectedHotelProductFactualChange[];
  previousProductPresent: boolean;
  comparisonStatus: "COMPARED" | "NO_PRIOR_COMPARISON";
  bookingContinuity: "UNVERIFIED";
  warning?: string;
};

type TrustedSelectedHotel = Pick<
  HotelCandidate,
  "candidateId" | "providerPropertyId" | "source" | "sourceType" | "productOptions"
> | null;

export type SelectedHotelProductAvailabilityInput = {
  // Domain-only contract: the caller must authenticate and reload this selected
  // hotel and request from the owned trip before invoking this helper.
  selectedHotel: TrustedSelectedHotel;
  request: HotelInventorySearchInput | null;
  intendedProviderProductId: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validProductId(value: unknown) {
  if (typeof value !== "string" || value.trim() !== value) return null;
  return value ? value : null;
}

function validRequest(request: HotelInventorySearchInput | null): request is HotelInventorySearchInput {
  if (!request) return false;
  if (!text(request.checkIn) || !text(request.checkOut) || !Number.isInteger(request.travelers) || request.travelers <= 0 || !Number.isInteger(request.rooms) || request.rooms <= 0) return false;
  if (!text(request.currency) || !text(request.bookerCountry)) return false;
  if (request.children != null && (!Number.isInteger(request.children) || request.children < 0)) return false;
  if (request.childAges != null && (!Array.isArray(request.childAges) || request.childAges.some((age) => !Number.isInteger(age) || age < 0))) return false;
  if ((request.children || 0) > 0 && (!Array.isArray(request.childAges) || request.childAges.length !== request.children)) return false;
  if ((request.children || 0) === 0 && request.childAges?.length) return false;
  const checkIn = Date.parse(request.checkIn);
  const checkOut = Date.parse(request.checkOut);
  return Number.isFinite(checkIn) && Number.isFinite(checkOut) && checkOut > checkIn;
}

function validOption(value: unknown): value is HotelProductOption {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const option = value as Record<string, unknown>;
  const nullableString = (item: unknown) => item === null || typeof item === "string";
  const nullableNumber = (item: unknown) => item === null || (typeof item === "number" && Number.isFinite(item) && item >= 0);
  return (option.providerProductId === null || typeof option.providerProductId === "string") &&
    nullableString(option.roomDescription) && nullableNumber(option.totalStayPrice) && nullableString(option.currency) &&
    nullableNumber(option.taxesFees) && ["included", "excluded", "unknown"].includes(String(option.taxInclusionStatus)) &&
    ["included", "excluded", "unknown"].includes(String(option.feeInclusionStatus)) &&
    ["available", "unverified", "unknown"].includes(String(option.availabilityStatus)) &&
    nullableString(option.cancellationPolicy) && nullableString(option.deepLink);
}

function productOptions(value: unknown) {
  if (value == null) return [] as HotelProductOption[];
  return Array.isArray(value) && value.every(validOption) ? value : null;
}

function validReadTimestamp(value: unknown) {
  const timestamp = text(value);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function optionFingerprint(option: HotelProductOption) {
  return JSON.stringify({
    providerProductId: option.providerProductId,
    roomDescription: option.roomDescription,
    totalStayPrice: option.totalStayPrice,
    currency: option.currency,
    taxesFees: option.taxesFees,
    taxInclusionStatus: option.taxInclusionStatus,
    feeInclusionStatus: option.feeInclusionStatus,
    availabilityStatus: option.availabilityStatus,
    cancellationPolicy: option.cancellationPolicy,
    deepLink: option.deepLink
  });
}

function uniqueProduct(options: HotelProductOption[], id: string) {
  const matches = options.filter((option) => option.providerProductId === id);
  if (!matches.length) return { option: null, conflict: false };
  const fingerprints = new Set(matches.map(optionFingerprint));
  return { option: matches[0], conflict: fingerprints.size > 1 };
}

function same(valueA: unknown, valueB: unknown) {
  return valueA === valueB;
}

function factualChanges(oldOption: HotelProductOption | null, newOption: HotelProductOption) {
  if (!oldOption) return [];
  const changes: SelectedHotelProductFactualChange[] = [];
  if (!same(oldOption.totalStayPrice, newOption.totalStayPrice)) changes.push("PRICE_CHANGED");
  if (text(oldOption.currency).toUpperCase() !== text(newOption.currency).toUpperCase()) changes.push("CURRENCY_CHANGED");
  if (!same(oldOption.roomDescription, newOption.roomDescription)) changes.push("ROOM_DESCRIPTION_CHANGED");
  if (!same(oldOption.cancellationPolicy, newOption.cancellationPolicy)) changes.push("CANCELLATION_CHANGED");
  if (!same(oldOption.taxesFees, newOption.taxesFees) || oldOption.taxInclusionStatus !== newOption.taxInclusionStatus || oldOption.feeInclusionStatus !== newOption.feeInclusionStatus) changes.push("CHARGES_CHANGED");
  if (!same(oldOption.availabilityStatus, newOption.availabilityStatus)) changes.push("AVAILABILITY_CHANGED");
  return changes;
}

function baseResult(input: SelectedHotelProductAvailabilityInput, status: SelectedHotelProductAvailabilityStatus): SelectedHotelProductAvailabilityResult {
  return {
    status,
    selectedHotelCandidateId: text(input.selectedHotel?.candidateId) || null,
    providerPropertyId: text(input.selectedHotel?.providerPropertyId) || null,
    intendedProviderProductId: validProductId(input.intendedProviderProductId),
    refreshedProduct: null,
    previousProduct: null,
    searchedAt: null,
    factualChanges: [],
    previousProductPresent: false,
    comparisonStatus: "NO_PRIOR_COMPARISON",
    bookingContinuity: "UNVERIFIED"
  };
}

export async function revalidateSelectedHotelProduct(
  provider: Pick<HotelInventoryProvider, "getPropertyAvailability">,
  input: SelectedHotelProductAvailabilityInput
): Promise<SelectedHotelProductAvailabilityResult> {
  const intendedId = validProductId(input.intendedProviderProductId);
  if (!intendedId) return baseResult(input, "INVALID_PRODUCT_ID");

  const selectedHotel = input.selectedHotel;
  const providerPropertyId = text(selectedHotel?.providerPropertyId);
  if (!selectedHotel || !text(selectedHotel.candidateId) || !providerPropertyId || selectedHotel.source !== "Booking.com Demand API" || selectedHotel.sourceType !== "provider_api") {
    return baseResult(input, "SELECTED_HOTEL_MISSING");
  }
  if (!validRequest(input.request)) return baseResult(input, "REQUEST_CONTEXT_MISSING");

  const oldOptions = productOptions(selectedHotel.productOptions);
  if (!oldOptions) return baseResult(input, "MALFORMED_PROVIDER_RESPONSE");
  const previous = uniqueProduct(oldOptions, intendedId);
  if (previous.conflict) return baseResult(input, "MALFORMED_PROVIDER_RESPONSE");

  let refreshed;
  try {
    refreshed = await provider.getPropertyAvailability({
      ...input.request,
      exactPropertyRequest: null,
      providerPropertyId
    });
  } catch {
    return { ...baseResult(input, "PROVIDER_ERROR"), warning: "The selected product could not be revalidated." };
  }

  if (!refreshed || typeof refreshed !== "object" || !Array.isArray(refreshed.candidates)) {
    return { ...baseResult(input, "MALFORMED_PROVIDER_RESPONSE"), warning: "The provider returned an unsupported availability response." };
  }
  const searchedAt = validReadTimestamp(refreshed.searchedAt);
  if (!searchedAt) return { ...baseResult(input, "MALFORMED_PROVIDER_RESPONSE"), previousProduct: previous.option, previousProductPresent: Boolean(previous.option), warning: "The provider response did not include a valid availability-read timestamp." };
  if (refreshed.state === "NO_AVAILABLE_RATE") {
    return { ...baseResult(input, "DISAPPEARED"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), comparisonStatus: previous.option ? "COMPARED" : "NO_PRIOR_COMPARISON", warning: "The requested provider product is no longer available for this stay." };
  }
  if (refreshed.state !== "OK") {
    if (refreshed.state === "MALFORMED_PROVIDER_RESPONSE") return { ...baseResult(input, "MALFORMED_PROVIDER_RESPONSE"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), warning: "The provider returned an unsupported availability response." };
    return { ...baseResult(input, "PROVIDER_ERROR"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), warning: "The selected product could not be revalidated." };
  }

  if (refreshed.candidates.some((candidate) => !candidate || typeof candidate !== "object")) {
    return { ...baseResult(input, "MALFORMED_PROVIDER_RESPONSE"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), warning: "The provider returned an unsupported property collection." };
  }
  const propertyMatches = refreshed.candidates.filter((candidate) => candidate.providerPropertyId === providerPropertyId);
  if (propertyMatches.length !== 1) {
    return { ...baseResult(input, propertyMatches.length ? "MALFORMED_PROVIDER_RESPONSE" : "DISAPPEARED"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), comparisonStatus: previous.option ? "COMPARED" : "NO_PRIOR_COMPARISON", warning: propertyMatches.length ? "The provider returned conflicting availability for the selected property." : "The selected property is not present in the latest availability response." };
  }

  const refreshedOptions = productOptions(propertyMatches[0].productOptions);
  if (!refreshedOptions) return { ...baseResult(input, "MALFORMED_PROVIDER_RESPONSE"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), warning: "The provider returned an unsupported product collection." };
  const current = uniqueProduct(refreshedOptions, intendedId);
  if (current.conflict) {
    return { ...baseResult(input, "MALFORMED_PROVIDER_RESPONSE"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), warning: "The provider returned conflicting representations of the requested product." };
  }
  if (!current.option) {
    return { ...baseResult(input, "DISAPPEARED"), searchedAt, previousProduct: previous.option, previousProductPresent: Boolean(previous.option), comparisonStatus: previous.option ? "COMPARED" : "NO_PRIOR_COMPARISON", warning: "The requested provider product is not present in the latest availability response." };
  }

  return {
    ...baseResult(input, "CURRENT"),
    refreshedProduct: current.option,
    previousProduct: previous.option,
    searchedAt,
    factualChanges: factualChanges(previous.option, current.option),
    previousProductPresent: Boolean(previous.option),
    comparisonStatus: previous.option ? "COMPARED" : "NO_PRIOR_COMPARISON"
  };
}
