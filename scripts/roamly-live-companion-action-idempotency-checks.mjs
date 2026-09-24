import assert from "node:assert/strict";
import fs from "node:fs";

const actions = fs.readFileSync("lib/roamly/activityActions.ts", "utf8");
const client = fs.readFileSync("components/trip/LiveTripClient.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260930000100_roamly_live_companion_action_idempotency.sql", "utf8");
const foreground = fs.readFileSync("scripts/roamly-live-companion-foreground-reconciliation-checks.mjs", "utf8");
const timezone = fs.readFileSync("scripts/roamly-trip-activation-timezone-checks.mjs", "utf8");

assert.match(actions, /\.in\("status", eligibleStatuses\)/, "actions must use a conditional status transition");
assert.match(actions, /\.select\("\*"\)\s*\.maybeSingle\(\)/, "the transition must observe whether it won the atomic update");
assert.match(actions, /idempotent: true/, "repeated equivalent actions must return an idempotent success");
assert.match(actions, /actionConflict/, "conflicting terminal states must not be overwritten");
assert.match(actions, /if \(!transition\.transitioned\)/, "side effects must be skipped after an equivalent state is already canonical");

for (const indexName of [
  "roamly_trip_events_activity_action_uidx",
  "roamly_trip_companion_events_activity_action_uidx",
  "roamly_notifications_activity_action_uidx"
]) {
  assert.match(migration, new RegExp(`create unique index ${indexName}`), `${indexName} must be a database uniqueness boundary`);
}
assert.match(migration, /activity_checked_in.*activity_skipped/s, "both action types must be covered");
assert.match(client, /router\.refresh\(\)/, "G-A7-01 foreground reconciliation must remain present");
assert.match(timezone, /destination-local|destination local|America\/New_York|America\/Toronto/i, "G-A7-02 timezone regression must remain present");

console.log("Live Companion action idempotency checks passed.");
