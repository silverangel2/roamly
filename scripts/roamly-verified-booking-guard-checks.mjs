// Verified-booking guard checks (2026-11-09, engine lane).
//
// THE BUG (found by the BoardUI batch-2 look pass, reproduced by its
// fixture): applyVerifiedBookingOverride matched a verified booking to
// an activity when `booking.id === activity.booking?.id`. When BOTH ids
// are absent that is `undefined === undefined` — true — so ONE id-less
// verified booking attached to EVERY unmatched stop, and every such
// stop's time earned the "Confirmed" provenance (lib/roamly/
// timeProvenance.ts: confirmed is ONLY for a real booking record —
// "No record → no Confirmed label anywhere").
//
// THE GUARD: the id path may only fire on a REAL id match — both ids
// present and equal (`booking.id != null && booking.id ===
// activity.booking?.id`). An id-less booking confirms nothing via id.
// Nothing else about the override changed: the verified-status gate,
// the title paths (pinned live by roamly-core-checks' museum case,
// where a production-shaped booking confirms its stop by exact title),
// the match ordering, and the merge/provenance stamps are untouched —
// case 4 below pins that preservation.
//
// A stop "becomes Confirmed" at this layer when the override returns it
// carrying the verified booking (booking.status "verified" + the
// booking's own times). An unmatched stop is returned as the SAME
// object, untouched.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { applyVerifiedBookingOverride } from "@/lib/roamly/liveCompanion.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const liveCompanionSrc = fs.readFileSync(path.join(root, "lib/roamly/liveCompanion.ts"), "utf8");

// Source pin: the presence guard must stay on the id path.
assert.match(
  liveCompanionSrc,
  /booking\.id != null && booking\.id === activity\.booking\?\.id/,
  "the id match must require a present booking id (the guard)"
);

// ------------------------------------------------------------------
// Case 1 — an id-less verified booking confirms NOTHING.
// Its title matches no stop, so the id path is the only path that
// could fire — exactly the path the bug lived on.
// ------------------------------------------------------------------
const idLessBooking = {
  // no id at all — the bug trigger
  title: "Unrelated Helicopter Tour",
  provider: "Email Lookback",
  reference: "HELI123",
  status: "verified",
  startTime: "2026-08-06T15:00:00-04:00",
  endTime: "2026-08-06T16:00:00-04:00"
};
const nullIdBooking = { ...idLessBooking, id: null, reference: "HELI124" };

const case1Stops = [
  // No booking record at all (activity.booking absent).
  { id: "basilica", title: "Notre-Dame Basilica", startAt: "2026-08-06T09:00:00-04:00" },
  // A booking record with no id, still stale/unverified.
  {
    id: "market",
    title: "Jean-Talon Market",
    startAt: "2026-08-06T11:00:00-04:00",
    booking: { title: "Jean-Talon Market", status: "stale", startTime: "2026-08-06T11:00:00-04:00" }
  },
  // A booking record carrying a real, different id.
  {
    id: "tower",
    title: "Montreal Tower",
    startAt: "2026-08-06T13:00:00-04:00",
    booking: { id: "booking-tower", title: "Montreal Tower", status: "estimated", startTime: "2026-08-06T13:00:00-04:00" }
  }
];

for (const booking of [idLessBooking, nullIdBooking]) {
  for (const stop of case1Stops) {
    const result = applyVerifiedBookingOverride(stop, [booking]);
    assert.equal(result, stop, `id-less verified booking must leave stop "${stop.id}" untouched`);
    assert.notEqual(result.booking?.status, "verified", `stop "${stop.id}" must not become Confirmed`);
  }
}

// ------------------------------------------------------------------
// Case 2 — a booking whose id matches a stop's booking id confirms
// exactly that stop, and only that stop.
// The matching stop's title deliberately differs from the booking's
// title, so only the id path can fire.
// ------------------------------------------------------------------
const tourBooking = {
  id: "booking-tour",
  title: "City Walking Tour",
  provider: "Email Lookback",
  reference: "WALK42",
  status: "verified",
  startTime: "2026-08-06T14:00:00-04:00",
  endTime: "2026-08-06T16:30:00-04:00"
};
const case2Stops = [
  {
    id: "walk",
    title: "Old Town on Foot", // != booking title: id path only
    startAt: "2026-08-06T13:30:00-04:00",
    endAt: "2026-08-06T15:30:00-04:00",
    booking: { id: "booking-tour", title: "Old Town on Foot", status: "stale", startTime: "2026-08-06T13:30:00-04:00" }
  },
  {
    id: "hotel",
    title: "Hotel Check-in",
    startAt: "2026-08-06T15:00:00-04:00",
    booking: { id: "booking-hotel", title: "Hotel Check-in", status: "estimated" }
  },
  { id: "market2", title: "Evening Food Market", startAt: "2026-08-06T18:00:00-04:00" }
];

const case2Results = case2Stops.map((stop) => applyVerifiedBookingOverride(stop, [tourBooking]));
const confirmedStops = case2Results.filter((stop) => stop.booking?.status === "verified");
assert.equal(confirmedStops.length, 1, "exactly one stop may be confirmed by the id-matched booking");
assert.equal(confirmedStops[0].id, "walk", "the confirmed stop is the one whose booking id matches");
assert.equal(confirmedStops[0].booking.reference, "WALK42", "the verified booking record flows into the stop");
assert.equal(confirmedStops[0].startAt, "2026-08-06T14:00:00-04:00", "the booking's own start time overrides the stale plan time");
assert.equal(confirmedStops[0].endAt, "2026-08-06T16:30:00-04:00", "the booking's own end time overrides the stale plan time");
assert.equal(case2Results[1], case2Stops[1], "a stop with a different booking id stays untouched");
assert.equal(case2Results[2], case2Stops[2], "a stop with no booking record stays untouched");

// ------------------------------------------------------------------
// Case 3 — a verified booking with a NON-matching id confirms
// nothing (its title matches no stop either).
// ------------------------------------------------------------------
const strayBooking = {
  id: "booking-nope",
  title: "Harbour Cruise",
  provider: "Email Lookback",
  reference: "BOAT99",
  status: "verified",
  startTime: "2026-08-06T17:00:00-04:00"
};
const case3Stops = [
  {
    id: "museum3",
    title: "Pointe-a-Calliere Museum",
    startAt: "2026-08-06T11:00:00-04:00",
    booking: { id: "booking-museum", title: "Pointe-a-Calliere Museum", status: "stale" }
  },
  { id: "park3", title: "Mount Royal Park", startAt: "2026-08-06T09:00:00-04:00" }
];
for (const stop of case3Stops) {
  const result = applyVerifiedBookingOverride(stop, [strayBooking]);
  assert.equal(result, stop, `non-matching booking id must leave stop "${stop.id}" untouched`);
  assert.notEqual(result.booking?.status, "verified", `stop "${stop.id}" must not become Confirmed`);
}

// ------------------------------------------------------------------
// Case 4 — PRESERVATION: the rest of the override is unchanged.
// (a) The title path still confirms: a verified booking whose id
//     matches nothing still confirms the stop whose title it exactly
//     names (the production shape pinned by roamly-core-checks).
// (b) The verified-status gate still holds: a booking that is not
//     verified never overrides, even with a matching id.
// ------------------------------------------------------------------
const titleMatched = applyVerifiedBookingOverride(
  {
    id: "museum4",
    title: "Pointe-a-Calliere Museum",
    startAt: "2026-08-06T11:00:00-04:00",
    booking: { title: "Pointe-a-Calliere Museum", status: "stale", startTime: "2026-08-06T11:00:00-04:00" }
  },
  [
    {
      id: "booking-museum-4",
      title: "Pointe-a-Calliere Museum",
      provider: "Email Lookback",
      reference: "KLOOK123",
      status: "verified",
      startTime: "2026-08-06T13:00:00-04:00"
    }
  ]
);
assert.equal(titleMatched.booking?.status, "verified", "the exact-title path still confirms its stop");
assert.equal(titleMatched.startAt, "2026-08-06T13:00:00-04:00", "the title-matched booking still supplies the time");

const unverifiedStop = {
  id: "walk5",
  title: "Old Town on Foot",
  startAt: "2026-08-06T13:30:00-04:00",
  booking: { id: "booking-tour", title: "Old Town on Foot", status: "stale" }
};
const notVerified = applyVerifiedBookingOverride(unverifiedStop, [
  { ...tourBooking, status: "estimated" }
]);
assert.equal(notVerified, unverifiedStop, "a non-verified booking never overrides, even on an id match");

console.log(
  "Roamly verified-booking guard checks passed (id-less booking confirms nothing, a real id match confirms exactly its stop, a non-matching id confirms nothing, title path and verified-status gate preserved)."
);
