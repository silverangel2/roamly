import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyTravelMarketProviderError,
  travelMarketFailureClassFromHotelState,
  travelMarketProviderIncident,
  TRAVEL_MARKET_FAILURE_CLASSES
} from "../lib/roamly/travelMarketProviderDiagnostics.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const search = fs.readFileSync(path.join(root, "lib/roamly/travelMarketSearch.ts"), "utf8");
const incidents = fs.readFileSync(path.join(root, "lib/roamly/operationalIncidents.ts"), "utf8");

assert.equal(classifyTravelMarketProviderError({ name: "TimeoutError" }).failureClass, TRAVEL_MARKET_FAILURE_CLASSES.requestTimeout);
assert.equal(classifyTravelMarketProviderError({ name: "TypeError", message: "fetch failed" }).failureClass, TRAVEL_MARKET_FAILURE_CLASSES.networkFailure);
assert.equal(classifyTravelMarketProviderError({ status: 429 }).failureClass, TRAVEL_MARKET_FAILURE_CLASSES.rateLimited);
assert.equal(classifyTravelMarketProviderError({ status: 503 }).failureClass, TRAVEL_MARKET_FAILURE_CLASSES.providerError);
assert.equal(classifyTravelMarketProviderError({ status: 503 }).retryable, true);

assert.equal(travelMarketFailureClassFromHotelState("TIMEOUT").failureClass, TRAVEL_MARKET_FAILURE_CLASSES.requestTimeout);
assert.equal(travelMarketFailureClassFromHotelState("RATE_LIMITED").failureClass, TRAVEL_MARKET_FAILURE_CLASSES.rateLimited);
assert.equal(travelMarketFailureClassFromHotelState("MALFORMED_PROVIDER_RESPONSE").failureClass, TRAVEL_MARKET_FAILURE_CLASSES.invalidResponse);
assert.equal(travelMarketFailureClassFromHotelState("NO_RESULTS"), null, "legitimate zero results must not create a provider incident");
assert.equal(travelMarketFailureClassFromHotelState("PROVIDER_NOT_CONFIGURED"), null, "dormant/unconfigured providers must not create noise");

const first = travelMarketProviderIncident({ provider: "booking_demand", operation: "hotel_search", category: "hotel", failureClass: TRAVEL_MARKET_FAILURE_CLASSES.rateLimited, retryable: true, httpStatus: 429, now: 0 });
const repeated = travelMarketProviderIncident({ provider: "booking_demand", operation: "hotel_search", category: "hotel", failureClass: TRAVEL_MARKET_FAILURE_CLASSES.rateLimited, retryable: true, httpStatus: 429, now: 14 * 60 * 1000 });
const nextBucket = travelMarketProviderIncident({ provider: "booking_demand", operation: "hotel_search", category: "hotel", failureClass: TRAVEL_MARKET_FAILURE_CLASSES.rateLimited, retryable: true, httpStatus: 429, now: 15 * 60 * 1000 });
const otherProvider = travelMarketProviderIncident({ provider: "travelpayouts", operation: "live_search", category: "flight", failureClass: TRAVEL_MARKET_FAILURE_CLASSES.rateLimited, retryable: true, httpStatus: 429, now: 0 });

assert.equal(first.severity, "medium", "provider outages must not create high-severity alert storms");
assert.equal(first.eventKey, repeated.eventKey, "same outage class coalesces inside the bounded bucket");
assert.notEqual(first.eventKey, nextBucket.eventKey, "later buckets preserve bounded recurrence evidence");
assert.notEqual(first.eventKey, otherProvider.eventKey, "providers remain independently attributable");
assert.deepEqual(first.safeMetadata, {
  provider: "booking_demand",
  operation: "hotel_search",
  failure_class: "RATE_LIMITED",
  retryable: true,
  http_status: 429
});

const serialized = JSON.stringify(first);
for (const forbidden of ["token", "authorization", "api_key", "payload", "email", "passport", "location"]) {
  assert.equal(serialized.includes(forbidden), false, `diagnostic must not include ${forbidden}`);
}

assert.match(search, /recordOperationalEvent/);
assert.match(search, /recordHotelInventoryFailure/);
assert.match(search, /provider diagnostic unavailable/);
assert.match(search, /travelMarketFailureClassFromHotelState/);
assert.match(search, /providerFailure = travelMarketProviderFailureMessage\(error\)/);
assert.match(search, /hotel_inventory_truth/);
assert.match(incidents, /SAFE_METADATA_KEYS/);
assert.match(incidents, /2048/);

console.log("G-A23-02 travel-market provider diagnostics checks passed.");
