// Stage 6 checks — accommodationIntelligence stored-vs-derived verdict
// (2026-11-11).
//
// The assessment's H-2 open trace named two `coordinates: null`
// hardcodes in lib/roamly/accommodationIntelligence.ts. Traced to
// ground for Stage 6:
//  - marketHotelCandidates (:216) builds decision-layer candidates
//    FROM real market results, copying every sibling fact (price,
//    currency, title, URLs, searched_at) — but dropped the result's
//    own point. DIVERGENT, fixed: the candidate now carries the
//    point through the SAME extractor the timeline writers use
//    (marketResultCoordinates), so the decision layer and the stored
//    itinerary can never disagree about where the place is.
//  - searchReadyCandidate (:304) is a synthetic area-search offer
//    ("<room type> near <area>") — no real place exists, so null is
//    the only truthful value. SOUND, pinned here so it can never
//    silently gain an invented point.
// Runtime proof with synthetic fixtures only; no network.
import assert from "node:assert/strict";
import { buildAccommodationIntelligence } from "@/lib/roamly/accommodationIntelligence.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const payload = {
  destination: "Montreal",
  destinationCity: "Montreal",
  destinationCountry: "Canada",
  startDate: "2026-12-10",
  endDate: "2026-12-13",
  travelersCount: 2,
  travelers: { adults: 2, children: 0 },
  rooms: 1,
  budgetCurrency: "CAD",
  interests: ["food"],
  accommodationPreference: "",
  bedPreference: "",
  transportationPreference: ""
};

const BOOKING_POINT = { latitude: 45.5009, longitude: -73.568 };
const PACK_POINT = { latitude: 45.5046, longitude: -73.5561 };

function hotelResult(overrides) {
  return {
    id: "hotel-1",
    category: "hotel",
    title: "Fixture Hotel",
    provider: "Booking.com",
    source: "booking",
    destination: "Montreal",
    city: "Montreal",
    currency: "CAD",
    price_amount: 180,
    price_type: "live_partner",
    searched_at: "2026-11-11T00:00:00.000Z",
    normal_search_url: "https://example.test/search",
    booking_url: "https://example.test/book",
    affiliate_url: null,
    metadata: {},
    ...overrides
  };
}

/* ---- the Booking.com-shaped result: its own point is carried ---- */
const withPoint = buildAccommodationIntelligence({
  payload,
  marketResults: [
    hotelResult({ metadata: { providerPayload: { coordinates: { ...BOOKING_POINT } } } })
  ]
});
deepEq(
  withPoint.recommendation?.coordinates,
  BOOKING_POINT,
  "market hotel candidate carries the property's own providerPayload point"
);

/* ---- the pack-shaped result: its stamped pos is carried ---- */
const packPoint = buildAccommodationIntelligence({
  payload,
  marketResults: [
    hotelResult({ id: "pack:fixture-stay", metadata: { coordinates: { ...PACK_POINT } } })
  ]
});
deepEq(
  packPoint.recommendation?.coordinates,
  PACK_POINT,
  "pack-shaped candidate carries its stamped coordinates"
);

/* ---- a result with NO point stays honestly null ---- */
const noPoint = buildAccommodationIntelligence({
  payload,
  marketResults: [hotelResult({ metadata: { providerPayload: {} } })]
});
eq(noPoint.recommendation?.coordinates, null, "market result without a point yields a null candidate point");

/* ---- a malformed point (0,0 / strings) is refused, never carried ---- */
const zeroPoint = buildAccommodationIntelligence({
  payload,
  marketResults: [
    hotelResult({ metadata: { providerPayload: { coordinates: { latitude: 0, longitude: 0 } } } })
  ]
});
eq(zeroPoint.recommendation?.coordinates, null, "0,0 parse-failure point refused");

const stringPoint = buildAccommodationIntelligence({
  payload,
  marketResults: [
    hotelResult({ metadata: { providerPayload: { coordinates: { latitude: "45.5", longitude: "-73.5" } } } })
  ]
});
eq(stringPoint.recommendation?.coordinates, null, "string coordinates refused (finite numbers only)");

/* ---- the synthetic search-ready candidate: null is the truth ---- */
const searchReady = buildAccommodationIntelligence({ payload, marketResults: [] });
eq(searchReady.recommendation?.data_freshness, "search_ready", "empty pool falls back to the search-ready candidate");
eq(searchReady.recommendation?.coordinates, null, "search-ready area offer carries no invented point");

console.log(`Stage 6 accommodation-coordinates checks passed (${count} assertions).`);
