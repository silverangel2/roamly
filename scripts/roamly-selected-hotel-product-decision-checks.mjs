import assert from "node:assert/strict";
import { resolveSelectedHotelProductDecision } from "../lib/roamly/selectedHotelProductDecision.ts";

const option = (id, price, extra = {}) => ({
  providerProductId: id, roomDescription: null, totalStayPrice: price, currency: "CAD", taxesFees: null,
  taxInclusionStatus: "unknown", feeInclusionStatus: "unknown", availabilityStatus: "available",
  cancellationPolicy: null, deepLink: null, ...extra
});
const market = (id, products, extra = {}) => ({
  id, category: "hotel", title: id, source: "booking_demand", currency: "CAD",
  start_date: "2026-08-05", end_date: "2026-08-08",
  expires_at: "2026-09-12T12:15:00.000Z", metadata: { retrieval_provider: "provider_api", providerPayload: {
    property_id: id === "booking:1001" ? "1001" : "2002", representative_product_id: products[0]?.providerProductId || null,
    product_options: products
  } }, ...extra
});
const discovery = (selectedHotelCandidateId, marketResults) => ({ groundedDecision: { selectedHotelCandidateId }, marketResults });

const productsA = [option("P1", 610, { cancellationPolicy: "non-refundable" }), option("P2", 640, { cancellationPolicy: "refundable/conditional" }), option("P3", 720)];
const productsB = [option("P7", 100), option("P8", 110)];
const freshInput = { now: new Date("2026-09-12T12:00:00.000Z"), hotelConstraints: {}, confirmedBookings: [] };

const exact = resolveSelectedHotelProductDecision({ ...freshInput, priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA), market("booking:2002", productsB)]) });
assert.equal(exact.status, "EVALUATED");
assert.equal(exact.selectedHotelCandidateId, "booking:1001");
assert.deepEqual(exact.productDecision?.rankedProductOptions.map((item) => item.option.providerProductId), ["P1", "P2", "P3"]);
assert.equal(exact.productDecision?.rankedProductOptions.some((item) => item.option.providerProductId === "P7"), false);

const noSelection = resolveSelectedHotelProductDecision({ ...freshInput, priceDiscovery: discovery(null, [market("booking:1001", productsA)]) });
assert.equal(noSelection.status, "NO_SELECTED_HOTEL");
assert.equal(noSelection.productDecision, null);

const missing = resolveSelectedHotelProductDecision({ ...freshInput, priceDiscovery: discovery("booking:9999", [market("booking:1001", productsA)]) });
assert.equal(missing.status, "SELECTED_HOTEL_NOT_FOUND");
assert.equal(missing.productDecision, null);

const representativeVsRecommendation = resolveSelectedHotelProductDecision({
  ...freshInput,
  hotelConstraints: { maximumNightlyPrice: { value: 220, priority: "hard" } },
  productRequirements: { refundableCancellation: { value: true, priority: "hard" } },
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)])
});
assert.equal(representativeVsRecommendation.representativeProviderProductId, "P1");
assert.equal(representativeVsRecommendation.productDecision?.recommendedProductId, "P2");

const nightlyLimit = resolveSelectedHotelProductDecision({
  ...freshInput,
  hotelConstraints: { maximumNightlyPrice: { value: 205, priority: "hard" } },
  priceDiscovery: discovery("booking:1001", [market("booking:1001", [option("P1", 610), option("P2", 675)])])
});
assert.equal(nightlyLimit.productDecision?.recommendedProductId, "P1");
assert.equal(nightlyLimit.productDecision?.unresolvedRequirements.includes("maximum_nightly_price"), false);

const breakfastUnknown = resolveSelectedHotelProductDecision({
  ...freshInput,
  productRequirements: { breakfast: { value: true, priority: "hard" } },
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)])
});
assert.equal(breakfastUnknown.productDecision?.recommendedProductId, null);
assert.equal(breakfastUnknown.productDecision?.unresolvedRequirements.includes("breakfast"), true);

const stale = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: discovery("booking:1001", [market("booking:1001", [option("P2", 640), option("P3", 720)], { expires_at: "2026-09-12T11:00:00.000Z" })])
});
assert.equal(stale.status, "STALE_REQUIRES_REVALIDATION");
assert.equal(stale.requiresRevalidation, true);
assert.equal(stale.productDecision?.recommendedProductId, "P2");

const refreshed = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: discovery("booking:1001", [market("booking:1001", [option("P2", 640), option("P4", 690)])])
});
assert.equal(refreshed.productDecision?.recommendedProductId, "P2");
assert.equal(refreshed.productDecision?.rankedProductOptions.some((item) => item.option.providerProductId === "P1"), false);

const exactMissing = resolveSelectedHotelProductDecision({
  ...freshInput,
  productRequirements: { exactProductRequest: { value: "missing", priority: "hard" } },
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)])
});
assert.equal(exactMissing.productDecision?.recommendedProductId, null);
assert.equal(exactMissing.productDecision?.unresolvedRequirements.includes("exact_product"), true);

const confirmed = resolveSelectedHotelProductDecision({
  ...freshInput,
  confirmedBookings: [{ booking_type: "hotel", booking_status: "confirmed" }],
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)])
});
assert.equal(confirmed.status, "CONFIRMED_BOOKING");
assert.equal(confirmed.productDecision, null);

const confirmedHotelB = resolveSelectedHotelProductDecision({
  ...freshInput,
  confirmedBookings: [{ booking_type: "hotel", title: "Hotel B", booking_status: "confirmed" }],
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA), market("booking:2002", productsB)])
});
assert.equal(confirmedHotelB.status, "CONFIRMED_BOOKING");
assert.equal(confirmedHotelB.selectedHotelCandidateId, "booking:1001");
assert.equal(confirmedHotelB.productDecision, null);

const propertyOnlyRequirement = resolveSelectedHotelProductDecision({
  ...freshInput,
  hotelConstraints: { parkingRequired: { value: true, priority: "hard" } },
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)])
});
assert.equal(propertyOnlyRequirement.productDecision?.unresolvedRequirements.includes("parking"), false);
assert.equal(propertyOnlyRequirement.productDecision?.recommendedProductId, "P1");

const invalidSource = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA, { source: "stay22" })])
});
assert.equal(invalidSource.status, "INVALID_SELECTED_INVENTORY");

const malformedProducts = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: discovery("booking:1001", [market("booking:1001", [], { metadata: { retrieval_provider: "provider_api", providerPayload: { property_id: "1001", product_options: "not-an-array" } } })])
});
assert.equal(malformedProducts.status, "NO_PRODUCT_OPTIONS");

const duplicateProducts = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: discovery("booking:1001", [market("booking:1001", [option("P1", 610), option("P1", 620)])])
});
assert.equal(duplicateProducts.status, "INVALID_SELECTED_INVENTORY");

const noStableProductIds = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: discovery("booking:1001", [market("booking:1001", [option(null, 610), option(null, 620)])])
});
assert.equal(noStableProductIds.status, "NO_PRODUCT_OPTIONS");
assert.equal(noStableProductIds.productDecision, null);

const conflictingCopies = resolveSelectedHotelProductDecision({
  ...freshInput,
  priceDiscovery: {
    groundedDecision: { selectedHotelCandidateId: "booking:1001" },
    selectedMarketPrices: [market("booking:1001", [option("P1", 610)])],
    marketResults: [market("booking:1001", [option("P2", 620)])]
  }
});
assert.equal(conflictingCopies.status, "INVALID_SELECTED_INVENTORY");

const before = JSON.stringify(discovery("booking:1001", [market("booking:1001", productsA)]));
resolveSelectedHotelProductDecision({ ...freshInput, priceDiscovery: JSON.parse(before) });
assert.equal(JSON.stringify(discovery("booking:1001", [market("booking:1001", productsA)])), before);

const repeatA = resolveSelectedHotelProductDecision({ ...freshInput, priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)]) });
const repeatB = resolveSelectedHotelProductDecision({ ...freshInput, priceDiscovery: discovery("booking:1001", [market("booking:1001", productsA)]) });
assert.deepEqual(repeatA.productDecision, repeatB.productDecision);

console.log("Selected hotel product decision checks passed.");
