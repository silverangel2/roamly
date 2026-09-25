import assert from "node:assert/strict";
import fs from "node:fs";
import { selectActiveTrip } from "../lib/roamly/liveCompanion.ts";

const base = {
  status: "active",
  itinerary_locked: true,
  tracking_unlocked: true,
  metadata: { timezone: "America/New_York" }
};

const trip = (id, overrides = {}) => ({
  ...base,
  id,
  start_date: "2026-09-20",
  end_date: "2026-09-24",
  created_at: "2026-09-30T00:00:00Z",
  ...overrides
});

const finalLocalDay = "2026-09-25T01:00:00Z";
assert.equal(selectActiveTrip([], finalLocalDay), null);
assert.equal(selectActiveTrip([trip("one")], finalLocalDay)?.id, "one");
assert.equal(selectActiveTrip([trip("future", { start_date: "2026-09-26" })], finalLocalDay), null);
assert.equal(selectActiveTrip([trip("completed", { status: "completed" })], finalLocalDay), null);
assert.equal(selectActiveTrip([trip("cancelled", { status: "cancelled" })], finalLocalDay), null);
assert.equal(selectActiveTrip([trip("locked", { status: "locked" }), trip("active")], finalLocalDay)?.id, "active");

const overlapping = [
  trip("z-trip", { start_date: "2026-09-21", end_date: "2026-09-25", created_at: "2026-01-01T00:00:00Z" }),
  trip("a-trip", { start_date: "2026-09-21", end_date: "2026-09-25", created_at: "2030-01-01T00:00:00Z" })
];
assert.equal(selectActiveTrip(overlapping, finalLocalDay)?.id, "a-trip", "stable ID tie-break must win");
assert.equal(selectActiveTrip([...overlapping].reverse(), finalLocalDay)?.id, "a-trip", "input order must not matter");

const moreThanTen = Array.from({ length: 25 }, (_, index) => trip(`trip-${String(index).padStart(2, "0")}`));
assert.ok(selectActiveTrip(moreThanTen, finalLocalDay), "candidate 11+ must remain eligible");

assert.equal(
  selectActiveTrip([trip("tokyo", { metadata: { timezone: "Asia/Tokyo" }, start_date: "2026-09-24", end_date: "2026-09-24" })], "2026-09-24T14:00:00Z")?.id,
  "tokyo",
  "east-of-UTC local day must remain active"
);
assert.equal(
  selectActiveTrip([trip("changed", { metadata: { timezone: "America/Los_Angeles" }, end_date: "2026-09-24" })], "2026-09-25T01:00:00Z")?.id,
  "changed",
  "destination timezone controls the local boundary"
);

const dashboard = fs.readFileSync("app/dashboard/page.tsx", "utf8");
const activation = fs.readFileSync("lib/roamly/tripActivation.ts", "utf8");
assert.match(dashboard, /selectActiveTrip\(typedTrips\)/);
assert.match(activation, /const trip = selectActiveTrip\(\(data \|\| \[\]\) as TrackingTrip\[\]\)/);
const activeTripStart = activation.indexOf("export async function getActiveOrUpcomingTrip");
const activeTripEnd = activation.indexOf("export async function getCurrentDayRecord", activeTripStart);
const activeTripFunction = activation.slice(activeTripStart, activeTripEnd);
assert.doesNotMatch(activeTripFunction, /\.limit\(10\)/);
assert.doesNotMatch(dashboard, /activeNow = liveTrips\.find/);
assert.match(fs.readFileSync("app/notifications/page.tsx", "utf8"), /getActiveOrUpcomingTrip/);
assert.match(fs.readFileSync("app/api/roamly/trips/active/route.ts", "utf8"), /getActiveOrUpcomingTrip/);
assert.match(fs.readFileSync("app/trip/[id]/live/page.tsx", "utf8"), /getTripBundle\(supabase, current\.user\.id, id\)/);

console.log("Roamly active trip selection checks passed");
