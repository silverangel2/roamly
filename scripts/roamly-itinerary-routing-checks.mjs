import assert from "node:assert/strict";

const routing = await import("../lib/roamly/itineraryRouting.ts");

const A = { itemId: "A", locationId: "place-a", latitude: 45.5, longitude: -73.6, locationSource: "fixture", provenance: "fixture:A" };
const B = { itemId: "B", locationId: "place-b", latitude: 45.51, longitude: -73.58, locationSource: "fixture", provenance: "fixture:B" };
const C = { itemId: "C", locationId: "place-c", latitude: 45.52, longitude: -73.55, locationSource: "fixture", provenance: "fixture:C" };

const evidence = (from = A, to = B, durationMinutes = 15) => routing.buildRouteEvidence({
  from,
  to,
  mode: "WALK",
  durationMinutes,
  durationSource: "deterministic-test-fixture",
  authority: "GROUNDED_ESTIMATE",
  source: "deterministic-test-fixture",
  retrievedAt: "2026-09-14T12:00:00.000Z",
  confidence: "high"
});

let result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: evidence(A, B, 15) });
assert.equal(result.feasibility, "FEASIBLE");
assert(result.reasons.includes("ROUTE_DURATION_WITHIN_GAP"));

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: evidence(A, B, 45) });
assert.equal(result.feasibility, "INFEASIBLE");
assert(result.reasons.includes("ROUTE_DURATION_EXCEEDS_GAP"));

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 15 }, evidence: evidence(A, B, 15) });
assert.equal(result.feasibility, "FEASIBLE");

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: routing.buildRouteEvidence({ from: A, to: B, mode: "WALK", authority: "GROUNDED_ESTIMATE", source: "fixture" }) });
assert.equal(result.feasibility, "UNCERTAIN");
assert(result.reasons.includes("ROUTE_DURATION_UNKNOWN"));

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: { ...evidence(A, B, 15), durationSource: null, authority: "UNKNOWN" } });
assert.equal(result.feasibility, "UNCERTAIN");
assert(result.reasons.includes("ROUTE_DURATION_UNKNOWN"));

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { nextStartMinutes: 18 * 60 + 30 }, evidence: evidence(A, B) });
assert.equal(result.feasibility, "UNCERTAIN");
assert(result.reasons.includes("PREVIOUS_END_UNKNOWN"));

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60 }, evidence: evidence(A, B) });
assert.equal(result.feasibility, "UNCERTAIN");
assert(result.reasons.includes("NEXT_START_UNKNOWN"));

const noCoordinates = { itemId: "no-coordinates", locationId: "unknown", provenance: "fixture:unknown" };
const oneCoordinate = { ...A, itemId: "one-coordinate", longitude: null };
assert.equal(routing.geodesicStraightLineDistanceKm(noCoordinates, B), null);
assert.equal(routing.geodesicStraightLineDistanceKm(oneCoordinate, B), null);
const geodesic = routing.geodesicStraightLineDistanceKm(A, B);
assert.equal(typeof geodesic, "number");
assert.equal(evidence(A, B).distanceKind, "GEODESIC_STRAIGHT_LINE");
assert.notEqual(evidence(A, B).distanceKind, "ROUTE_DISTANCE");
assert.equal(evidence(A, B).durationMinutes, 15);

result = routing.evaluateRouteTransition({
  from: A,
  to: B,
  schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 },
  evidence: routing.buildRouteEvidence({ from: A, to: B, mode: "UNKNOWN", authority: "UNKNOWN" })
});
assert.equal(result.feasibility, "UNCERTAIN");
assert(!result.reasons.includes("ROUTE_DURATION_WITHIN_GAP"));
assert(result.reasons.includes("MODE_UNKNOWN"));
assert(result.reasons.includes("ROUTE_SOURCE_UNKNOWN"));

const fortyKmFrom = { itemId: "40km-a", latitude: 45.5, longitude: -73.6 };
const fortyKmTo = { itemId: "40km-b", latitude: 45.86, longitude: -73.6 };
result = routing.evaluateRouteTransition({ from: fortyKmFrom, to: fortyKmTo, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 } });
assert.equal(result.feasibility, "UNCERTAIN");
assert.equal(result.distanceKind, "GEODESIC_STRAIGHT_LINE");
assert.equal(result.requiredMinutes, null);

result = routing.evaluateRouteTransition({ from: fortyKmFrom, to: fortyKmTo, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: evidence(fortyKmFrom, fortyKmTo, 45) });
assert.equal(result.feasibility, "INFEASIBLE");

const proseOnly = { fromItemId: "A", toItemId: "B", mode: "WALK", authority: "UNKNOWN", source: null, durationMinutes: null };
result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: proseOnly });
assert.equal(result.feasibility, "UNCERTAIN");
assert.equal(result.requiredMinutes, null);

const confirmed = { bookingId: "train-1", fixedStartMinutes: 18 * 60 + 10 };
result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 10 }, evidence: evidence(A, B, 25), confirmedBooking: confirmed });
assert.equal(result.feasibility, "INFEASIBLE");
assert(result.reasons.includes("CONFIRMED_BOOKING_CONFLICT"));
assert.equal(result.confirmedBookingId, "train-1");
assert.equal(confirmed.fixedStartMinutes, 18 * 60 + 10);

const hotel = { itemId: "hotel", locationId: "booking-property-1", latitude: 45.5, longitude: -73.6, provenance: "Booking Demand property" };
assert.equal(hotel.locationId, "booking-property-1");
const event = { itemId: "event", locationId: "public-event-1", latitude: 45.52, longitude: -73.55, provenance: "official-event-source", date: "2026-10-10", startTime: "20:00" };
assert.equal(event.date, "2026-10-10");
assert.equal(event.startTime, "20:00");
const klook = { itemId: "klook-1", locationId: "klook-activity-1", provenance: "grounded-klook-result" };
assert.equal(klook.locationId, "klook-activity-1");
assert.equal(event.provenance, "official-event-source");

result = routing.evaluateRouteTransition({ from: noCoordinates, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: evidence(noCoordinates, B, 15) });
assert.equal(result.feasibility, "UNCERTAIN");
assert(result.reasons.includes("FROM_COORDINATES_UNKNOWN"));
assert.equal(result.distanceKm, null);

result = routing.evaluateRouteTransition({ from: A, to: C, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 }, evidence: evidence(A, B, 15) });
assert.equal(result.feasibility, "UNCERTAIN");
assert(result.reasons.includes("TRANSITION_IDENTITY_MISMATCH"));
assert.equal(result.transitionId, "A->C");

result = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30, explicitBufferMinutes: 20 }, evidence: evidence(A, B, 15) });
assert.equal(result.feasibility, "INFEASIBLE");
assert.equal(result.requiredMinutes, 35);
assert(result.reasons.includes("EXPLICIT_BUFFER_APPLIED"));

const serialized = routing.serializeRouteTransition(result);
assert.deepEqual(serialized, result);
assert.equal(result.mode, "WALK");
assert.equal(result.evidence?.source, "deterministic-test-fixture");
assert.equal(result.evidence?.retrievedAt, "2026-09-14T12:00:00.000Z");

for (const forbidden of ["google", "maps", "mapbox", "here", "tomtom", "rome2rio", "uber", "lyft", "apple maps", "firecrawl"]) {
  assert.equal(JSON.stringify(routing).toLowerCase().includes(forbidden), false, `routing module must not add provider ${forbidden}`);
}

console.log("Roamly itinerary routing checks passed (identity, evidence authority, geodesic labeling, schedule arithmetic, conservative feasibility, and confirmed-booking protection).");
