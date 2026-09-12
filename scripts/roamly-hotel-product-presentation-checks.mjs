import assert from "node:assert/strict";
import { buildHotelProductPresentation } from "../lib/roamly/hotelProductPresentation.ts";

const option = (id, price, extra = {}) => ({ providerProductId: id, roomDescription: null, totalStayPrice: price, currency: "CAD", taxesFees: null, taxInclusionStatus: "unknown", feeInclusionStatus: "unknown", availabilityStatus: "available", cancellationPolicy: null, deepLink: "https://evil.example/product", ...extra });
const decision = (overrides = {}) => ({
  status: "EVALUATED", selectedHotelCandidateId: "booking:1001", providerPropertyId: "1001", inventoryFreshness: "fresh", requiresRevalidation: false, representativeProviderProductId: "P1",
  productDecision: { propertyCandidateId: "booking:1001", providerPropertyId: "1001", eligibleProductOptions: [], rankedProductOptions: [
    { option: option("P1", 610, { roomDescription: "Queen room", cancellationPolicy: "non-refundable" }), eligibility: "SATISFIED", requirementStates: {}, rationaleCodes: [], comparableTotal: 610 },
    { option: option("P2", 640, { cancellationPolicy: "refundable/conditional" }), eligibility: "SATISFIED", requirementStates: {}, rationaleCodes: [], comparableTotal: 640 }
  ], recommendedProductId: "P2", rationaleCodes: [], unresolvedRequirements: [] }, ...overrides
});

const presentation = buildHotelProductPresentation({ selectedHotelDecision: decision(), comparisonCurrency: "CAD" });
assert.equal(presentation.products[0].displayName, "Queen room");
assert.equal(presentation.products[0].roomIdentity, "DESCRIPTION_ONLY");
assert.equal(presentation.products[0].rateIdentity, "UNAVAILABLE");
assert.deepEqual(presentation.products.map((item) => item.price.amount), [610, 640]);
assert.equal(presentation.products[0].price.state, "KNOWN_PROVIDER_AMOUNT");
assert.equal(presentation.products[0].cancellation.state, "PROVEN_NON_REFUNDABLE");
assert.equal(presentation.products[1].cancellation.state, "PROVEN_FLEXIBLE");
assert.equal(presentation.products[0].recommendation, "NOT_RECOMMENDED");
assert.equal(presentation.products[1].recommendation, "RECOMMENDED");
assert.equal(presentation.representativeProviderProductId, "P1");
assert.equal(presentation.recommendedProductId, "P2");
assert.equal(presentation.products[0].actionability, "PROPERTY_HANDOFF_AVAILABLE");
assert.equal(presentation.products[0].exactProductBooking, "UNVERIFIED");
assert.equal(presentation.products[0].paymentTerms, "UNKNOWN");
assert.equal(presentation.products[0].mealPlan, "UNKNOWN");
assert.equal(presentation.stateCodes.includes("EXACT_PRODUCT_BOOKING_UNVERIFIED"), true);

const missingName = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option("P1", 610) }] } }), comparisonCurrency: "CAD" });
assert.equal(missingName.products[0].displayName, "Hotel option");
const unknownPrice = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option("P1", null) }], recommendedProductId: null } }), comparisonCurrency: "CAD" });
assert.equal(unknownPrice.products[0].price.amount, null);
assert.equal(unknownPrice.stateCodes.includes("PRICE_UNAVAILABLE"), true);
const currencies = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option("P1", 500, { currency: "USD" }) }] } }), comparisonCurrency: "CAD" });
assert.equal(currencies.products[0].price.state, "NON_COMPARABLE_CURRENCY");
const ambiguousCurrencies = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option("P1", 500, { currency: "USD" }) }, { ...decision().productDecision.rankedProductOptions[1], option: option("P2", 640, { currency: "CAD" }) }] } }) });
assert.equal(ambiguousCurrencies.products[0].price.state, "NON_COMPARABLE_CURRENCY");
const unknownCancellation = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option("P1", 610) }] } }), comparisonCurrency: "CAD" });
assert.notEqual(unknownCancellation.products[0].cancellation.state, "PROVEN_FLEXIBLE");
const stale = buildHotelProductPresentation({ selectedHotelDecision: decision({ status: "STALE_REQUIRES_REVALIDATION", inventoryFreshness: "stale", requiresRevalidation: true }) });
assert.equal(stale.inventoryStatus, "STALE_REVALIDATION_REQUIRED");
assert.equal(stale.requiresRevalidation, true);
assert.equal(stale.products[0].actionability, "INFORMATIONAL_ONLY");
const confirmed = buildHotelProductPresentation({ selectedHotelDecision: decision({ status: "CONFIRMED_BOOKING", productDecision: null }) });
assert.equal(confirmed.recommendationStatus, "SUPPRESSED_CONFIRMED_BOOKING");
assert.equal(confirmed.products.length, 0);
const invalid = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option(null, 610) }], recommendedProductId: null } }) });
assert.equal(invalid.products.length, 1);
assert.equal(invalid.products[0].identity, "UNIDENTIFIED_INFORMATIONAL");
assert.equal(invalid.products[0].actionability, "INFORMATIONAL_ONLY");
const duplicate = buildHotelProductPresentation({ selectedHotelDecision: decision({ productDecision: { ...decision().productDecision, rankedProductOptions: [{ ...decision().productDecision.rankedProductOptions[0], option: option("P1", 610) }, { ...decision().productDecision.rankedProductOptions[0], option: option("P1", 620) }] } }) });
assert.equal(duplicate.products.length, 0);
assert.equal(duplicate.stateCodes.includes("DUPLICATE_PRODUCT_ID"), true);
const before = JSON.stringify(decision());
const first = buildHotelProductPresentation({ selectedHotelDecision: decision(), comparisonCurrency: "CAD" });
const second = buildHotelProductPresentation({ selectedHotelDecision: decision(), comparisonCurrency: "CAD" });
assert.deepEqual(first, second);
assert.equal(JSON.stringify(decision()), before);
assert.equal(presentation.products.some((item) => item.providerProductId === "P1" && item.deepLink), false);
console.log("Hotel product presentation checks passed.");
