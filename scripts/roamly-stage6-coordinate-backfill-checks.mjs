// Stage 6 checks — coordinate backfill derivation core (2026-11-11).
//
// The backfill (scripts/roamly-stage6-coordinate-backfill.mjs,
// prepared-not-applied) may fill a stored item's null point ONLY
// from the same place identity the generation writers use. This
// suite pins the pure core:
//  - S1: a candidate resolved from the trip's own stored discovery
//    pool through the real marketResultCoordinates extractor;
//  - S2: a "pack:<key>" candidate resolved from pack rows, with
//    cross-version key collisions treated as ambiguous (no fill);
//  - fills write the writers' exact shape + provenance stamps;
//  - an existing valid point is NEVER overwritten;
//  - underivable items are listed with reasons, never guessed;
//  - the transform is idempotent (a second pass fills nothing).
import assert from "node:assert/strict";
import { deriveCandidatePoints, fillItineraryCoordinates } from "./roamly-stage6-coordinate-backfill.mjs";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const HOTEL_POINT = { latitude: 45.5009, longitude: -73.568 };
const PACK_POINT = { latitude: 45.5046, longitude: -73.5561 };
const EXISTING_POINT = { latitude: 46.8, longitude: -71.2 };

const discoveryPools = [[
  {
    id: "hotel-1",
    category: "hotel",
    title: "Fixture Hotel",
    metadata: { providerPayload: { coordinates: { ...HOTEL_POINT } } }
  },
  {
    id: "no-point-1",
    category: "attraction",
    title: "Pointless Place",
    metadata: {}
  }
]];
const packRows = [
  { candidate_key: "fixture-museum", lat: PACK_POINT.latitude, lon: PACK_POINT.longitude },
  { candidate_key: "fixture-museum", lat: PACK_POINT.latitude, lon: PACK_POINT.longitude },
  { candidate_key: "colliding-key", lat: 45.1, lon: -73.1 },
  { candidate_key: "colliding-key", lat: 45.2, lon: -73.2 },
  { candidate_key: "no-pos-key", lat: null, lon: null }
];

const { points, ambiguousPackKeys } = deriveCandidatePoints({ discoveryPools, packRows });
deepEq(points.get("hotel-1"), HOTEL_POINT, "S1: discovery pool resolves the hotel candidate's own point");
eq(points.has("no-point-1"), false, "S1: a candidate with no point resolves nothing");
deepEq(points.get("pack:fixture-museum"), PACK_POINT, "S2: pack key resolves its row's point");
deepEq(ambiguousPackKeys, ["colliding-key"], "S2: a key with two distinct points is ambiguous");
eq(points.has("pack:colliding-key"), false, "S2: an ambiguous key resolves nothing");
eq(points.has("pack:no-pos-key"), false, "S2: a pack row without lat/lon resolves nothing");

function item(overrides) {
  return {
    title: "Fixture item",
    candidateId: null,
    coordinates: null,
    timing_status: "PLANNED",
    ...overrides
  };
}
const fullJson = {
  daily_itinerary: [
    {
      day_number: 1,
      live_timeline: [
        item({ title: "Fixture Hotel", candidateId: "hotel-1" }),
        item({ title: "Fixture Museum", candidateId: "pack:fixture-museum" }),
        item({ title: "Already pinned", candidateId: "hotel-1", coordinates: { ...EXISTING_POINT } }),
        item({ title: "Colliding pack place", candidateId: "pack:colliding-key" }),
        item({ title: "Pointless Place", candidateId: "no-point-1" }),
        item({ title: "Unbound suggestion", candidateId: null })
      ]
    }
  ]
};

const first = fillItineraryCoordinates(fullJson, points);
eq(first.fills.length, 2, "exactly the two provable items are filled");
const filledHotel = first.itinerary.daily_itinerary[0].live_timeline[0];
deepEq(filledHotel.coordinates, HOTEL_POINT, "the hotel item gains the candidate's own point");
eq(filledHotel.coordinateSource, "candidate", "fill carries the writers' provenance stamp (source)");
eq(filledHotel.coordinatePrecision, "place", "fill carries the writers' provenance stamp (precision)");
deepEq(
  first.itinerary.daily_itinerary[0].live_timeline[1].coordinates,
  PACK_POINT,
  "the pack item gains its pack row's point"
);
deepEq(
  first.itinerary.daily_itinerary[0].live_timeline[2].coordinates,
  EXISTING_POINT,
  "an existing valid point is never overwritten"
);
eq(first.itinerary.daily_itinerary[0].live_timeline[3].coordinates, null, "ambiguous pack key stays null");
eq(first.itinerary.daily_itinerary[0].live_timeline[4].coordinates, null, "unprovable candidate stays null");
eq(first.itinerary.daily_itinerary[0].live_timeline[5].coordinates, null, "unbound item stays null");
eq(first.underivable.length, 3, "the three unprovable items are listed as underivable");
eq(
  first.underivable.find((entry) => entry.title === "Unbound suggestion")?.reason,
  "no_candidate_id",
  "an item with no candidate identity is underivable by rule"
);
eq(fullJson.daily_itinerary[0].live_timeline[0].coordinates, null, "the input itinerary is not mutated");

const second = fillItineraryCoordinates(first.itinerary, points);
eq(second.fills.length, 0, "idempotent: a second pass fills nothing");

console.log(`Stage 6 coordinate-backfill checks passed (${count} assertions).`);
