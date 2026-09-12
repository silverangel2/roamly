import assert from "node:assert/strict";
import {
  createBookingDemandProvider,
  hotelInventoryInputFromPayload,
  normalizeBookingAccommodationResponse,
  resolveBookingPropertyMatch,
  normalizeBookingLocationResponse,
  revalidateBookingHotelCandidate
} from "../lib/roamly/hotelInventory.ts";
import { buildGroundedDecisionCore, normalizeMarketCandidate } from "../lib/roamly/candidateDecisionCore.ts";

const input = hotelInventoryInputFromPayload({
  destination: "Montreal",
  destinationCity: "Montreal",
  destinationLatitude: 45.5017,
  destinationLongitude: -73.5673,
  startDate: "2026-10-10",
  endDate: "2026-10-14",
  travelersCount: 2,
  travelers: { adults: 2, children: 1, childAges: [8] },
  rooms: 1,
  budgetCurrency: "CAD",
  constraints: { hotel: { exactPropertyRequest: { value: "Fairmont The Queen Elizabeth", priority: "hard" } } },
  travelStyle: "Balanced",
  interests: [],
  pace: "Balanced",
  accommodationPreference: "Mid-range",
  transportationPreference: "Mixed",
  specialNotes: "",
  budgetAmount: 1500,
  daysCount: 4
});

const fixture = {
  data: [
    {
      id: 1001,
      name: "Fairmont The Queen Elizabeth",
      address: "900 Rene-Levesque Blvd W, Montreal",
      coordinates: { latitude: 45.499, longitude: -73.566 },
      neighborhood: "Downtown Montreal",
      stars: 4,
      amenities: ["PARKING", "WIFI"],
      products: [{
        id: "rate-1",
        room: { name: "Deluxe Queen", amenities: ["Accessible room"] },
        price: { total: 610, display: 610, charges: [{ amount: 60, currency: "CAD", included: false, type: "TAX" }] },
        number_available_at_this_price: 2,
        policies: { cancellation: { type: "free_cancellation", free_cancellation_until: "2026-10-08" } },
        url: { web: "https://www.booking.com/hotel/fixture.html" }
      }, {
        id: "rate-2",
        room: { name: "Executive King" },
        price: { total: 675, display: 675, charges: [{ amount: 75, currency: "CAD", included: false, type: "TAX" }] },
        number_available_at_this_price: 1,
        policies: { cancellation: { type: "non_refundable" } }
      }, {
        id: "rate-3",
        room: { name: "Queen Suite" },
        price: { total: 720, display: 720, charges: [{ amount: 80, currency: "CAD", included: false, type: "TAX" }] },
        number_available_at_this_price: 1,
        policies: { cancellation: { type: "free_cancellation", free_cancellation_until: "2026-10-09" } }
      }]
    }
  ]
};

const candidates = normalizeBookingAccommodationResponse(fixture, input, "2026-09-11T12:00:00.000Z", "2026-09-11T12:15:00.000Z");
assert.equal(candidates?.length, 1);
assert.equal(candidates[0].providerPropertyId, "1001");
assert.equal(candidates[0].providerProductId, "rate-1");
assert.equal(candidates[0].representativeProviderProductId, "rate-1");
assert.deepEqual(candidates[0].productOptions.map((option) => option.providerProductId), ["rate-1", "rate-2", "rate-3"]);
assert.deepEqual(candidates[0].productOptions.map((option) => option.totalStayPrice), [610, 675, 720]);
assert.equal(candidates[0].productOptions[1].cancellationPolicy, "non-refundable");
assert.equal(candidates[0].productOptions[2].cancellationPolicy, "refundable/conditional");
assert.equal(candidates[0].productOptions[1].roomDescription, "Executive King");
assert.equal(candidates[0].productOptions[2].roomDescription, "Queen Suite");
assert.equal(candidates.length, 1);
assert.equal(Object.hasOwn(candidates[0].productOptions[0], "roomId"), false);
assert.equal(Object.hasOwn(candidates[0].productOptions[0], "rateId"), false);

const crossCurrency = normalizeBookingAccommodationResponse({ data: [{ id: 1002, name: "Currency Fixture Hotel", currency: { accommodation: "CAD", booker: "CAD" }, products: [
  { id: "usd-1", price: { total: 500, currency: "USD", charges: [] }, number_available_at_this_price: 1 },
  { id: "cad-1", price: { total: 700, currency: "CAD", charges: [] }, number_available_at_this_price: 1 }
] }] }, input, "2026-09-11T12:00:00.000Z", "2026-09-11T12:15:00.000Z");
assert.equal(crossCurrency?.[0].representativeProviderProductId, "cad-1");
assert.equal(crossCurrency?.[0].totalStayPrice, 700);
const unknownPrice = normalizeBookingAccommodationResponse({ data: [{ id: 1003, name: "Unknown Price Fixture", currency: { accommodation: "CAD" }, products: [{ id: "unknown-1", price: { charges: [] }, number_available_at_this_price: 1 }] }] }, input, "2026-09-11T12:00:00.000Z", "2026-09-11T12:15:00.000Z");
assert.equal(unknownPrice?.[0].totalStayPrice, null);
assert.equal(unknownPrice?.[0].pricePerNight, null);
const invalidPrice = normalizeBookingAccommodationResponse({ data: [{ id: 1004, name: "Invalid Price Fixture", currency: { accommodation: "CAD" }, products: [
  { id: "negative-1", price: { total: -10, currency: "CAD", charges: [] }, number_available_at_this_price: 1 },
  { id: "valid-1", price: { total: 700, currency: "CAD", charges: [] }, number_available_at_this_price: 1 }
] }] }, input, "2026-09-11T12:00:00.000Z", "2026-09-11T12:15:00.000Z");
assert.equal(invalidPrice?.[0].representativeProviderProductId, "valid-1");
assert.equal(invalidPrice?.[0].totalStayPrice, 700);
assert.equal(candidates[0].checkIn, "2026-10-10");
assert.equal(candidates[0].checkOut, "2026-10-14");
assert.deepEqual(candidates[0].occupancy, { travelers: 2, rooms: 1, childAges: [8] });
assert.equal(candidates[0].totalStayPrice, 610);
assert.equal(candidates[0].taxInclusionStatus, "excluded");
assert.equal(candidates[0].availabilityStatus, "available");
assert.equal(candidates[0].factualStatus, "verified");
assert.equal(candidates[0].deepLink, "https://www.booking.com/hotel/fixture.html");
assert.match(candidates[0].deepLink, /^https:\/\/www\.booking\.com\//);
assert.equal(JSON.stringify(candidates).includes("test-secret"), false);

const location = normalizeBookingLocationResponse({ data: [{ id: 123, type: "city", name: "Montreal", location: { coordinates: { latitude: 45.5, longitude: -73.5 } } }] }, "Montreal");
assert.equal(location.status, "EXACT");
assert.equal(location.providerLocationId, 123);
const exact = resolveBookingPropertyMatch("Fairmont The Queen Elizabeth", [{ id: "1001", name: "Fairmont The Queen Elizabeth", address: "Montreal" }]);
assert.equal(exact.status, "EXACT");
assert.equal(exact.providerPropertyId, "1001");
const ambiguous = resolveBookingPropertyMatch("Fairmont", [
  { id: "a", name: "Fairmont Downtown", address: "A" },
  { id: "b", name: "Fairmont Airport", address: "B" }
]);
assert.equal(ambiguous.status, "AMBIGUOUS");
assert.equal(ambiguous.providerPropertyId, null);
const missing = resolveBookingPropertyMatch("Unknown Hotel", []);
assert.equal(missing.status, "NOT_FOUND");

assert.equal(normalizeBookingAccommodationResponse({ bad: true }, input, "2026-09-11T12:00:00.000Z", "2026-09-11T12:15:00.000Z"), null);
const normalized = normalizeMarketCandidate({
  id: candidates[0].candidateId,
  category: "hotel",
  title: candidates[0].name,
  provider: "Booking.com Demand API",
  source: "booking_demand",
  currency: "CAD",
  price_type: "live_partner",
  price_amount: 610,
  booking_url: candidates[0].deepLink,
  searched_at: candidates[0].searchedAt,
  expires_at: candidates[0].expiresAt,
  metadata: { providerPayload: { property_id: "1001", product_id: "rate-1", product_options: candidates[0].productOptions, amenities: ["PARKING"], taxes_included: false, fees_included: true, availability_status: "available" } }
});
assert.equal(normalized?.factualStatus, "verified");
assert.equal(normalized?.providerPropertyId, "1001");
assert.equal(normalized?.providerProductId, "rate-1");
assert.equal(normalized?.totalStayPrice, 610);
assert.equal(normalized?.sourceType, "provider_api");
assert.equal(normalized?.productOptions, undefined);
const decision = buildGroundedDecisionCore({ payload: { ...input, constraints: input.constraints }, marketResults: [{
  id: candidates[0].candidateId, category: "hotel", title: candidates[0].name, provider: "Booking.com Demand API", source: "booking_demand", currency: "CAD", price_type: "live_partner", price_amount: 610, booking_url: candidates[0].deepLink, searched_at: candidates[0].searchedAt, expires_at: candidates[0].expiresAt,
  metadata: { providerPayload: { property_id: "1001", product_id: "rate-1", product_options: candidates[0].productOptions, availability_status: "available" } }
}] });
assert.equal(decision.candidates.length, 1);
assert.equal(decision.budgetLedger.lines.filter((line) => line.category === "hotel").length, 1);

const revalidationCandidate = { ...candidates[0], expiresAt: "2026-09-11T12:15:00.000Z" };
const revalidationInput = { ...input, providerLocationId: 123, bookerCountry: "ca" };
let revalidationCalls = 0;
const freshResult = await revalidateBookingHotelCandidate({
  getPropertyAvailability: async () => { revalidationCalls += 1; throw new Error("fresh candidate must not revalidate"); }
}, revalidationInput, { ...revalidationCandidate, expiresAt: "2026-09-11T12:30:00.000Z" }, new Date("2026-09-11T12:20:00.000Z"));
assert.equal(freshResult.status, "fresh");
assert.equal(revalidationCalls, 0);
const refreshedCandidate = { ...revalidationCandidate, totalStayPrice: 690, expiresAt: "2026-09-11T12:35:00.000Z", productOptions: [
  revalidationCandidate.productOptions[0], revalidationCandidate.productOptions[2], { ...revalidationCandidate.productOptions[0], providerProductId: "rate-4", totalStayPrice: 740, cancellationPolicy: "non-refundable" }
] };
const refreshedResult = await revalidateBookingHotelCandidate({
  getPropertyAvailability: async (request) => {
    revalidationCalls += 1;
    assert.equal(request.providerPropertyId, "1001");
    assert.equal(request.checkIn, "2026-10-10");
    assert.equal(request.checkOut, "2026-10-14");
    assert.equal(request.travelers, 2);
    assert.equal(request.rooms, 1);
    return { state: "OK", provider: "booking_demand", candidates: [refreshedCandidate], searchedAt: "2026-09-11T12:20:00.000Z", expiresAt: "2026-09-11T12:35:00.000Z" };
  }
}, revalidationInput, revalidationCandidate, new Date("2026-09-11T12:20:00.000Z"));
assert.equal(refreshedResult.status, "refreshed");
assert.equal(refreshedResult.candidate.providerPropertyId, "1001");
assert.equal(refreshedResult.candidate.totalStayPrice, 690);
const refreshedIds = refreshedResult.candidate.productOptions.map((option) => option.providerProductId);
assert.deepEqual(refreshedIds, ["rate-1", "rate-3", "rate-4"]);
assert.equal(refreshedIds.includes("rate-2"), false);
assert.equal(refreshedIds.includes("rate-4"), true);
assert.equal(revalidationCalls, 1);
const lowerResult = await revalidateBookingHotelCandidate({
  getPropertyAvailability: async (request) => {
    assert.equal(request.providerPropertyId, "1001");
    return { state: "OK", provider: "booking_demand", candidates: [{ ...refreshedCandidate, totalStayPrice: 570 }], searchedAt: "2026-09-11T12:20:00.000Z", expiresAt: "2026-09-11T12:35:00.000Z" };
  }
}, revalidationInput, revalidationCandidate, new Date("2026-09-11T12:20:00.000Z"));
assert.equal(lowerResult.status, "refreshed");
assert.equal(lowerResult.candidate.totalStayPrice, 570);
const unavailableResult = await revalidateBookingHotelCandidate({
  getPropertyAvailability: async () => ({ state: "NO_AVAILABLE_RATE", provider: "booking_demand", candidates: [], searchedAt: "2026-09-11T12:20:00.000Z", expiresAt: "2026-09-11T12:35:00.000Z" })
}, revalidationInput, revalidationCandidate, new Date("2026-09-11T12:20:00.000Z"));
assert.equal(unavailableResult.status, "unavailable");
const failedResult = await revalidateBookingHotelCandidate({
  getPropertyAvailability: async () => ({ state: "TIMEOUT", provider: "booking_demand", candidates: [], searchedAt: "2026-09-11T12:20:00.000Z", expiresAt: "2026-09-11T12:35:00.000Z" })
}, revalidationInput, revalidationCandidate, new Date("2026-09-11T12:20:00.000Z"));
assert.equal(failedResult.status, "unknown");

const oldToken = process.env.BOOKING_DEMAND_API_TOKEN;
const oldAffiliate = process.env.BOOKING_DEMAND_AFFILIATE_ID;
const oldProvider = process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER;
const oldCountry = process.env.BOOKING_DEMAND_BOOKER_COUNTRY;
const bookingInput = { ...input, providerLocationId: 123, bookerCountry: "ca" };
delete process.env.BOOKING_DEMAND_API_TOKEN;
delete process.env.BOOKING_DEMAND_AFFILIATE_ID;
process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER = "booking";
process.env.BOOKING_DEMAND_BOOKER_COUNTRY = "ca";
let calls = 0;
const disabled = await createBookingDemandProvider(async () => { calls += 1; throw new Error("provider called"); }).searchHotels({ ...input, exactPropertyRequest: null });
assert.equal(disabled.state, "PROVIDER_NOT_CONFIGURED");
assert.equal(calls, 0);

process.env.BOOKING_DEMAND_API_TOKEN = "test-token";
process.env.BOOKING_DEMAND_AFFILIATE_ID = "test-affiliate";
let requestBodies = [];
const fixtureProvider = createBookingDemandProvider(async (_url, init) => {
  requestBodies.push(JSON.parse(init.body));
  return { status: 200, ok: true, json: async () => ({ data: [{ id: 1001, name: "Fairmont The Queen Elizabeth", currency: { accommodation: "CAD", booker: "CAD" }, deep_link_url: "https://www.booking.com/hotel/fixture.html", products: [{ id: "rate-1", price: { total: 610, display: 610, charges: [] }, number_available_at_this_price: 1 }] }] }) };
});
const live = await fixtureProvider.searchHotels({ ...bookingInput, exactPropertyRequest: null, providerLocationType: "city" });
assert.equal(live.state, "OK");
assert.equal(live.candidates[0].totalStayPrice, 610);
assert.equal(requestBodies[0].city, 123);
assert.equal(requestBodies[0].booker.platform, "desktop");
assert.deepEqual(requestBodies[0].guests.children, [8]);
assert.deepEqual(requestBodies[0].extras, ["products", "extra_charges"]);
let enrichmentCalls = 0;
const enrichedProvider = createBookingDemandProvider(async (url, init) => {
  enrichmentCalls += 1;
  if (url.endsWith("/accommodations/details")) {
    assert.deepEqual(JSON.parse(init.body).accommodations, [1001]);
    return { status: 200, ok: true, json: async () => ({ data: [{ id: 1001, name: { "en-gb": "Fairmont The Queen Elizabeth" }, location: { address: { "en-gb": "Montreal" }, coordinates: { latitude: 45.499, longitude: -73.566 } }, rating: { stars: 4 }, amenities: ["PARKING"] }] }) };
  }
  return { status: 200, ok: true, json: async () => ({ data: [{ id: 1001, currency: { accommodation: "CAD", booker: "CAD" }, products: [{ id: "rate-1", price: { total: 610, charges: [] }, number_available_at_this_price: 1 }] }] }) };
});
const enriched = await enrichedProvider.searchHotels({ ...bookingInput, exactPropertyRequest: null, providerLocationType: "city" });
assert.equal(enrichmentCalls, 2);
assert.equal(enriched.candidates[0].name, "Fairmont The Queen Elizabeth");
assert.equal(enriched.candidates[0].address, "Montreal");
assert.equal(enriched.candidates[0].totalStayPrice, 610);
const rateLimited = await createBookingDemandProvider(async () => ({ status: 429, ok: false, json: async () => ({}) })).searchHotels({ ...bookingInput, exactPropertyRequest: null });
assert.equal(rateLimited.state, "RATE_LIMITED");
const timedOut = await createBookingDemandProvider(async () => { throw new DOMException("timeout", "AbortError"); }).searchHotels({ ...bookingInput, exactPropertyRequest: null });
assert.equal(timedOut.state, "TIMEOUT");
if (oldToken === undefined) delete process.env.BOOKING_DEMAND_API_TOKEN; else process.env.BOOKING_DEMAND_API_TOKEN = oldToken;
if (oldAffiliate === undefined) delete process.env.BOOKING_DEMAND_AFFILIATE_ID; else process.env.BOOKING_DEMAND_AFFILIATE_ID = oldAffiliate;
if (oldProvider === undefined) delete process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER; else process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER = oldProvider;
if (oldCountry === undefined) delete process.env.BOOKING_DEMAND_BOOKER_COUNTRY; else process.env.BOOKING_DEMAND_BOOKER_COUNTRY = oldCountry;

console.log("Roamly hotel inventory checks passed.");
