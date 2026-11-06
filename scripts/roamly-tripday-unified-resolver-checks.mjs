// roamly-tripday-unified-resolver-checks.mjs — Roamly FINAL
// RELEASE GATE, item 2 (2026-10-31): the displayed current trip day
// (getCurrentTripDay in lib/roamly/tripActivation.ts) must resolve
// the trip's zone through THE SAME destination-local resolver the
// Live eligibility window uses (resolveLiveEligibilityTimezone in
// lib/roamly/liveEligibility.ts: metadata zone -> verified registry
// -> documented UTC fallback), fed with the same server zone
// override eligibility receives in this file. Before this item,
// getCurrentTripDay read the zone from trip metadata ONLY, so a
// Montreal trip with planning.timezone NULL was day-numbered in
// UTC and showed the next day from 20:00 destination-local time.
//
// DETERMINISM LAW (same as the live-eligibility suite): every
// instant is a fixed UTC timestamp, every expectation is derived
// from the eligibility explanation's destination-local date, and
// no assertion consults the process timezone. The suite is run
// under TZ=America/Moncton AND TZ=UTC and must produce identical
// counts in both — that identity is the item-2 fix, proven.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs --import ./scripts/roamly-test-server-only-register.mjs scripts/roamly-tripday-unified-resolver-checks.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  explainLiveCompanionEligibility,
  resolveLiveEligibilityTimezone
} from "@/lib/roamly/liveEligibility.ts";
import { getCurrentDayRecord, getCurrentTripDay } from "@/lib/roamly/tripActivation.ts";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// Independent oracle: the 1-based day number that a destination-
// local calendar date implies for a trip — plain date arithmetic
// on the eligibility explanation's localDate, clamped exactly the
// way the display clamps (first..last trip day). This shares NO
// code with getCurrentTripDay's own math.
function dayFromLocalDate(startDate, localDate, daysCount) {
  const start = Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10));
  const today = Date.UTC(+localDate.slice(0, 4), +localDate.slice(5, 7) - 1, +localDate.slice(8, 10));
  const diff = Math.floor((today - start) / 86_400_000) + 1;
  return Math.min(Math.max(diff, 1), daysCount);
}

// THE AGREEMENT: at one instant, the displayed day from
// getCurrentTripDay must equal the day implied by the eligibility
// window's destination-local "today" for the same trip.
function assertAgreement(label, trip, instant, options) {
  const explanation = explainLiveCompanionEligibility(trip, instant, options);
  const displayed = getCurrentTripDay(trip, instant);
  eq(`${label}: displayed day agrees with eligibility today (${explanation.localDate} in ${explanation.zone})`,
    displayed, dayFromLocalDate(trip.start_date, explanation.localDate, trip.days_count));
  return explanation;
}

// A live-ready trip shape (the eligibility fields are inert for
// getCurrentTripDay, which reads only start/days/destination/
// metadata — the same object serves both sides of the agreement).
const liveTrip = (patch) => ({
  status: "generated",
  itinerary_locked: true,
  itinerary_status: null,
  itinerary_generated_at: "2026-10-05T00:00:00Z",
  tracking_unlocked: true,
  live_companion_unlocked: true,
  ...patch
});

// The owner's production Montreal shape (production read
// 2026-10-31): Oct 30 - Nov 2, 2026 (4 days), destination Montreal,
// planning.timezone NULL — the registry must supply America/Toronto.
const MONTREAL = liveTrip({
  start_date: "2026-10-30",
  end_date: "2026-11-02",
  days_count: 4,
  metadata: { planning: { timezone: null, destination: "Montreal, Canada" } },
  destination: "Montreal, Canada",
  destination_name: "Montreal, Canada",
  destination_city: "Montreal"
});

// --- 0. Wiring: one resolver, imported — not copied ---------------
{
  eq("resolver is exported from liveEligibility", typeof resolveLiveEligibilityTimezone, "function");
  const src = read("lib/roamly/tripActivation.ts");
  const fnStart = src.indexOf("export function getCurrentTripDay");
  const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart));
  check("wiring: getCurrentTripDay calls resolveLiveEligibilityTimezone (import, single source)",
    fnBody.includes("resolveLiveEligibilityTimezone("));
  check("wiring: getCurrentTripDay feeds it the same server override eligibility gets",
    fnBody.includes("eligibilityOptionsForTrip(trip)"));
  check("wiring: getCurrentTripDay no longer reads the zone metadata-only",
    !fnBody.includes("timezoneFromTripMetadata"));
  check("wiring: getCurrentDayRecord forwards its instant into getCurrentTripDay",
    src.includes("getCurrentTripDay(trip, now)"));
  check("wiring: activateTripIfNearby judges the day at the same instant as eligibility (processingNow)",
    src.includes("getCurrentDayRecord(supabase, trip, processingNow)"));
  const resolution = resolveLiveEligibilityTimezone(MONTREAL);
  eq("resolver: Montreal (metadata NULL) resolves via the registry", resolution.zone, "America/Toronto");
  eq("resolver: Montreal zoneForMath is the registry zone", resolution.zoneForMath, "America/Toronto");
}

// --- (a) Local midnight boundaries in the destination zone --------
// America/Toronto (EDT, UTC-4 until Nov 1): destination-local
// midnight is 04:00Z, then 05:00Z after the fall-back.
for (const [label, instant, wantDay, wantDate] of [
  ["Toronto boundary: Oct 29 23:59 EDT (before start, clamped)", "2026-10-30T03:59:00Z", 1, "2026-10-29"],
  ["Toronto boundary: Oct 30 00:00 EDT (trip starts)", "2026-10-30T04:00:00Z", 1, "2026-10-30"],
  ["Toronto boundary: Oct 30 21:00 EDT — UTC already Oct 31", "2026-10-31T01:00:00Z", 1, "2026-10-30"],
  ["Toronto boundary: Oct 30 23:59 EDT", "2026-10-31T03:59:00Z", 1, "2026-10-30"],
  ["Toronto boundary: Oct 31 00:00 EDT", "2026-10-31T04:00:00Z", 2, "2026-10-31"],
  ["Toronto boundary: Nov 1 23:59 EST", "2026-11-02T04:59:00Z", 3, "2026-11-01"],
  ["Toronto boundary: Nov 2 00:00 EST (last day starts)", "2026-11-02T05:00:00Z", 4, "2026-11-02"]
]) {
  const x = assertAgreement(label, MONTREAL, instant);
  eq(`${label}: eligibility local date`, x.localDate, wantDate);
  eq(`${label}: displayed day`, getCurrentTripDay(MONTREAL, instant), wantDay);
}
// Australia/Sydney (southern hemisphere; AEDT, UTC+11 in October):
// destination-local midnight is 13:00Z.
const SYDNEY_MIDNIGHT = liveTrip({
  start_date: "2026-10-09",
  end_date: "2026-10-12",
  days_count: 4,
  metadata: { planning: { timezone: null } },
  destination: "Sydney, Australia",
  destination_name: "Sydney, Australia",
  destination_city: "Sydney"
});
for (const [label, instant, wantDay, wantDate] of [
  ["Sydney boundary: Oct 10 23:59 AEDT", "2026-10-10T12:59:00Z", 2, "2026-10-10"],
  ["Sydney boundary: Oct 11 00:00 AEDT — UTC still Oct 10", "2026-10-10T13:00:00Z", 3, "2026-10-11"]
]) {
  const x = assertAgreement(label, SYDNEY_MIDNIGHT, instant);
  eq(`${label}: eligibility zone is Australia/Sydney`, x.zone, "Australia/Sydney");
  eq(`${label}: eligibility local date`, x.localDate, wantDate);
  eq(`${label}: displayed day`, getCurrentTripDay(SYDNEY_MIDNIGHT, instant), wantDay);
}

// --- (b) DST transitions -------------------------------------------
// Spring-forward, America/Toronto: 2026-03-08 02:00 EST -> 03:00
// EDT (07:00Z); the local day has 23 hours.
const TORONTO_SPRING = liveTrip({
  start_date: "2026-03-07",
  end_date: "2026-03-09",
  days_count: 3,
  metadata: { planning: { timezone: null } },
  destination: "Toronto, Canada",
  destination_name: "Toronto, Canada",
  destination_city: "Toronto"
});
for (const [label, instant, wantDay] of [
  ["Toronto spring: Mar 7 23:59 EST", "2026-03-08T04:59:00Z", 1],
  ["Toronto spring: Mar 8 00:00 EST", "2026-03-08T05:00:00Z", 2],
  ["Toronto spring: Mar 8 01:59 EST (last instant before the gap)", "2026-03-08T06:59:00Z", 2],
  ["Toronto spring: Mar 8 03:00 EDT (02:00 never occurs)", "2026-03-08T07:00:00Z", 2],
  ["Toronto spring: Mar 8 23:59 EDT (23-hour day ends)", "2026-03-09T03:59:00Z", 2],
  ["Toronto spring: Mar 9 00:00 EDT", "2026-03-09T04:00:00Z", 3]
]) {
  assertAgreement(label, TORONTO_SPRING, instant);
  eq(`${label}: displayed day`, getCurrentTripDay(TORONTO_SPRING, instant), wantDay);
}
// Fall-back, America/Toronto: 2026-11-01 02:00 EDT -> 01:00 EST;
// 01:30 occurs twice and the local day has 25 hours. (The Montreal
// trip spans this transition.)
for (const [label, instant, wantDay] of [
  ["Toronto fall: Oct 31 23:59 EDT", "2026-11-01T03:59:00Z", 2],
  ["Toronto fall: Nov 1 00:00 EDT", "2026-11-01T04:00:00Z", 3],
  ["Toronto fall: Nov 1 01:30 EDT (first 01:30)", "2026-11-01T05:30:00Z", 3],
  ["Toronto fall: Nov 1 01:30 EST (repeated 01:30)", "2026-11-01T06:30:00Z", 3],
  ["Toronto fall: Nov 1 23:59 EST (25-hour day ends)", "2026-11-02T04:59:00Z", 3]
]) {
  assertAgreement(label, MONTREAL, instant);
  eq(`${label}: displayed day`, getCurrentTripDay(MONTREAL, instant), wantDay);
}
// Spring-forward, Australia/Sydney (southern hemisphere, opposite
// season): 2026-10-04 02:00 AEST -> 03:00 AEDT (16:00Z Oct 3);
// the local day has 23 hours.
const SYDNEY_SPRING = liveTrip({
  start_date: "2026-10-03",
  end_date: "2026-10-05",
  days_count: 3,
  metadata: { planning: { timezone: null } },
  destination: "Sydney, Australia",
  destination_name: "Sydney, Australia",
  destination_city: "Sydney"
});
for (const [label, instant, wantDay] of [
  ["Sydney spring: Oct 3 23:59 AEST", "2026-10-03T13:59:00Z", 1],
  ["Sydney spring: Oct 4 00:00 AEST", "2026-10-03T14:00:00Z", 2],
  ["Sydney spring: Oct 4 01:59 AEST (last instant before the gap)", "2026-10-03T15:59:00Z", 2],
  ["Sydney spring: Oct 4 03:00 AEDT (02:00 never occurs)", "2026-10-03T16:00:00Z", 2],
  ["Sydney spring: Oct 4 23:59 AEDT (23-hour day ends)", "2026-10-04T12:59:00Z", 2],
  ["Sydney spring: Oct 5 00:00 AEDT", "2026-10-04T13:00:00Z", 3]
]) {
  assertAgreement(label, SYDNEY_SPRING, instant);
  eq(`${label}: displayed day`, getCurrentTripDay(SYDNEY_SPRING, instant), wantDay);
}
// Fall-back, Australia/Sydney: 2026-04-05 03:00 AEDT -> 02:00 AEST
// (16:00Z Apr 4); 02:30 occurs twice, the local day has 25 hours,
// and Sydney's transition dates differ from Toronto's entirely.
const SYDNEY_FALL = liveTrip({
  start_date: "2026-04-04",
  end_date: "2026-04-06",
  days_count: 3,
  metadata: { planning: { timezone: null } },
  destination: "Sydney, Australia",
  destination_name: "Sydney, Australia",
  destination_city: "Sydney"
});
for (const [label, instant, wantDay] of [
  ["Sydney fall: Apr 4 23:59 AEDT", "2026-04-04T12:59:00Z", 1],
  ["Sydney fall: Apr 5 00:00 AEDT", "2026-04-04T13:00:00Z", 2],
  ["Sydney fall: Apr 5 02:30 AEDT (first 02:30)", "2026-04-04T15:30:00Z", 2],
  ["Sydney fall: Apr 5 02:30 AEST (repeated 02:30)", "2026-04-04T16:30:00Z", 2],
  ["Sydney fall: Apr 5 23:59 AEST (25-hour day ends)", "2026-04-05T13:59:00Z", 2],
  ["Sydney fall: Apr 6 00:00 AEST", "2026-04-05T14:00:00Z", 3]
]) {
  assertAgreement(label, SYDNEY_FALL, instant);
  eq(`${label}: displayed day`, getCurrentTripDay(SYDNEY_FALL, instant), wantDay);
}

// --- (c) The owner's exact case ------------------------------------
// Montreal trip, 2026-11-02 19:00 EST (= 2026-11-03T00:00:00Z):
// the UTC date is Nov 3 — past end_date under the old metadata/UTC
// gates — but destination-local "today" is still Nov 2, the trip is
// still eligible, and the displayed day is its last day, Day 4.
{
  const instant = "2026-11-03T00:00:00Z";
  const x = assertAgreement("owner case Nov 2 19:00 EST", MONTREAL, instant);
  eq("owner case: eligibility zone is America/Toronto (registry, metadata was NULL)", x.zone, "America/Toronto");
  eq("owner case: eligibility today is Nov 2, not the UTC Nov 3", x.localDate, "2026-11-02");
  check("owner case: trip is still eligible at Nov 2 19:00 EST", x.eligible && x.inWindow);
  eq("owner case: displayed day is Day 4 (the last day), never a UTC day 5", getCurrentTripDay(MONTREAL, instant), 4);
  eq("owner case: Date-object instant gives the identical day", getCurrentTripDay(MONTREAL, new Date(instant)), 4);
  // The evening before, where the old UTC numbering visibly ran a
  // day ahead: Nov 1 21:00 EST is Nov 2 in UTC.
  const evening = assertAgreement("owner case eve Nov 1 21:00 EST", MONTREAL, "2026-11-02T02:00:00Z");
  eq("owner case eve: eligibility today is Nov 1", evening.localDate, "2026-11-01");
  eq("owner case eve: displayed day is Day 3, not the UTC Day 4", getCurrentTripDay(MONTREAL, "2026-11-02T02:00:00Z"), 3);
  // And the trip ends exactly at destination-local midnight.
  const after = assertAgreement("owner case end Nov 3 00:00 EST", MONTREAL, "2026-11-03T05:00:00Z");
  eq("owner case end: eligibility today is Nov 3", after.localDate, "2026-11-03");
  check("owner case end: no longer eligible after destination midnight", !after.eligible && after.reasons.includes("after_window"));
  eq("owner case end: displayed day stays clamped at Day 4, in agreement", getCurrentTripDay(MONTREAL, "2026-11-03T05:00:00Z"), 4);
}

// --- Resolution precedence, through BOTH surfaces ------------------
// Stored metadata zone wins over the registry (Halifax stored,
// Montreal destination): Nov 2 20:00 AST = 2026-11-03T00:00:00Z.
{
  const stored = liveTrip({
    ...MONTREAL,
    metadata: { planning: { timezone: "America/Halifax", destination: "Montreal, Canada" } }
  });
  const x = assertAgreement("metadata wins", stored, "2026-11-03T00:00:00Z");
  eq("metadata wins: zone is the stored America/Halifax", x.zone, "America/Halifax");
  eq("metadata wins: local date is Nov 2 in Halifax", x.localDate, "2026-11-02");
  eq("metadata wins: displayed day", getCurrentTripDay(stored, "2026-11-03T00:00:00Z"), 4);
}
// Seeds-only destination (Halifax is in the server destination
// seeds, NOT in the client-safe recommended-places registry): the
// activation eligibility path resolves it via the server override,
// and the displayed day now resolves identically — Nov 1 21:00 AST
// is Nov 2 in UTC, so a UTC day would read Day 4, not Day 3.
{
  const halifax = liveTrip({
    start_date: "2026-10-30",
    end_date: "2026-11-02",
    days_count: 4,
    metadata: { planning: { timezone: null } },
    destination: "Halifax, Canada",
    destination_name: "Halifax, Canada",
    destination_city: "Halifax"
  });
  const serverZone = resolveTripTimezoneServer({
    metadata: halifax.metadata,
    destination: halifax.destination,
    destination_name: halifax.destination_name,
    destination_city: halifax.destination_city
  }).zone;
  eq("seeds-only: server resolver gives America/Halifax", serverZone, "America/Halifax");
  const x = assertAgreement("seeds-only Halifax", halifax, "2026-11-02T01:00:00Z", { zoneOverride: serverZone });
  eq("seeds-only: eligibility today via server override is Nov 1", x.localDate, "2026-11-01");
  eq("seeds-only: displayed day matches the server-resolved zone (Day 3, not UTC Day 4)",
    getCurrentTripDay(halifax, "2026-11-02T01:00:00Z"), 3);
}
// Genuinely unknown zone: the documented fallback — UTC for math,
// reported unknown — and the displayed day follows the same
// fallback, deterministically, never the process zone.
{
  const unknownTrip = liveTrip({
    start_date: "2026-10-30",
    end_date: "2026-11-02",
    days_count: 4,
    metadata: { planning: { timezone: null } },
    destination: "Nowhereville",
    destination_name: "Nowhereville",
    destination_city: "Nowhereville"
  });
  const resolution = resolveLiveEligibilityTimezone(unknownTrip);
  eq("unknown: resolver reports unknown", resolution.source, "unknown");
  eq("unknown: documented fallback zoneForMath is UTC", resolution.zoneForMath, "UTC");
  const x = assertAgreement("unknown fallback", unknownTrip, "2026-11-02T12:00:00Z");
  eq("unknown fallback: eligibility local date is the UTC date", x.localDate, "2026-11-02");
  check("unknown fallback: eligible on Nov 2 UTC (in window)", x.eligible);
  eq("unknown fallback: displayed day", getCurrentTripDay(unknownTrip, "2026-11-02T12:00:00Z"), 4);
}

// --- The sole direct caller, at runtime -----------------------------
// getCurrentDayRecord looks the day row up by the unified day
// number at the instant it is given.
{
  const capture = {};
  const query = {
    select() { return query; },
    eq(column, value) { if (column === "day_number") capture.dayNumber = value; return query; },
    async maybeSingle() { return { data: { id: "day-row", trip_id: "t", day_number: capture.dayNumber, date: null, title: null, summary: null } }; }
  };
  const fakeSupabase = { from() { return query; } };
  const record = await getCurrentDayRecord(fakeSupabase, MONTREAL, "2026-11-03T00:00:00Z");
  eq("caller: getCurrentDayRecord at Nov 2 19:00 EST looks up Day 4", record.dayNumber, 4);
  eq("caller: getCurrentDayRecord returns the row for that day", record.day?.day_number, 4);
  const eve = await getCurrentDayRecord(fakeSupabase, MONTREAL, "2026-11-02T02:00:00Z");
  eq("caller: getCurrentDayRecord at Nov 1 21:00 EST looks up Day 3", eve.dayNumber, 3);
}

console.log(`${passed} trip-day unified resolver checks passed.`);
