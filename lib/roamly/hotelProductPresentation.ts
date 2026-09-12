import type { HotelProductOption } from "./hotelInventory.ts";
import type { SelectedHotelProductDecisionResult } from "./selectedHotelProductDecision.ts";

export type HotelPresentationInventoryStatus = "CURRENT" | "STALE_REVALIDATION_REQUIRED" | "UNKNOWN" | "CONFIRMED_BOOKING";
export type HotelPresentationRecommendationStatus = "RECOMMENDED" | "NOT_RECOMMENDED" | "SUPPRESSED_CONFIRMED_BOOKING" | "UNRESOLVED";
export type HotelPresentationEligibility = "ELIGIBLE" | "INELIGIBLE" | "UNRESOLVED";
export type HotelPresentationPriceState = "KNOWN_PROVIDER_AMOUNT" | "UNKNOWN" | "NON_COMPARABLE_CURRENCY";
export type HotelPresentationCancellationState = "PROVEN_FLEXIBLE" | "PROVEN_NON_REFUNDABLE" | "PARTIAL" | "UNKNOWN";
export type HotelPresentationActionability = "INFORMATIONAL_ONLY" | "PROPERTY_HANDOFF_AVAILABLE";

export type HotelProductPresentationOption = {
  providerProductId: string | null;
  identity: "IDENTIFIED_INFORMATIONAL" | "UNIDENTIFIED_INFORMATIONAL";
  displayName: string;
  roomIdentity: "DESCRIPTION_ONLY";
  rateIdentity: "UNAVAILABLE";
  price: { state: HotelPresentationPriceState; amount: number | null; currency: string | null };
  charges: { state: "KNOWN" | "PARTIAL" | "UNKNOWN"; amount: number | null; taxInclusion: HotelProductOption["taxInclusionStatus"]; feeInclusion: HotelProductOption["feeInclusionStatus"] };
  cancellation: { state: HotelPresentationCancellationState; policy: string | null };
  paymentTerms: "UNKNOWN";
  mealPlan: "UNKNOWN";
  occupancy: "UNKNOWN";
  eligibility: HotelPresentationEligibility;
  unresolvedFacts: string[];
  recommendation: "RECOMMENDED" | "NOT_RECOMMENDED";
  actionability: HotelPresentationActionability;
  exactProductBooking: "UNVERIFIED";
};

export type HotelProductPresentation = {
  hotelCandidateId: string | null;
  providerPropertyId: string | null;
  inventoryStatus: HotelPresentationInventoryStatus;
  recommendationStatus: HotelPresentationRecommendationStatus;
  requiresRevalidation: boolean;
  representativeProviderProductId: string | null;
  recommendedProductId: string | null;
  products: HotelProductPresentationOption[];
  stateCodes: string[];
};

export type HotelProductPresentationInput = {
  selectedHotelDecision: SelectedHotelProductDecisionResult;
  comparisonCurrency?: string | null;
};

function currency(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cancellation(policy: string | null): HotelPresentationCancellationState {
  const value = (policy || "").toLowerCase();
  if (!value) return "UNKNOWN";
  if (value.includes("non-refundable")) return "PROVEN_NON_REFUNDABLE";
  if (value.includes("refundable")) return "PROVEN_FLEXIBLE";
  return "PARTIAL";
}

function inventoryStatus(result: SelectedHotelProductDecisionResult): HotelPresentationInventoryStatus {
  if (result.status === "CONFIRMED_BOOKING") return "CONFIRMED_BOOKING";
  if (result.status === "STALE_REQUIRES_REVALIDATION") return "STALE_REVALIDATION_REQUIRED";
  return result.inventoryFreshness === "fresh" ? "CURRENT" : "UNKNOWN";
}

function price(option: HotelProductOption, comparisonCurrency: string | null, comparisonCurrencyKnown: boolean) {
  const optionCurrency = currency(option.currency);
  if (!validPrice(option.totalStayPrice)) return { state: "UNKNOWN" as const, amount: null, currency: optionCurrency };
  if (!comparisonCurrencyKnown || (comparisonCurrency && optionCurrency && comparisonCurrency !== optionCurrency)) {
    return { state: "NON_COMPARABLE_CURRENCY" as const, amount: option.totalStayPrice, currency: optionCurrency };
  }
  return { state: "KNOWN_PROVIDER_AMOUNT" as const, amount: option.totalStayPrice, currency: optionCurrency };
}

function charges(option: HotelProductOption) {
  const inclusionKnown = option.taxInclusionStatus !== "unknown" && option.feeInclusionStatus !== "unknown";
  return {
    state: option.taxesFees == null ? "UNKNOWN" as const : inclusionKnown ? "KNOWN" as const : "PARTIAL" as const,
    amount: option.taxesFees,
    taxInclusion: option.taxInclusionStatus,
    feeInclusion: option.feeInclusionStatus
  };
}

export function buildHotelProductPresentation(input: HotelProductPresentationInput): HotelProductPresentation {
  const result = input.selectedHotelDecision;
  const decision = result.productDecision;
  const status = inventoryStatus(result);
  if (status === "CONFIRMED_BOOKING") {
    return {
      hotelCandidateId: result.selectedHotelCandidateId,
      providerPropertyId: result.providerPropertyId,
      inventoryStatus: status,
      recommendationStatus: "SUPPRESSED_CONFIRMED_BOOKING",
      requiresRevalidation: false,
      representativeProviderProductId: result.representativeProviderProductId,
      recommendedProductId: null,
      products: [],
      stateCodes: ["CONFIRMED_BOOKING_AUTHORITATIVE"]
    };
  }

  const evaluations = decision?.rankedProductOptions || [];
  const recommendedId = decision?.recommendedProductId || null;
  const productIds = evaluations.map((evaluation) => evaluation.option.providerProductId).filter((id): id is string => Boolean(id));
  if (new Set(productIds).size !== productIds.length) {
    return {
      hotelCandidateId: result.selectedHotelCandidateId,
      providerPropertyId: result.providerPropertyId,
      inventoryStatus: status,
      recommendationStatus: "UNRESOLVED",
      requiresRevalidation: result.requiresRevalidation,
      representativeProviderProductId: result.representativeProviderProductId,
      recommendedProductId: null,
      products: [],
      stateCodes: ["DUPLICATE_PRODUCT_ID", "PRODUCT_OPTIONS_UNTRUSTED"]
    };
  }
  const explicitCurrency = currency(input.comparisonCurrency);
  const optionCurrencies = [...new Set(evaluations.map((evaluation) => currency(evaluation.option.currency)).filter((value): value is string => Boolean(value)))];
  const comparisonCurrency = explicitCurrency || (optionCurrencies.length === 1 ? optionCurrencies[0] : null);
  const comparisonCurrencyKnown = Boolean(comparisonCurrency) && (Boolean(explicitCurrency) || optionCurrencies.length === 1);
  const products = evaluations.flatMap((evaluation) => {
    const id = evaluation.option.providerProductId;
    const option = evaluation.option;
    const unresolvedFacts = [...new Set([
      ...Object.entries(evaluation.requirementStates).filter(([, value]) => value === "UNKNOWN").map(([key]) => key),
      ...(price(option, comparisonCurrency, comparisonCurrencyKnown).state === "UNKNOWN" ? ["price"] : []),
      ...(price(option, comparisonCurrency, comparisonCurrencyKnown).state === "NON_COMPARABLE_CURRENCY" ? ["currency"] : []),
      ...(cancellation(option.cancellationPolicy) === "UNKNOWN" ? ["cancellation"] : [])
    ])].sort();
    return [{
      providerProductId: id,
      identity: id ? "IDENTIFIED_INFORMATIONAL" as const : "UNIDENTIFIED_INFORMATIONAL" as const,
      displayName: option.roomDescription || "Hotel option",
      roomIdentity: "DESCRIPTION_ONLY" as const,
      rateIdentity: "UNAVAILABLE" as const,
      price: price(option, comparisonCurrency, comparisonCurrencyKnown),
      charges: charges(option),
      cancellation: { state: cancellation(option.cancellationPolicy), policy: option.cancellationPolicy },
      paymentTerms: "UNKNOWN" as const,
      mealPlan: "UNKNOWN" as const,
      occupancy: "UNKNOWN" as const,
      eligibility: evaluation.eligibility === "SATISFIED" ? "ELIGIBLE" as const : evaluation.eligibility === "UNSATISFIED" ? "INELIGIBLE" as const : "UNRESOLVED" as const,
      unresolvedFacts,
      recommendation: id && id === recommendedId ? "RECOMMENDED" as const : "NOT_RECOMMENDED" as const,
      actionability: status === "CURRENT" && id ? "PROPERTY_HANDOFF_AVAILABLE" as const : "INFORMATIONAL_ONLY" as const,
      exactProductBooking: "UNVERIFIED" as const
    }];
  });
  const stateCodes = [...new Set([
    ...(status === "STALE_REVALIDATION_REQUIRED" ? ["AVAILABILITY_NEEDS_REFRESH"] : []),
    ...(products.some((item) => item.price.state === "UNKNOWN") ? ["PRICE_UNAVAILABLE"] : []),
    ...(products.some((item) => item.price.state === "NON_COMPARABLE_CURRENCY") ? ["CURRENCY_NOT_COMPARABLE"] : []),
    ...(products.some((item) => item.charges.state !== "KNOWN") ? ["ADDITIONAL_CHARGES_MAY_BE_UNKNOWN"] : []),
    ...(products.some((item) => item.cancellation.state === "UNKNOWN" || item.cancellation.state === "PARTIAL") ? ["CANCELLATION_TERMS_UNAVAILABLE_OR_PARTIAL"] : []),
    ...(products.some((item) => item.paymentTerms === "UNKNOWN") ? ["PAYMENT_TERMS_UNAVAILABLE"] : []),
    ...(products.some((item) => item.mealPlan === "UNKNOWN") ? ["MEAL_PLAN_UNAVAILABLE"] : []),
    ...(products.some((item) => item.exactProductBooking === "UNVERIFIED") ? ["EXACT_PRODUCT_BOOKING_UNVERIFIED"] : [])
  ])].sort();
  return {
    hotelCandidateId: result.selectedHotelCandidateId,
    providerPropertyId: result.providerPropertyId,
    inventoryStatus: status,
    recommendationStatus: recommendedId ? (status === "CURRENT" ? "RECOMMENDED" : "UNRESOLVED") : decision ? "UNRESOLVED" : "NOT_RECOMMENDED",
    requiresRevalidation: result.requiresRevalidation,
    representativeProviderProductId: result.representativeProviderProductId,
    recommendedProductId: recommendedId,
    products,
    stateCodes
  };
}
