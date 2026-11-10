// Coordinate-carry checks (2026-11-09, map-pins fix).
//
// The owner's Montreal trip said "No mappable locations for this
// day" while its list showed real places: the timeline binding
// writers hardcoded `coordinates: null` even when the bound
// candidate carried its own point — Booking.com properties in
// metadata.providerPayload.coordinates, destination-pack candidates
// in their pos (dropped by packFallbackMarketResults), public-event
// venues in metadata.public_event. The fix carries the CANDIDATE'S
// OWN point onto the stored item at write time, validated
// (finite, in range, never the 0,0 parse-failure point), stamped
// coordinateSource "candidate" / coordinatePrecision "place".
// Truth law pinned here: a candidate with no point — or a malformed
// one — still writes null (the honest no-pin state), and a model's
// invented coordinates NEVER survive a bind.
import assert from "node:assert/strict";
import {
  marketResultCoordinates,
  packFallbackMarketResults,
  validCoordinatePair
} from "@/lib/roamly/timelineGrounding.ts";
import { enforceGroundedTimelineCandidates } from "@/lib/roamly/stagedItineraryGeneration.ts";
import { applyRoamlyItineraryIntelligence } from "@/lib/roamly/itineraryIntelligence.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

/* ---- validCoordinatePair: ranges and malformed values ---- */
deepEq(validCoordinatePair(45.5046, -73.5561), { latitude: 45.5046, longitude: -73.5561 }, "ordinary pair passes");
deepEq(validCoordinatePair(90, 180), { latitude: 90, longitude: 180 }, "boundary pair passes");
deepEq(validCoordinatePair(-90, -180), { latitude: -90, longitude: -180 }, "negative boundary pair passes");
eq(validCoordinatePair(90.0001, 0), null, "latitude out of range refused");
eq(validCoordinatePair(0, -180.0001), null, "longitude out of range refused");
eq(validCoordinatePair(0, 0), null, "0,0 parse-failure point refused");
eq(validCoordinatePair(Number.NaN, -73.5), null, "NaN refused");
eq(validCoordinatePair("45.5", -73.5), null, "string latitude refused");
eq(validCoordinatePair(45.5, null), null, "missing longitude refused");
eq(validCoordinatePair(undefined, undefined), null, "missing pair refused");

/* ---- marketResultCoordinates: where each source keeps its point ---- */
const BOOKING_POINT = { latitude: 45.5009, longitude: -73.568 };
const bookingShaped = {
  metadata: { providerPayload: { property_id: "123", coordinates: { ...BOOKING_POINT } } }
};
deepEq(marketResultCoordinates(bookingShaped), BOOKING_POINT, "Booking providerPayload coordinates read exactly");

const PACK_POINT = { latitude: 41.8994, longitude: 12.4768 };
deepEq(
  marketResultCoordinates({ metadata: { coordinates: { ...PACK_POINT } } }),
  PACK_POINT,
  "pack-stamped metadata coordinates read exactly"
);
deepEq(
  marketResultCoordinates({ metadata: { public_event: { latitude: 45.5046, longitude: -73.5561 } } }),
  { latitude: 45.5046, longitude: -73.5561 },
  "public-event venue point read exactly"
);
deepEq(
  marketResultCoordinates({ metadata: { providerPayload: { latitude: 45.5046, longitude: -73.5561 } } }),
  { latitude: 45.5046, longitude: -73.5561 },
  "raw provider payload lat/lng read exactly"
);
eq(marketResultCoordinates({ metadata: {} }), null, "no point anywhere → null");
eq(marketResultCoordinates({ metadata: { providerPayload: { coordinates: null } } }), null, "null Booking point → null");
eq(
  marketResultCoordinates({ metadata: { providerPayload: { coordinates: { latitude: 123, longitude: -73.5 } } } }),
  null,
  "out-of-range Booking point → null, never a bad pin"
);
eq(
  marketResultCoordinates({ metadata: { providerPayload: { coordinates: { latitude: "45.5", longitude: "-73.5" } } } }),
  null,
  "string coordinates → null"
);

/* ---- packFallbackMarketResults: the pack candidate's pos rides along ---- */
const pack = {
  generatedAt: "2026-11-01T00:00:00.000Z",
  stays: [{ key: "stay-1", name: "Auberge du Vieux-Port", pos: { lat: 45.5088, lon: -73.5519 } }],
  sights: [
    { key: "colosseum-like", name: "Notre-Dame Basilica of Montreal", pos: { lat: 45.5046, lon: -73.5561 } },
    { key: "no-pos", name: "Mount Royal Park" },
    { key: "bad-pos", name: "Broken Point Lookout", pos: { lat: 145.5, lon: -73.5 } }
  ],
  foods: [],
  transport: []
};
const packResults = packFallbackMarketResults(pack, { destination: "Montreal", startDate: "2026-11-12" });
const basilica = packResults.find((r) => r.title === "Notre-Dame Basilica of Montreal");
deepEq(basilica.metadata.coordinates, { latitude: 45.5046, longitude: -73.5561 }, "pack pos stamped into metadata as the record pair");
deepEq(marketResultCoordinates(basilica), { latitude: 45.5046, longitude: -73.5561 }, "stamped pack point readable by the extractor");
const stay = packResults.find((r) => r.title === "Auberge du Vieux-Port");
deepEq(marketResultCoordinates(stay), { latitude: 45.5088, longitude: -73.5519 }, "pack stay point carried too");
const noPos = packResults.find((r) => r.title === "Mount Royal Park");
eq("coordinates" in noPos.metadata, false, "pos-less pack record gets no coordinate stamp");
eq(marketResultCoordinates(noPos), null, "pos-less pack record → null point");
const badPos = packResults.find((r) => r.title === "Broken Point Lookout");
eq("coordinates" in badPos.metadata, false, "malformed pack pos gets no coordinate stamp");

/* ---- staged writer: enforceGroundedTimelineCandidates ---- */
const marketResult = (overrides = {}) => ({
  id: "cand-1",
  category: "attraction",
  title: "Notre-Dame Basilica of Montreal",
  provider: "Klook",
  source: "klook",
  city: "Montreal",
  currency: "CAD",
  price_type: "live_partner",
  confidence: "high",
  searched_at: "2026-11-01T12:00:00.000Z",
  expires_at: "2026-11-20T12:00:00.000Z",
  metadata: {},
  ...overrides
});
const payloadFor = (marketResults) => ({
  destination: "Montreal, Canada",
  destinationCity: "Montreal",
  startDate: "2026-11-12",
  endDate: "2026-11-14",
  daysCount: 3,
  travelersCount: 1,
  budgetCurrency: "CAD",
  priceDiscovery: { marketResults }
});
const seedItem = (overrides = {}) => ({
  item_type: "activity",
  title: "Model title",
  description: "Model description",
  location_name: "Montreal",
  map_query: "Montreal",
  time_label: "10:00",
  startTime: "10:00",
  endTime: "11:00",
  estimated_cost: null,
  ...overrides
});

// Booking-shaped hotel candidate: the property's own point lands on the stored item.
const hotelBound = enforceGroundedTimelineCandidates(
  { day_number: 1, live_timeline: [seedItem({ item_type: "hotel", candidateId: "hotel-1", title: "Check in" })] },
  payloadFor([
    marketResult({
      id: "hotel-1",
      category: "hotel",
      title: "Hotel Bonaventure Montreal",
      provider: "Booking.com Demand API",
      source: "booking_demand",
      metadata: { providerPayload: { property_id: "456", coordinates: { ...BOOKING_POINT } } }
    })
  ])
).live_timeline[0];
eq(hotelBound.title, "Hotel Bonaventure Montreal", "hotel candidate binds");
deepEq(hotelBound.coordinates, BOOKING_POINT, "stored hotel item carries the property's exact coordinates");
eq(hotelBound.coordinateSource, "candidate", "carried point stamped as candidate-sourced");
eq(hotelBound.coordinatePrecision, "place", "carried point stamped place-precision");

// Overture-shaped pack candidate (via the real pack converter): pos lands exactly.
const packBound = enforceGroundedTimelineCandidates(
  { day_number: 1, live_timeline: [seedItem({ candidateId: basilica.id })] },
  payloadFor([basilica])
).live_timeline[0];
eq(packBound.title, "Notre-Dame Basilica of Montreal", "pack candidate binds");
deepEq(packBound.coordinates, { latitude: 45.5046, longitude: -73.5561 }, "stored item carries the pack candidate's exact pos");

// Candidate with NO point: null — and the model's invented point never survives.
const noPoint = enforceGroundedTimelineCandidates(
  {
    day_number: 1,
    live_timeline: [
      seedItem({ candidateId: "cand-1", coordinates: { latitude: 1, longitude: 2 }, coordinateSource: "candidate", coordinatePrecision: "place" })
    ]
  },
  payloadFor([marketResult()])
).live_timeline[0];
eq(noPoint.coordinates, null, "coord-less candidate → stored null (the honest Montreal state)");
eq(noPoint.coordinateSource, undefined, "no point → provenance stamp cleared");
eq(noPoint.coordinatePrecision, undefined, "no point → precision stamp cleared");

// Candidate with a MALFORMED point: null, never a bad pin.
const malformedBound = enforceGroundedTimelineCandidates(
  { day_number: 1, live_timeline: [seedItem({ candidateId: "cand-1" })] },
  payloadFor([
    marketResult({ metadata: { providerPayload: { coordinates: { latitude: 45.5, longitude: -273.5 } } } })
  ])
).live_timeline[0];
eq(malformedBound.coordinates, null, "malformed candidate point → stored null");

/* ---- classic writer: applyRoamlyItineraryIntelligence ---- */
const classicPayload = payloadFor([
  marketResult({
    id: "rest-1",
    category: "restaurant",
    title: "Schwartz's Deli",
    provider: "Booking.com Demand API",
    source: "booking_demand",
    metadata: { providerPayload: { coordinates: { latitude: 45.5168, longitude: -73.5784 } } }
  })
]);
const classicOut = applyRoamlyItineraryIntelligence(
  {
    daily_itinerary: [
      {
        day_number: 1,
        date: "2026-11-12",
        food: [],
        live_timeline: [
          {
            item_type: "meal",
            title: "Lunch nearby",
            description: "Grab lunch.",
            location_name: "",
            map_query: "",
            time_label: "12:00",
            startTime: "12:00",
            endTime: "13:00",
            estimated_cost: null,
            category: "Restaurant"
          }
        ]
      }
    ]
  },
  classicPayload
);
const classicBound = classicOut.daily_itinerary[0].live_timeline.find((i) => i.title === "Schwartz's Deli");
count += 1;
assert.ok(classicBound, "classic writer binds the generic meal to the named restaurant");
deepEq(classicBound.coordinates, { latitude: 45.5168, longitude: -73.5784 }, "classic writer carries the candidate's exact point");
eq(classicBound.coordinateSource, "candidate", "classic writer stamps candidate source");
eq(classicBound.coordinatePrecision, "place", "classic writer stamps place precision");

console.log(`Coordinate-carry checks passed (${count} assertions).`);
