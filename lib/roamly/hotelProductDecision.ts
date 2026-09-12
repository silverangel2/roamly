import type { HotelConstraints, TravelConstraint } from "@/lib/trip-planner";
import type { HotelCandidate, HotelProductOption } from "@/lib/roamly/hotelInventory";

export type ProductFactState = "SATISFIED" | "UNSATISFIED" | "UNKNOWN";

export type HotelProductRequirements = {
  exactProductRequest?: TravelConstraint<string>;
  refundableCancellation?: TravelConstraint<boolean>;
  freeCancellation?: TravelConstraint<boolean>;
  breakfast?: TravelConstraint<boolean>;
  paymentTerms?: TravelConstraint<boolean>;
};

export type HotelProductDecisionInput = {
  selectedProperty: Pick<HotelCandidate, "candidateId" | "providerPropertyId" | "currency" | "productOptions">;
  travelerRequirements?: {
    hotel?: HotelConstraints;
    product?: HotelProductRequirements;
  };
  budgetContext?: {
    comparisonCurrency?: string | null;
  };
  nights?: number | null;
  confirmedHotelBooking?: boolean;
};

export type HotelProductEvaluation = {
  option: HotelProductOption;
  eligibility: ProductFactState;
  requirementStates: Record<string, ProductFactState>;
  rationaleCodes: string[];
  comparableTotal: number | null;
};

export type HotelProductDecision = {
  propertyCandidateId: string;
  providerPropertyId: string | null;
  eligibleProductOptions: HotelProductOption[];
  rankedProductOptions: HotelProductEvaluation[];
  recommendedProductId: string | null;
  rationaleCodes: string[];
  unresolvedRequirements: string[];
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizedCurrency(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function nightsValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function stateForCancellation(policy: string | null, required: "refundable" | "free"): ProductFactState {
  const value = (policy || "").trim().toLowerCase();
  if (!value) return "UNKNOWN";
  if (value.includes("non-refundable")) return "UNSATISFIED";
  if (required === "free") return "UNKNOWN";
  return value.includes("refundable") ? "SATISFIED" : "UNKNOWN";
}

function hardRequirement(value: TravelConstraint<boolean> | undefined) {
  return value?.priority === "hard" && value.value === true;
}

function comparisonCurrency(input: HotelProductDecisionInput, options: HotelProductOption[]) {
  const explicit = normalizedCurrency(input.budgetContext?.comparisonCurrency);
  if (explicit) return explicit;
  const propertyCurrency = normalizedCurrency(input.selectedProperty.currency);
  if (propertyCurrency) return propertyCurrency;
  const currencies = [...new Set(options.map((option) => normalizedCurrency(option.currency)).filter(Boolean))];
  return currencies.length === 1 ? currencies[0] : "";
}

function comparableTotal(option: HotelProductOption, currency: string, nights: number | null) {
  if (!currency || normalizedCurrency(option.currency) !== currency || !finiteNonNegative(option.totalStayPrice)) return null;
  return nights ? option.totalStayPrice / nights : option.totalStayPrice;
}

function requirementState(
  option: HotelProductOption,
  key: string,
  required: boolean,
  evaluate: () => ProductFactState,
  unresolved: string[]
) {
  if (!required) return "SATISFIED" as const;
  const state = evaluate();
  if (state === "UNKNOWN") unresolved.push(key);
  return state;
}

export function evaluateHotelProductOptions(input: HotelProductDecisionInput): HotelProductDecision {
  const options = Array.isArray(input.selectedProperty.productOptions) ? input.selectedProperty.productOptions : [];
  const hotel = input.travelerRequirements?.hotel || {};
  const product = input.travelerRequirements?.product || {};
  const currency = comparisonCurrency(input, options);
  const nights = nightsValue(input.nights);
  const unresolvedRequirements = new Set<string>();
  const evaluations = options.map((option): HotelProductEvaluation => {
    const requirementStates: Record<string, ProductFactState> = {};
    const rationaleCodes: string[] = [];
    const price = comparableTotal(option, currency, nights);
    const priceCeiling = hotel.maximumNightlyPrice;

    requirementStates.product_identity = option.providerProductId ? "SATISFIED" : "UNKNOWN";
    if (!option.providerProductId) {
      rationaleCodes.push("PRODUCT_ID_UNKNOWN");
      unresolvedRequirements.add("product_identity");
    }

    if (product.exactProductRequest?.priority === "hard") {
      requirementStates.exact_product = option.providerProductId === product.exactProductRequest.value ? "SATISFIED" : "UNKNOWN";
      if (requirementStates.exact_product === "UNKNOWN") {
        rationaleCodes.push("EXACT_PRODUCT_UNVERIFIED");
        unresolvedRequirements.add("exact_product");
      }
    }

    requirementStates.availability = option.availabilityStatus === "available" ? "SATISFIED" : "UNKNOWN";
    if (requirementStates.availability === "UNKNOWN") {
      rationaleCodes.push("AVAILABILITY_UNKNOWN");
      unresolvedRequirements.add("availability");
    }

    if (priceCeiling?.priority === "hard") {
      requirementStates.maximum_nightly_price = price == null || !nights || !finiteNonNegative(priceCeiling.value)
        ? "UNKNOWN"
        : price <= priceCeiling.value ? "SATISFIED" : "UNSATISFIED";
      if (requirementStates.maximum_nightly_price === "UNKNOWN") {
        rationaleCodes.push(currency ? "PRICE_UNKNOWN" : "CURRENCY_NOT_COMPARABLE");
        unresolvedRequirements.add("maximum_nightly_price");
      } else if (requirementStates.maximum_nightly_price === "UNSATISFIED") {
        rationaleCodes.push("EXCEEDS_MAXIMUM_NIGHTLY_PRICE");
      } else {
        rationaleCodes.push("MEETS_PRICE_LIMIT");
      }
    }

    requirementStates.refundable_cancellation = requirementState(
      option,
      "refundable_cancellation",
      hardRequirement(product.refundableCancellation),
      () => stateForCancellation(option.cancellationPolicy, "refundable"),
      [...unresolvedRequirements]
    );
    if (hardRequirement(product.refundableCancellation)) {
      if (requirementStates.refundable_cancellation === "SATISFIED") rationaleCodes.push("REFUNDABILITY_PROVEN");
      if (requirementStates.refundable_cancellation === "UNSATISFIED") rationaleCodes.push("NON_REFUNDABLE");
      if (requirementStates.refundable_cancellation === "UNKNOWN") unresolvedRequirements.add("refundable_cancellation");
    }

    requirementStates.free_cancellation = requirementState(
      option,
      "free_cancellation",
      hardRequirement(product.freeCancellation),
      () => stateForCancellation(option.cancellationPolicy, "free"),
      [...unresolvedRequirements]
    );
    if (hardRequirement(product.freeCancellation) && requirementStates.free_cancellation === "UNKNOWN") {
      rationaleCodes.push("CANCELLATION_UNKNOWN");
      unresolvedRequirements.add("free_cancellation");
    }

    requirementStates.breakfast = hardRequirement(product.breakfast) ? "UNKNOWN" : "SATISFIED";
    if (hardRequirement(product.breakfast)) {
      rationaleCodes.push("MEAL_REQUIREMENT_UNVERIFIED");
      unresolvedRequirements.add("breakfast");
    }
    requirementStates.payment_terms = hardRequirement(product.paymentTerms) ? "UNKNOWN" : "SATISFIED";
    if (hardRequirement(product.paymentTerms)) {
      rationaleCodes.push("PAYMENT_TERMS_UNKNOWN");
      unresolvedRequirements.add("payment_terms");
    }

    if (price == null) rationaleCodes.push(currency ? "PRICE_UNKNOWN" : "CURRENCY_NOT_COMPARABLE");
    else rationaleCodes.push("KNOWN_COMPARABLE_TOTAL");
    const states = Object.values(requirementStates);
    const eligibility: ProductFactState = states.includes("UNSATISFIED") ? "UNSATISFIED" : states.includes("UNKNOWN") ? "UNKNOWN" : "SATISFIED";
    return { option, eligibility, requirementStates, rationaleCodes: [...new Set(rationaleCodes)], comparableTotal: price };
  });

  const eligible = input.confirmedHotelBooking ? [] : evaluations.filter((evaluation) => evaluation.eligibility === "SATISFIED");
  const ranked = [...evaluations].sort((a, b) => {
    const eligibilityRank = (value: ProductFactState) => value === "SATISFIED" ? 0 : value === "UNKNOWN" ? 1 : 2;
    return eligibilityRank(a.eligibility) - eligibilityRank(b.eligibility) ||
      (a.comparableTotal == null ? 1 : b.comparableTotal == null ? -1 : a.comparableTotal - b.comparableTotal) ||
      (a.option.providerProductId || "").localeCompare(b.option.providerProductId || "");
  });
  const recommended = input.confirmedHotelBooking
    ? null
    : ranked.find((evaluation) => evaluation.eligibility === "SATISFIED" && evaluation.comparableTotal != null) || null;
  const rationaleCodes = input.confirmedHotelBooking
    ? ["CONFIRMED_BOOKING_AUTHORITATIVE"]
    : recommended?.comparableTotal != null ? ["LOWEST_COMPARABLE_TOTAL"] : recommended ? ["NO_COMPARABLE_PRICE"] : ["NO_FACTUALLY_ELIGIBLE_PRODUCT"];
  return {
    propertyCandidateId: input.selectedProperty.candidateId,
    providerPropertyId: input.selectedProperty.providerPropertyId || null,
    eligibleProductOptions: eligible.map((evaluation) => evaluation.option),
    rankedProductOptions: ranked,
    recommendedProductId: recommended?.option.providerProductId || null,
    rationaleCodes,
    unresolvedRequirements: [...unresolvedRequirements].sort()
  };
}
