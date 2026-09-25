import assert from "node:assert/strict";
import fs from "node:fs";
import { readRelevantSuccessfulTripPatterns, selectRelevantSuccessfulTripPatterns } from "../lib/roamly/successfulTripExperiencePatterns.ts";

const input = {
  destinationCity: "Montreal",
  destinationCountry: "Canada",
  daysCount: 5,
  travelersCount: 2,
  travelStyle: "Balanced",
  accommodationPreference: "Downtown",
  transportationPreference: "Mixed"
};

const row = (overrides = {}) => ({
  pattern_key: "montreal|balanced|downtown|mixed|4-7|2",
  destination_key: "montreal,canada",
  travel_style: "balanced",
  accommodation_preference: "downtown",
  transportation_preference: "mixed",
  duration_bucket: "4-7",
  travelers_bucket: "2",
  sample_count: 4,
  average_satisfaction: 4.5,
  average_schedule_realism: 4,
  average_budget_accuracy: 4,
  average_hotel_location_satisfaction: 4,
  average_hotel_quality_satisfaction: 4,
  average_transportation_satisfaction: 4,
  updated_at: "2026-09-24T00:00:00Z",
  ...overrides
});

const selected = selectRelevantSuccessfulTripPatterns([
  row(),
  row({ pattern_key: "wrong-destination", destination_key: "lisbon,portugal" }),
  row({ pattern_key: "unqualified", sample_count: 2 }),
  row({ pattern_key: "malformed", duration_bucket: null }),
  row({ pattern_key: "higher-evidence", sample_count: 8 })
], input);

assert.deepEqual(selected.map((pattern) => pattern.patternKey), ["higher-evidence", "montreal|balanced|downtown|mixed|4-7|2"]);
assert.ok(selected.length <= 5, "planning guidance must be bounded");
assert.equal(Object.hasOwn(selected[0], "user_id"), false);
assert.equal(Object.hasOwn(selected[0], "trip_id"), false);
assert.equal(Object.hasOwn(selected[0], "free_text_feedback"), false);

assert.equal(selectRelevantSuccessfulTripPatterns([], input).length, 0);
assert.equal(selectRelevantSuccessfulTripPatterns([row()], { ...input, destinationCity: "Toronto" }).length, 0);
assert.equal(selectRelevantSuccessfulTripPatterns([row({ duration_bucket: "unknown" })], input).length, 1);
assert.equal(selectRelevantSuccessfulTripPatterns([row({ travel_style: "Adventure" })], input).length, 0);

const failingClient = {
  from() {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      gte() { return chain; },
      order() { return chain; },
      limit: async () => ({ data: null, error: new Error("secondary read unavailable") })
    };
    return chain;
  }
};
assert.deepEqual(await readRelevantSuccessfulTripPatterns({ supabase: failingClient, input }), []);

const staged = fs.readFileSync("lib/roamly/stagedItineraryGeneration.ts", "utf8");
const personalization = fs.readFileSync("lib/roamly/travelerPersonalization.ts", "utf8");
assert.match(staged, /readRelevantSuccessfulTripPatterns/);
assert.match(staged, /anonymous aggregate successful-trip guidance/i);
assert.match(staged, /already grounded, eligible candidates/i);
assert.match(staged, /Never create or name a candidate, provider, price, schedule, availability, coordinates, route, URL, booking/);
assert.match(staged, /accepted user-specific preferences always override aggregate guidance/i);
assert.match(personalization, /aggregateGuidance/);
assert.doesNotMatch(staged, /traveler_preference_events/);

console.log("successful trip pattern consumption checks passed");
