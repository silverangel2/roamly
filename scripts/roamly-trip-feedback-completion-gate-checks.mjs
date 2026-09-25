import assert from "node:assert/strict";
import fs from "node:fs";
import { isCanonicalCompletedTrip } from "../lib/roamly/tripCompletion.ts";

const nyTrip = { status: "completed", startDate: "2026-09-20", endDate: "2026-09-24", metadata: { timezone: "America/New_York" } };
const tokyoTrip = { status: "completed", startDate: "2026-09-20", endDate: "2026-09-24", metadata: { timezone: "Asia/Tokyo" } };

assert.equal(isCanonicalCompletedTrip({ ...nyTrip, now: "2026-09-25T01:00:00Z" }), false, "final destination-local day remains active");
assert.equal(isCanonicalCompletedTrip({ ...nyTrip, now: "2026-09-25T04:01:00Z" }), true, "New York completion uses destination-local boundary");
assert.equal(isCanonicalCompletedTrip({ ...tokyoTrip, now: "2026-09-24T14:00:00Z" }), false, "Tokyo final local day remains active");
assert.equal(isCanonicalCompletedTrip({ ...tokyoTrip, now: "2026-09-24T15:01:00Z" }), true, "Tokyo completion uses destination-local boundary");
assert.equal(isCanonicalCompletedTrip({ ...nyTrip, status: "active", now: "2026-09-26T12:00:00Z" }), false);
assert.equal(isCanonicalCompletedTrip({ ...nyTrip, status: "cancelled", now: "2026-09-26T12:00:00Z" }), false);
assert.equal(isCanonicalCompletedTrip({ ...nyTrip, endDate: "2026-09-26", now: "2026-09-25T12:00:00Z" }), false, "current changed dates win");
assert.equal(isCanonicalCompletedTrip({ ...nyTrip, metadata: { timezone: "Asia/Tokyo" }, now: "2026-09-24T14:00:00Z" }), false, "current changed destination timezone wins");
assert.equal(isCanonicalCompletedTrip({ ...nyTrip, now: "2026-09-25T04:01:00Z" }), true, "device/server timezone does not alter result");

const source = fs.readFileSync("lib/roamly/tripFeedback.ts", "utf8");
const mutation = source.slice(source.indexOf("export async function submitTripFeedback"));
const gate = mutation.indexOf('error: "TRIP_NOT_COMPLETED"');
const sideEffect = mutation.indexOf("const experienceContext =");
assert.ok(gate > 0 && gate < sideEffect, "completion gate must precede experience-context construction");
assert.ok(gate < mutation.indexOf('from("roamly_itineraries")'), "rejected feedback must not read itinerary/context data");
assert.ok(gate < mutation.indexOf('from("trip_feedback")'), "rejected feedback must not read or write feedback rows");
assert.ok(gate < mutation.indexOf('from("traveler_preference_events")'), "rejected feedback must not create preference events");
assert.match(mutation, /onConflict: "trip_id,user_id,feedback_slot"/);
assert.match(mutation, /feedbackType !== "in_trip"/);
assert.match(mutation, /isCanonicalCompletedTrip/);

console.log("trip feedback completion gate checks passed");
