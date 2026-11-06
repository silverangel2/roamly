// roamly-passpage-unified-resolver-checks.mjs — Roamly readiness
// D4 (2026-10-31): the trip PASS page (app/trip/[id]/pass/page.tsx)
// must compute its day from THE SAME shared destination-local
// resolver as Live eligibility and the displayed trip day —
// resolveLiveEligibilityTimezone in lib/roamly/liveEligibility.ts
// (metadata zone -> verified destination registry -> documented
// UTC fallback), fed with the same server zone override
// (resolveTripTimezoneServer) eligibility and getCurrentTripDay
// receive. Before D4 the pass page resolved its zone metadata-only
// (timezoneFromTripMetadata), so a Montreal trip with
// planning.timezone NULL was pass-dated in UTC and showed the next
// day from 20:00 destination-local time.
//
// The pass page is a server component, so — at the level this
// repo's suites use — this suite exercises the EXACT composition
// the page now calls (passPageDay below mirrors the page's call
// site line for line: same eligibility-trip adaptation, same
// server override, same zoneForMath fed into getTripDayFromDate,
// same liveEligibilityLocalDate, same passDate / nowParts
// derivations) against the gate's tripday fixtures
// (scripts/roamly-tripday-unified-resolver-checks.mjs), and pins
// the page's source shape statically.
//
// DETERMINISM LAW (same as the gate suite): every instant is a
// fixed UTC timestamp, every expectation is derived from the
// eligibility explanation's destination-local date, and no
// assertion consults the process timezone. Run under
// TZ=America/Moncton AND TZ=UTC; counts must be identical.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs --import ./scripts/roamly-test-server-only-register.mjs scripts/roamly-passpage-unified-resolver-checks.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTripDayFromDate } from "@/lib/itinerary.ts";
import {
  explainLiveCompanionEligibility,
  liveEligibilityLocalDate,
  resolveLiveEligibilityTimezone
} from "@/lib/roamly/liveEligibility.ts";
import { getCurrentTripDay } from "@/lib/roamly/tripActivation.ts";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer.ts";
import { addCalendarDays, instantStringToLocal } from "@/lib/roamly/engine/time.ts";
import { getTripDaysCount, getTripDestinationLabel } from "@/lib/roamly/tripMetadata.ts";
import { customerTripLifecycleState } from "@/lib/roamly/liveCompanion.ts";

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

// THE PAGE'S EXACT COMPOSITION (app/trip/[id]/pass/page.tsx, D4):
// adapt bundle.data.trip at the call site, resolve the server zone,
// feed it as the shared resolver's override, and derive every
// day/timezone value from that one resolution at one instant.
function passPageDay(trip, instant) {
  const eligibilityTrip = {
    metadata: trip.metadata,
    destination: getTripDestinationLabel(trip),
    destination_name: trip.destination_name,
    destination_city: trip.destination_city
  };
  const serverZone = resolveTripTimezoneServer(eligibilityTrip).zone;
  const eligibilityOptions = { zoneOverride: serverZone };
  const timezone = resolveLiveEligibilityTimezone(eligibilityTrip, eligibilityOptions).zoneForMath;
  const daysCount = getTripDaysCount(trip);
  const nowInstant = instant instanceof Date ? instant.toISOString() : instant;
  const currentDay = getTripDayFromDate(trip.start_date, daysCount || null, timezone, new Date(nowInstant));
  const todayLocal = liveEligibilityLocalDate(eligibilityTrip, nowInstant, eligibilityOptions);
  const passDate = trip.start_date
    ? addCalendarDays(trip.start_date, Math.max(0, currentDay - 1))
    : todayLocal;
  const nowParts = instantStringToLocal(nowInstant, timezone);
  return { eligibilityTrip, eligibilityOptions, timezone, daysCount, currentDay, todayLocal, passDate, nowParts };
}

// Independent oracles (plain calendar arithmetic on ISO dates;
// shares NO code with the functions under test).
function dayFromLocalDate(startDate, localDate, daysCount) {
  const start = Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10));
  const today = Date.UTC(+localDate.slice(0, 4), +localDate.slice(5, 7) - 1, +localDate.slice(8, 10));
  const diff = Math.floor((today - start) / 86_400_000) + 1;
  return Math.min(Math.max(diff, 1), daysCount);
}
function datePlusDays(date, n) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// THE AGREEMENT: at one instant, the pass page's day, its local
// "today", its pass date, and its now-parts must all agree with
// the eligibility window's destination-local today for the same
// trip, and with the displayed day from getCurrentTripDay.
function assertAgreement(label, trip, instant) {
  const pass = passPageDay(trip, instant);
  const explanation = explainLiveCompanionEligibility(trip, instant, pass.eligibilityOptions);
  eq(`${label}: pass todayLocal is the eligibility local date (${explanation.localDate} in ${explanation.zone})`,
    pass.todayLocal, explanation.localDate);
  eq(`${label}: pass timezone is the eligibility zoneForMath`, pass.timezone, explanation.zone);
  eq(`${label}: pass day agrees with eligibility today`,
    pass.currentDay, dayFromLocalDate(trip.start_date, explanation.localDate, pass.daysCount));
  eq(`${label}: pass day agrees with the displayed day (getCurrentTripDay)`,
    pass.currentDay, getCurrentTripDay(trip, instant));
  eq(`${label}: pass date is the calendar date of the pass day`,
    pass.passDate, datePlusDays(trip.start_date, pass.currentDay - 1));
  eq(`${label}: nowParts date is the pass page's today`, pass.nowParts.date, pass.todayLocal);
  if (explanation.localDate >= trip.start_date && explanation.localDate <= trip.end_date) {
    eq(`${label}: in window, pass date IS eligibility today`, pass.passDate, explanation.localDate);
  }
  return { pass, explanation };
}

// Gate fixtures (verbatim shapes from the tripday suite).
const liveTrip = (patch) => ({
  status: "generated",
  itinerary_locked: true,
  itinerary_status: null,
  itinerary_generated_at: "2026-10-05T00:00:00Z",
  tracking_unlocked: true,
  live_companion_unlocked: true,
  ...patch
});
const MONTREAL = liveTrip({
  start_date: "2026-10-30",
  end_date: "2026-11-02",
  days_count: 4,
  metadata: { planning: { timezone: null, destination: "Montreal, Canada" } },
  destination: "Montreal, Canada",
  destination_name: "Montreal, Canada",
  destination_city: "Montreal"
});

// --- 0. Wiring: the page imports the resolver — no metadata-only --
{
  const src = read("app/trip/[id]/pass/page.tsx");
  check("wiring: page imports resolveLiveEligibilityTimezone from liveEligibility",
    src.includes('from "@/lib/roamly/liveEligibility"') && src.includes("resolveLiveEligibilityTimezone"));
  check("wiring: page calls resolveLiveEligibilityTimezone for its timezone",
    src.includes("const timezone = resolveLiveEligibilityTimezone(eligibilityTrip, eligibilityOptions).zoneForMath;"));
  check("wiring: page feeds the resolver the server override (resolveTripTimezoneServer)",
    src.includes("const serverZone = resolveTripTimezoneServer(eligibilityTrip).zone;") &&
    src.includes("const eligibilityOptions = { zoneOverride: serverZone };"));
  check("wiring: page no longer calls timezoneFromTripMetadata anywhere",
    !src.includes("timezoneFromTripMetadata"));
  check("wiring: page's day arithmetic receives the resolver zone and the page's one instant",
    src.includes("getTripDayFromDate(bundle.data.trip.start_date, daysCount || null, timezone, new Date(nowInstant))"));
  check("wiring: page's today comes from liveEligibilityLocalDate on the same trip + options",
    src.includes("liveEligibilityLocalDate(eligibilityTrip, nowInstant, eligibilityOptions)"));
  check("wiring: page's now-parts are computed in the resolver zone",
    src.includes("instantStringToLocal(nowInstant, timezone)"));
  check("wiring: page's lifecycle window receives the resolver zone and the same instant",
    src.includes("metadata: bundle.data.trip.metadata,\n    timezone\n  }, nowInstant)"));
  const resolution = resolveLiveEligibilityTimezone(MONTREAL);
  eq("resolver: Montreal (metadata NULL) resolves via the registry", resolution.zone, "America/Toronto");
}

// --- (a) Local midnight boundaries in the destination zone --------
for (const [label, instant, wantDay, wantDate] of [
  ["Toronto boundary: Oct 29 23:59 EDT (before start, clamped)", "2026-10-30T03:59:00Z", 1, "2026-10-29"],
  ["Toronto boundary: Oct 30 00:00 EDT (trip starts)", "2026-10-30T04:00:00Z", 1, "2026-10-30"],
  ["Toronto boundary: Oct 30 21:00 EDT — UTC already Oct 31", "2026-10-31T01:00:00Z", 1, "2026-10-30"],
  ["Toronto boundary: Oct 30 23:59 EDT", "2026-10-31T03:59:00Z", 1, "2026-10-30"],
  ["Toronto boundary: Oct 31 00:00 EDT", "2026-10-31T04:00:00Z", 2, "2026-10-31"],
  ["Toronto boundary: Nov 1 23:59 EST", "2026-11-02T04:59:00Z", 3, "2026-11-01"],
  ["Toronto boundary: Nov 2 00:00 EST (last day starts)", "2026-11-02T05:00:00Z", 4, "2026-11-02"]
]) {
  const { pass, explanation } = assertAgreement(label, MONTREAL, instant);
  eq(`${label}: eligibility local date`, explanation.localDate, wantDate);
  eq(`${label}: pass day`, pass.currentDay, wantDay);
  eq(`${label}: pass timezone`, pass.timezone, "America/Toronto");
}
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
  const { pass, explanation } = assertAgreement(label, SYDNEY_MIDNIGHT, instant);
  eq(`${label}: eligibility zone is Australia/Sydney`, explanation.zone, "Australia/Sydney");
  eq(`${label}: eligibility local date`, explanation.localDate, wantDate);
  eq(`${label}: pass day`, pass.currentDay, wantDay);
}

// --- (b) DST transitions -------------------------------------------
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
  const { pass } = assertAgreement(label, TORONTO_SPRING, instant);
  eq(`${label}: pass day`, pass.currentDay, wantDay);
}
for (const [label, instant, wantDay] of [
  ["Toronto fall: Oct 31 23:59 EDT", "2026-11-01T03:59:00Z", 2],
  ["Toronto fall: Nov 1 00:00 EDT", "2026-11-01T04:00:00Z", 3],
  ["Toronto fall: Nov 1 01:30 EDT (first 01:30)", "2026-11-01T05:30:00Z", 3],
  ["Toronto fall: Nov 1 01:30 EST (repeated 01:30)", "2026-11-01T06:30:00Z", 3],
  ["Toronto fall: Nov 1 23:59 EST (25-hour day ends)", "2026-11-02T04:59:00Z", 3]
]) {
  const { pass } = assertAgreement(label, MONTREAL, instant);
  eq(`${label}: pass day`, pass.currentDay, wantDay);
}
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
  const { pass } = assertAgreement(label, SYDNEY_SPRING, instant);
  eq(`${label}: pass day`, pass.currentDay, wantDay);
}
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
  const { pass } = assertAgreement(label, SYDNEY_FALL, instant);
  eq(`${label}: pass day`, pass.currentDay, wantDay);
}

// --- (c) The owner's exact case ------------------------------------
// Montreal, Nov 2 19:00 EST (= 2026-11-03T00:00:00Z): UTC date is
// Nov 3, but destination-local today is Nov 2 — eligibility today
// Nov 2, pass Day 4, pass date Nov 2.
{
  const instant = "2026-11-03T00:00:00Z";
  const { pass, explanation } = assertAgreement("owner case Nov 2 19:00 EST", MONTREAL, instant);
  eq("owner case: eligibility zone is America/Toronto (registry, metadata was NULL)", explanation.zone, "America/Toronto");
  eq("owner case: eligibility today is Nov 2, not the UTC Nov 3", explanation.localDate, "2026-11-02");
  check("owner case: trip is still eligible at Nov 2 19:00 EST", explanation.eligible && explanation.inWindow);
  eq("owner case: pass day is Day 4 (the last day), never a UTC day 5", pass.currentDay, 4);
  eq("owner case: pass date is Nov 2", pass.passDate, "2026-11-02");
  eq("owner case: pass todayLocal is Nov 2", pass.todayLocal, "2026-11-02");
  eq("owner case: nowParts clock is 19:00 EST", pass.nowParts.clock, "19:00");
  eq("owner case: lifecycle at the same instant + resolver zone is still active (not completed)",
    customerTripLifecycleState({
      status: MONTREAL.status,
      itineraryStatus: MONTREAL.itinerary_status,
      startDate: MONTREAL.start_date,
      endDate: MONTREAL.end_date,
      metadata: MONTREAL.metadata,
      timezone: pass.timezone
    }, instant), "active");
  const evening = assertAgreement("owner case eve Nov 1 21:00 EST", MONTREAL, "2026-11-02T02:00:00Z");
  eq("owner case eve: eligibility today is Nov 1", evening.explanation.localDate, "2026-11-01");
  eq("owner case eve: pass day is Day 3, not the UTC Day 4", evening.pass.currentDay, 3);
  eq("owner case eve: pass date is Nov 1", evening.pass.passDate, "2026-11-01");
  const after = assertAgreement("owner case end Nov 3 00:00 EST", MONTREAL, "2026-11-03T05:00:00Z");
  eq("owner case end: eligibility today is Nov 3", after.explanation.localDate, "2026-11-03");
  check("owner case end: no longer eligible after destination midnight", !after.explanation.eligible && after.explanation.reasons.includes("after_window"));
  eq("owner case end: pass day stays clamped at Day 4, in agreement", after.pass.currentDay, 4);
}

// --- Resolution precedence, through the pass composition -----------
// Stored metadata zone wins over the registry.
{
  const stored = liveTrip({
    ...MONTREAL,
    metadata: { planning: { timezone: "America/Halifax", destination: "Montreal, Canada" } }
  });
  const { pass, explanation } = assertAgreement("metadata wins", stored, "2026-11-03T00:00:00Z");
  eq("metadata wins: zone is the stored America/Halifax", explanation.zone, "America/Halifax");
  eq("metadata wins: pass timezone is the stored zone", pass.timezone, "America/Halifax");
  eq("metadata wins: local date is Nov 2 in Halifax", explanation.localDate, "2026-11-02");
  eq("metadata wins: pass day", pass.currentDay, 4);
}
// Seeds-only destination (Halifax: server seeds, NOT the client-safe
// registry): the pass composition resolves it via the server
// override exactly like eligibility/displayed day do.
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
  const { pass, explanation } = assertAgreement("seeds-only Halifax", halifax, "2026-11-02T01:00:00Z");
  eq("seeds-only: pass timezone is America/Halifax via the server override", pass.timezone, "America/Halifax");
  eq("seeds-only: eligibility today via server override is Nov 1", explanation.localDate, "2026-11-01");
  eq("seeds-only: pass day is Day 3, not UTC Day 4", pass.currentDay, 3);
  eq("seeds-only: pass date is Nov 1", pass.passDate, "2026-11-01");
}
// Genuinely unknown zone: documented UTC fallback for math, and the
// pass day follows the same fallback, never the process zone.
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
  const { pass, explanation } = assertAgreement("unknown fallback", unknownTrip, "2026-11-02T12:00:00Z");
  eq("unknown fallback: pass timezone is the documented UTC fallback", pass.timezone, "UTC");
  eq("unknown fallback: eligibility local date is the UTC date", explanation.localDate, "2026-11-02");
  check("unknown fallback: eligible on Nov 2 UTC (in window)", explanation.eligible);
  eq("unknown fallback: pass day", pass.currentDay, 4);
}

console.log(`${passed} pass-page unified resolver checks passed.`);
