import assert from "node:assert/strict";

const valhalla = await import("../lib/roamly/routingProviders/valhalla.ts");
const routing = await import("../lib/roamly/itineraryRouting.ts");

const retrievedAt = "2026-09-14T12:00:00.000Z";
const A = { itemId: "A", locationId: "a", latitude: 45.5, longitude: -73.6 };
const B = { itemId: "B", locationId: "b", latitude: 45.51, longitude: -73.58 };
const C = { itemId: "C", locationId: "c", latitude: 45.52, longitude: -73.55 };
const D = { itemId: "D", locationId: "d", latitude: 45.53, longitude: -73.54 };
const request = (from = A, to = B, costing = "auto", units = "kilometers") => ({ from, to, costing, units, retrievedAt });
const trip = (summary = { length: 2.2, time: 900 }, extra = {}) => ({ costing: "auto", summary, ...extra });
const response = (summary = { length: 2.2, time: 900 }, extra = {}) => ({ trip: trip(summary, extra) });

let result = valhalla.normalizeValhallaResponse({ request: request(), response: response() });
assert.equal(result.status, "OK");
assert.equal(result.routes[0].provider, "VALHALLA");
assert.equal(result.routes[0].fromItemId, "A");
assert.equal(result.routes[0].toItemId, "B");
assert.equal(result.routes[0].evidence.mode, "DRIVE");
assert.equal(result.routes[0].evidence.distanceKm, 2.2);
assert.equal(result.routes[0].evidence.durationMinutes, 15);
assert.equal(result.routes[0].freshness, "STATIC_ROUTE");
assert.equal(result.routes[0].provenance.routingEngine, "VALHALLA");
assert.equal(result.routes[0].provenance.mapDataSource, "OPENSTREETMAP");
assert.equal(result.routes[0].provenance.mapDatasetVersion, null);
assert.equal(result.routes[0].provenance.retrievedAt, retrievedAt);
assert.equal(result.routes[0].providerRouteId, null);
assert.equal(result.routes[0].providerRouteIdKind, "NONE");
assert.match(result.routes[0].evidenceId, /^valhalla-adapter:A->B:route-0:/);
assert.equal(result.routes[0].evidenceIdKind, "ROAMLY_ADAPTER_EVIDENCE_ID");

result = valhalla.normalizeValhallaResponse({ request: request(A, B, "pedestrian"), response: response({ length: 1, time: 600, departure_time: "2026-09-14T18:00:00-03:00", arrival_time: "2026-09-14T18:10:00-03:00" }, { costing: "pedestrian" }) });
assert.equal(result.routes[0].evidence.mode, "WALK");
assert.equal(result.routes[0].departureTime, "2026-09-14T18:00:00-03:00");
assert.equal(result.routes[0].arrivalTime, "2026-09-14T18:10:00-03:00");

result = valhalla.normalizeValhallaResponse({ request: request(A, B, "auto"), response: response({ length: 1, time: 60 }, { costing: "transit" }) });
assert.equal(result.status, "INVALID");
assert.equal(result.routes.length, 0);
assert(result.invalidRoutes[0].reasons.includes("UNSUPPORTED_COSTING"));
result = valhalla.normalizeValhallaResponse({ request: request(), response: response({ length: 1, time: 60 }, { status: 1 }) });
assert.equal(result.status, "INVALID");
assert(result.invalidRoutes[0].reasons.includes("PROVIDER_TRIP_ERROR"));

result = valhalla.normalizeValhallaResponse({ request: request(), response: { trip: { id: "native-1", costing: "auto", summary: { length: 1, time: 60 }, locations: [{ lat: A.latitude, lon: A.longitude }, { lat: B.latitude, lon: B.longitude }] } } });
assert.equal(result.routes[0].providerRouteId, "native-1");
assert.equal(result.routes[0].providerRouteIdKind, "VALHALLA_NATIVE_ID");
assert.equal(result.routes[0].evidence.distanceKind, "ROUTE_DISTANCE");

result = valhalla.normalizeValhallaResponse({ request: request(), response: response({ length: 1 }) });
assert.equal(result.routes[0].evidence.distanceKind, "ROUTE_DISTANCE");
assert.equal(result.routes[0].evidence.durationMinutes, null);
assert.equal(result.routes[0].evidence.authority, "UNKNOWN");
result = valhalla.normalizeValhallaResponse({ request: request(), response: response({ time: 60 }) });
assert.equal(result.routes[0].evidence.distanceKm, null);
assert.equal(result.routes[0].evidence.distanceKind, "UNKNOWN");
assert.equal(result.routes[0].evidence.durationMinutes, 1);
assert.equal(result.routes[0].evidence.authority, "AUTHORITATIVE_ROUTE");

result = valhalla.normalizeValhallaResponse({ request: request(A, B, "auto", "miles"), response: response({ length: 1, time: 60 }) });
assert.equal(result.routes[0].evidence.distanceKm, 1.609344);
assert.equal(valhalla.normalizeValhallaResponse({ request: request(), response: response({ length: 1, time: 60 }) }).routes[0].evidence.distanceKm, 1);

for (const summary of [{ length: -1, time: 60 }, { length: 1, time: -1 }, { length: Number.NaN, time: 60 }, { length: 1, time: Number.POSITIVE_INFINITY }]) {
  result = valhalla.normalizeValhallaResponse({ request: request(), response: response(summary) });
  assert.equal(result.routes.length, 0);
  assert.equal(result.status, "INVALID");
}
for (const badResponse of [{}, { error: "failed" }, { trip: null }]) {
  result = valhalla.normalizeValhallaResponse({ request: request(), response: badResponse });
  assert.notEqual(result.status, "OK");
}

result = valhalla.normalizeValhallaResponse({ request: request(), response: response(trip().summary, { locations: [{ lat: 0, lon: 0 }, { lat: B.latitude, lon: B.longitude }] }) });
assert(result.invalidRoutes[0].reasons.includes("ORIGIN_COORDINATE_MISMATCH"));
result = valhalla.normalizeValhallaResponse({ request: request({ ...A, latitude: 99 }, B), response: response() });
assert(result.invalidRoutes[0].reasons.includes("INVALID_EXPECTED_COORDINATES"));

result = valhalla.normalizeValhallaResponse({ request: request(), response: { trips: [trip({ length: 1, time: 60 }), trip({ length: -1, time: 60 })] } });
assert.equal(result.routes.length, 1);
assert.equal(result.invalidRoutes.length, 1);
assert.equal(result.routes[0].evidence.durationMinutes, 1);
result = valhalla.normalizeValhallaResponse({ request: request(), response: response({ length: 3, time: 120 }, { legs: [{ summary: { length: 1, time: 60 } }, { summary: { length: 2, time: 60 } }] }) });
assert.equal(result.routes[0].evidence.distanceKm, 3);
assert.equal(result.routes[0].evidence.durationMinutes, 2);
result = valhalla.normalizeValhallaResponse({ request: request(), response: response({ length: 3, time: 120 }, { legs: [{ summary: { length: 1, time: 60 } }, { summary: { length: 2 } }] }) });
assert.equal(result.status, "INVALID");

const matrixRequest = { origins: [A, B], destinations: [C, D], costing: "auto", units: "kilometers", retrievedAt };
const matrix = valhalla.normalizeValhallaMatrix({ request: matrixRequest, response: { sources_to_targets: [
  { from_index: 0, to_index: 0, distance: 2, time: 120 },
  { from_index: 0, to_index: 1, distance: 3, time: 180 },
  { from_index: 1, to_index: 0, distance: 4, time: 240 },
  { from_index: 1, to_index: 1, distance: 5, time: 300 }
] } });
assert.equal(matrix.status, "OK");
assert.deepEqual(matrix.cells.map((cell) => [cell.originItemId, cell.destinationItemId]), [["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"]]);
assert.equal(matrix.cells[2].evidence?.fromItemId, "B");
assert.equal(matrix.cells[2].evidence?.toItemId, "C");
const partial = valhalla.normalizeValhallaMatrix({ request: { ...matrixRequest, origins: [A], destinations: [B] }, response: { sources_to_targets: [{ from_index: 0, to_index: 0, distance: null, time: null, status: "UNREACHABLE" }] } });
assert.equal(partial.cells[0].status, "UNKNOWN");
assert.equal(partial.cells[0].evidence, null);
const missing = valhalla.normalizeValhallaMatrix({ request: { ...matrixRequest, origins: [A], destinations: [B] }, response: { sources_to_targets: [] } });
assert.equal(missing.status, "NO_EVIDENCE");
assert.equal(valhalla.normalizeValhallaMatrix({ request: { ...matrixRequest, origins: [A], destinations: [B] }, response: { sources_to_targets: [{ from_index: 0, to_index: 0, distance: 1, time: 60 }] } }).cells[0].evidence?.fromItemId, "A");

const evidence = result = valhalla.normalizeValhallaResponse({ request: request(), response: response({ length: 1, time: 900 }) }).routes[0].evidence;
let feasibility = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 1080, nextStartMinutes: 1110 }, evidence });
assert.equal(feasibility.feasibility, "FEASIBLE");
feasibility = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 1080, nextStartMinutes: 1090 }, evidence });
assert.equal(feasibility.feasibility, "INFEASIBLE");
feasibility = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 1080, nextStartMinutes: 1110 }, evidence: { ...evidence, durationMinutes: null, durationSource: null, authority: "UNKNOWN" } });
assert.equal(feasibility.feasibility, "UNCERTAIN");
feasibility = routing.evaluateRouteTransition({ from: A, to: B, schedule: { previousEndMinutes: 1080, nextStartMinutes: 1090 }, evidence, confirmedBooking: { bookingId: "fixed", fixedStartMinutes: 1090 } });
assert.equal(feasibility.feasibility, "INFEASIBLE");
assert.equal(feasibility.confirmedBookingId, "fixed");

assert.equal(JSON.stringify(valhalla).toLowerCase().includes("fetch("), false);
assert.equal(JSON.stringify(valhalla).toLowerCase().includes("process.env"), false);
assert.equal(JSON.stringify(valhalla).toLowerCase().includes("traffic"), false);
assert.equal(JSON.stringify(valhalla).toLowerCase().includes("geodesic"), false);

console.log("Roamly Valhalla routing adapter checks passed (fixture normalization, OSM/engine provenance, exact route and matrix identity, unit and unknown safety, static freshness, and itineraryRouting feasibility handoff).");
