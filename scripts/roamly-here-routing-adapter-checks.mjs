import assert from "node:assert/strict";

const here = await import("../lib/roamly/routingProviders/here.ts");
const routing = await import("../lib/roamly/itineraryRouting.ts");

const retrievedAt = "2026-09-14T12:00:00.000Z";
const A = { itemId: "A", locationId: "place-a", latitude: 45.5, longitude: -73.6 };
const B = { itemId: "B", locationId: "place-b", latitude: 45.51, longitude: -73.58 };
const C = { itemId: "C", locationId: "place-c", latitude: 45.52, longitude: -73.55 };
const request = (from = A, to = B) => ({ from, to, retrievedAt });
const section = (mode = "car", departureTime, arrivalTime) => ({
  transport: { mode },
  departure: departureTime ? { time: departureTime, place: { location: { lat: A.latitude, lng: A.longitude } } } : undefined,
  arrival: arrivalTime ? { time: arrivalTime, place: { location: { lat: B.latitude, lng: B.longitude } } } : undefined
});
const response = (overrides = {}) => ({
  routes: [{
    id: "here-route-1",
    summary: { lengthMeters: 2200, durationSeconds: 900 },
    sections: [section()]
  }],
  ...overrides
});

let result = here.normalizeHereResponse({ request: request(), response: response() });
assert.equal(result.status, "OK");
assert.equal(result.routes.length, 1);
let normalized = result.routes[0];
assert.equal(normalized.provider, "HERE");
assert.equal(normalized.fromItemId, "A");
assert.equal(normalized.toItemId, "B");
assert.equal(normalized.evidence.mode, "DRIVE");
assert.equal(normalized.evidence.distanceKm, 2.2);
assert.equal(normalized.evidence.distanceKind, "ROUTE_DISTANCE");
assert.equal(normalized.evidence.durationMinutes, 15);
assert.equal(normalized.providerRouteId, "here-route-1");
assert.equal(normalized.providerRouteIdKind, "NATIVE");
assert.equal(normalized.evidenceIdKind, "ADAPTER_GENERATED");
assert.match(normalized.evidenceId, /^here-adapter:A->B:route-0:/);
assert.equal(normalized.evidence.source, "HERE_ROUTING_FIXTURE_ADAPTER");
assert.equal(normalized.evidence.retrievedAt, retrievedAt);
assert.equal(normalized.freshness, "STATIC_ROUTE");

result = here.normalizeHereResponse({ request: request(), response: { routes: [{ ...response().routes[0], id: undefined }] } });
assert.equal(result.routes[0].providerRouteId, null);
assert.equal(result.routes[0].providerRouteIdKind, "NONE");
assert.equal(result.routes[0].evidenceIdKind, "ADAPTER_GENERATED");

result = here.normalizeHereResponse({ request: request(), response: { routes: [{ ...response().routes[0], sections: [section("pedestrian")] }] } });
assert.equal(result.routes[0].evidence.mode, "WALK");
result = here.normalizeHereResponse({ request: request(), response: { routes: [{ ...response().routes[0], sections: [section("bus")] }] } });
assert.equal(result.routes[0].evidence.mode, "UNKNOWN");

const traffic = {
  routes: [{
    id: "traffic-route",
    summary: { lengthMeters: 5000, durationSeconds: 1800, baseDurationSeconds: 1200, trafficDurationSeconds: 1800 },
    sections: [section()]
  }]
};
result = here.normalizeHereResponse({ request: request(), response: traffic });
normalized = result.routes[0];
assert.equal(normalized.freshness, "TRAFFIC_AWARE_ROUTE");
assert.equal(normalized.trafficDurationMinutes, 30);
assert.equal(normalized.baseDurationMinutes, 20);
assert.equal(normalized.evidence.durationMinutes, 30);
assert.equal(normalized.evidence.authority, "AUTHORITATIVE_ROUTE");
result = here.normalizeHereResponse({ request: request(), response: { routes: [{ ...traffic.routes[0], summary: { lengthMeters: 5000, durationSeconds: 1800 }, sections: [section()] }] } });
assert.equal(result.routes[0].freshness, "STATIC_ROUTE");
assert.equal(result.routes[0].trafficDurationMinutes, null);

result = here.normalizeHereResponse({ request: request(), response: {
  routes: [response().routes[0], { summary: { lengthMeters: -1, durationSeconds: 900 }, sections: [section()] }]
} });
assert.equal(result.status, "OK");
assert.equal(result.routes.length, 1);
assert.equal(result.invalidRoutes.length, 1);

for (const summary of [
  { durationSeconds: -1, lengthMeters: 100 },
  { durationSeconds: Number.NaN, lengthMeters: 100 },
  { durationSeconds: Number.POSITIVE_INFINITY, lengthMeters: 100 },
  { durationSeconds: 60, lengthMeters: -1 },
  { durationSeconds: 60, lengthMeters: Number.NaN },
  { durationSeconds: 60, lengthMeters: Number.POSITIVE_INFINITY }
]) {
  result = here.normalizeHereResponse({ request: request(), response: { routes: [{ summary, sections: [section()] }] } });
  assert.equal(result.status, "INVALID");
  assert.equal(result.routes.length, 0);
}

for (const incompleteResponse of [
  { routes: [{ summary: { lengthMeters: 100 }, sections: [section()] }] },
  { routes: [{ summary: { durationSeconds: 60 }, sections: [section()] }] }
]) {
  result = here.normalizeHereResponse({ request: request(), response: incompleteResponse });
  assert.equal(result.status, "OK");
}
result = here.normalizeHereResponse({ request: request(), response: { routes: [{ summary: { lengthMeters: 100 }, sections: [section()] }] } });
assert.equal(result.routes[0].evidence.distanceKind, "ROUTE_DISTANCE");
assert.equal(result.routes[0].evidence.durationMinutes, null);
assert.equal(result.routes[0].evidence.authority, "UNKNOWN");
result = here.normalizeHereResponse({ request: request(), response: { routes: [{ summary: { durationSeconds: 60 }, sections: [section()] }] } });
assert.equal(result.routes[0].evidence.distanceKind, "UNKNOWN");
assert.equal(result.routes[0].evidence.distanceKm, null);
assert.equal(result.routes[0].evidence.durationMinutes, 1);

for (const badResponse of [
  { routes: [{ summary: { lengthMeters: 100, durationSeconds: 60 }, sections: [] }] },
  { routes: [] },
  {},
  { error: "provider failure" }
]) {
  result = here.normalizeHereResponse({ request: request(), response: badResponse });
  if (badResponse.routes?.length) {
    assert.equal(result.routes.length, 0);
    assert.equal(result.status, "INVALID");
  } else assert.equal(result.status, "NO_EVIDENCE");
}

result = here.normalizeHereResponse({
  request: request(),
  response: { routes: [{ ...response().routes[0], origin: { lat: 1, lng: 1 } }] }
});
assert.equal(result.status, "INVALID");
assert(result.invalidRoutes[0].reasons.includes("ORIGIN_COORDINATE_MISMATCH"));
result = here.normalizeHereResponse({
  request: request(),
  response: { routes: [{ ...response().routes[0], origin: { lat: 999, lng: 1 } }] }
});
assert(result.invalidRoutes[0].reasons.includes("INVALID_RESPONSE_COORDINATES"));
result = here.normalizeHereResponse({
  request: { from: { ...A, latitude: 99 }, to: B, retrievedAt },
  response: response()
});
assert(result.invalidRoutes[0].reasons.includes("INVALID_EXPECTED_COORDINATES"));

const timed = {
  routes: [{
    summary: { lengthMeters: 1000, durationSeconds: 900 },
    sections: [section("car", "2026-09-14T18:00:00-03:00", "2026-09-14T18:15:00-03:00")]
  }]
};
result = here.normalizeHereResponse({ request: request(), response: timed });
assert.equal(result.routes[0].departureTime, "2026-09-14T18:00:00-03:00");
assert.equal(result.routes[0].arrivalTime, "2026-09-14T18:15:00-03:00");
assert.equal(result.routes[0].freshness, "TIME_DEPENDENT_ROUTE");
const ambiguous = { routes: [{ ...timed.routes[0], sections: [section("car", "2026-09-14T18:00:00", "2026-09-14T18:15:00")] }] };
result = here.normalizeHereResponse({ request: request(), response: ambiguous });
assert.equal(result.routes[0].departureTime, null);
assert.equal(result.routes[0].arrivalTime, null);
assert.equal(result.routes[0].freshness, "STATIC_ROUTE");

result = here.normalizeHereResponse({ request: request(), response: {
  routes: [response().routes[0], { ...response().routes[0], id: "here-route-2" }]
} });
assert.equal(result.routes.length, 2);
assert.equal(result.routes[0].providerRouteId, "here-route-1");
assert.equal(result.routes[1].providerRouteId, "here-route-2");

const matrix = here.normalizeHereMatrix({
  retrievedAt,
  matrix: {
    origins: [
      { itemId: "A", latitude: A.latitude, longitude: A.longitude },
      { itemId: "B", latitude: B.latitude, longitude: B.longitude }
    ],
    destinations: [
      { itemId: "C", latitude: C.latitude, longitude: C.longitude },
      { itemId: "D", latitude: 45.53, longitude: -73.54 }
    ],
    cells: [
      { originIndex: 0, destinationIndex: 0, status: "OK", route: { ...response().routes[0], id: "a-c" } },
      { originIndex: 0, destinationIndex: 1, status: "UNREACHABLE", route: { ...response().routes[0], id: "bad" } },
      { originIndex: 1, destinationIndex: 0, status: "OK", route: { ...response().routes[0], id: "b-c" } }
    ]
  }
});
assert.equal(matrix.status, "OK");
assert.deepEqual(matrix.cells.map((cell) => [cell.originItemId, cell.destinationItemId]), [["A", "C"], ["A", "D"], ["B", "C"]]);
assert.equal(matrix.cells[0].evidence?.fromItemId, "A");
assert.equal(matrix.cells[0].evidence?.toItemId, "C");
assert.equal(matrix.cells[1].status, "UNKNOWN");
assert.equal(matrix.cells[1].evidence, null);
assert.equal(matrix.cells[2].evidence?.providerRouteId, "b-c");
assert.equal(matrix.cells.find((cell) => cell.originItemId === "C" && cell.destinationItemId === "A"), undefined);

const missingCell = here.normalizeHereMatrix({ retrievedAt, matrix: {
  origins: [{ itemId: "A", latitude: A.latitude, longitude: A.longitude }],
  destinations: [{ itemId: "B", latitude: B.latitude, longitude: B.longitude }],
  cells: []
} });
assert.equal(missingCell.status, "NO_EVIDENCE");

const domainEvidence = normalized.evidence;
let feasibility = routing.evaluateRouteTransition({
  from: A,
  to: B,
  schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 },
  evidence: domainEvidence
});
assert.equal(feasibility.feasibility, "FEASIBLE");
feasibility = routing.evaluateRouteTransition({
  from: A,
  to: B,
  schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 10 },
  evidence: { ...domainEvidence, durationMinutes: 15 }
});
assert.equal(feasibility.feasibility, "INFEASIBLE");
feasibility = routing.evaluateRouteTransition({
  from: A,
  to: B,
  schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 30 },
  evidence: { ...domainEvidence, durationMinutes: null, durationSource: null, authority: "UNKNOWN" }
});
assert.equal(feasibility.feasibility, "UNCERTAIN");
const confirmed = routing.evaluateRouteTransition({
  from: A,
  to: B,
  schedule: { previousEndMinutes: 18 * 60, nextStartMinutes: 18 * 60 + 10 },
  evidence: { ...domainEvidence, durationMinutes: 15 },
  confirmedBooking: { bookingId: "confirmed-train", fixedStartMinutes: 18 * 60 + 10 }
});
assert.equal(confirmed.feasibility, "INFEASIBLE");
assert.equal(confirmed.confirmedBookingId, "confirmed-train");

assert.equal(JSON.stringify(here).toLowerCase().includes("api_key"), false);
assert.equal(JSON.stringify(here).toLowerCase().includes("fetch("), false);
assert.equal(JSON.stringify(here).toLowerCase().includes("speed"), false);

console.log("Roamly HERE routing adapter checks passed (fixture normalization, exact identity, coordinate/duration safety, traffic distinction, matrix binding, provenance, and domain feasibility handoff).");
