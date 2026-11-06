// Companion scheduling A/B/C discrimination simulation (2026-10-31).
//
// Runs the REAL lib/roamly/tripCompanion.ts (scheduleCompanionEvents,
// unlockLiveCompanion, buildPreTripTimeline, tripHasLiveCompanionUnlock)
// against a generic fake Supabase store. Discriminates the three candidate
// explanations for "zero notifications" on a personal Montreal trip:
//   A) trip never unlocked       -> scheduler refuses, ZERO events
//   B) unlocked, only booking is CANCELLED -> trip-level events STILL
//      created (the timeline is built from start_date, bookings only add)
//   C) unlocked -> events exist; silence would then be a delivery-stack
//      question (push subscription / dispatcher), not a creation one
// Trip fixtures are shaped from the P0 audit's read-only production facts
// (personal trip Oct 30-Nov 2 2026, Saint John -> Montreal, its only
// booking row a CANCELLED QA test stay). The fake store is a test double:
// outcomes are SIMULATED at the code layer, not production reads.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.env.ROAMLY_SRC_ROOT
  ? path.resolve(process.env.ROAMLY_SRC_ROOT)
  : path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// Same vm-harness pattern as the location grant suite: transpile the REAL
// sources one module at a time, stubbing only infrastructure seams
// (admin client factory, trip-event recorder, the geonames-backed place
// resolver — labels only, never used by the scheduling logic under test).
function compileTs(rel, stubs) {
  const compiled = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sandbox = {
    exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
      return require(id);
    }
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: rel });
  return sandbox.module.exports;
}

const dateUtils = compileTs("lib/roamly/dateUtils.ts", {});
const tripMetadata = compileTs("lib/roamly/tripMetadata.ts", {
  "@/lib/roamly/dateUtils": dateUtils,
  "@/lib/roamly/placeResolver": { resolveCityPlace: () => null }
});
const testBooking = compileTs("lib/roamly/testBooking.ts", {});
const bookingTruth = compileTs("lib/roamly/bookingTruth.ts", { "@/lib/roamly/testBooking": testBooking });
const {
  scheduleCompanionEvents,
  unlockLiveCompanion,
  buildPreTripTimeline,
  tripHasLiveCompanionUnlock
} = compileTs("lib/roamly/tripCompanion.ts", {
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/crossBorder": compileTs("lib/roamly/crossBorder.ts", {}),
  "@/lib/roamly/events": { recordTripEvent: async () => ({}) },
  "@/lib/roamly/tripMetadata": tripMetadata,
  "@/lib/roamly/bookingSupersession": compileTs("lib/roamly/bookingSupersession.ts", {}),
  "@/lib/roamly/operationalScheduledEvents": compileTs("lib/roamly/operationalScheduledEvents.ts", {}),
  "@/lib/roamly/bookingTruth": bookingTruth
});

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// Generic fake Supabase over named row-arrays.
class QB {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.write = null; this.kind = null; this.orderSpec = null; }
  select() { return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  in(k, vals) { this.filters.push((r) => vals.includes(r[k])); return this; }
  order() { return this; }
  limit() { return this; }
  update(row) { this.write = row; this.kind = "update"; return this; }
  insert(rows) { this.write = rows; this.kind = "insert"; return this; }
  upsert(row) { this.write = row; this.kind = "upsert"; return this; }
  rows() { return (this.db[this.table] || []).filter((r) => this.filters.every((f) => f(r))); }
  apply() {
    if (this.kind === "insert") {
      const rows = Array.isArray(this.write) ? this.write : [this.write];
      const stored = rows.map((r) => ({ id: r.id || `row-${Math.random().toString(36).slice(2, 9)}`, ...r }));
      (this.db[this.table] = this.db[this.table] || []).push(...stored);
      return stored;
    }
    if (this.kind === "update") {
      const matched = this.rows();
      for (const r of matched) Object.assign(r, this.write);
      return matched;
    }
    if (this.kind === "upsert") {
      const key = this.write.user_id && this.write.trip_id ? null : null;
      const existing = (this.db[this.table] || []).find((r) =>
        (this.write.id && r.id === this.write.id) ||
        (this.write.stripe_checkout_session_id && r.stripe_checkout_session_id === this.write.stripe_checkout_session_id));
      if (existing) { Object.assign(existing, this.write); return [existing]; }
      const row = { id: `row-${Math.random().toString(36).slice(2, 9)}`, ...this.write };
      (this.db[this.table] = this.db[this.table] || []).push(row);
      return [row];
    }
    return this.rows();
  }
  async maybeSingle() { const r = this.apply(); return { data: r[0] ?? null, error: null }; }
  async single() { const r = this.apply(); return { data: r[0] ?? null, error: null }; }
  then(resolve) { resolve({ data: this.apply(), error: null }); }
}
function makeDb(trip, bookings) {
  const db = {
    roamly_trips: [trip],
    roamly_bookings: bookings,
    roamly_trip_companion_events: [],
    roamly_trip_events: []
  };
  db.supabase = { from: (t) => new QB(db, t) };
  return db;
}

const USER = "005f5186-1eef-4b05-9570-fdecd956e205";
const TRIP_ID = "1bcb0c8b-shaped-fixture";
const baseTrip = {
  id: TRIP_ID,
  user_id: USER,
  title: "Montreal, Canada 4-day Balanced trip",
  destination: "Montreal, Canada",
  destination_name: "Montreal, Canada",
  destination_city: "Montreal",
  destination_country: "Canada",
  origin_country: "Canada",
  start_date: "2026-10-30",
  end_date: "2026-11-02",
  status: "locked",
  itinerary_locked: true,
  tracking_unlocked: false,
  live_companion_unlocked: false,
  trip_companion_status: null,
  metadata: { planning: { destination: "Montreal", origin: "Saint John", originCountry: "Canada", destinationCountry: "Canada" } }
};
// The audit's production fact: the personal trip's only booking row is the
// CANCELLED QA test stay.
const cancelledQaBooking = {
  id: "d3b6053a-shaped-fixture",
  user_id: USER,
  trip_id: TRIP_ID,
  booking_type: "hotel",
  title: "Roamly QA Test Stay",
  provider_name: "ROAMLY QA TEST",
  booking_status: "CANCELLED",
  traveler_confirmed: true,
  confirmation_number: "TEST-RMLY-1024-MTL2",
  start_at: "2026-10-30T19:00:00+00:00",
  end_at: "2026-11-02T15:00:00+00:00",
  superseded_by_booking_id: null,
  source_type: "email",
  metadata: {}
};

// --- A: never unlocked -------------------------------------------------------
{
  const db = makeDb({ ...baseTrip }, [{ ...cancelledQaBooking }]);
  eq("A tripHasLiveCompanionUnlock is false", tripHasLiveCompanionUnlock(db.roamly_trips[0]), false);
  const result = await scheduleCompanionEvents(db.supabase, TRIP_ID);
  eq("A scheduleCompanionEvents refuses", result.ok, false);
  eq("A refusal reason is the unlock gate", result.error, "Live Trip Companion is not unlocked for this trip.");
  eq("A ZERO companion events created", db.roamly_trip_companion_events.length, 0);
}

// --- B: unlocked, cancelled-only bookings ------------------------------------
{
  const db = makeDb({ ...baseTrip, tracking_unlocked: true, live_companion_unlocked: true }, [{ ...cancelledQaBooking }]);
  const timeline = buildPreTripTimeline(db.roamly_trips[0], []);
  check("B timeline from start_date alone is non-empty", timeline.length >= 7);
  const result = await scheduleCompanionEvents(db.supabase, TRIP_ID);
  eq("B scheduleCompanionEvents succeeds when unlocked", result.ok, true);
  check("B trip-level events ARE created despite the cancelled-only booking set",
    db.roamly_trip_companion_events.length >= 7);
  eq("B zero BOOKING events (the cancelled QA stay is filtered, as designed)",
    db.roamly_trip_companion_events.filter((e) => e.booking_id).length, 0);
  check("B created types are the trip-level set (one_week_before / travel_day_started / country_info ...)",
    db.roamly_trip_companion_events.some((e) => e.event_type === "travel_day_started") &&
    db.roamly_trip_companion_events.some((e) => e.event_type === "one_week_before"));
  eq("B trip_companion_status becomes scheduled", db.roamly_trips[0].trip_companion_status, "scheduled");

  // B2: a confirmed booking adds its reminder on top — the filter is
  // booking-scoped, not timeline-scoped.
  const db2 = makeDb(
    { ...baseTrip, tracking_unlocked: true, live_companion_unlocked: true },
    [{ ...cancelledQaBooking }, {
      ...cancelledQaBooking, id: "real-hotel", title: "Empire Suites",
      booking_status: "booked", confirmation_number: "AGODA-REAL-1", provider_name: "Agoda",
      source_type: "email"
    }]
  );
  const result2 = await scheduleCompanionEvents(db2.supabase, TRIP_ID);
  eq("B2 scheduling succeeds with a confirmed booking present", result2.ok, true);
  eq("B2 exactly one booking event (the confirmed hotel only)",
    db2.roamly_trip_companion_events.filter((e) => e.booking_id).length, 1);
}

// --- C: the unlock call itself is the single arming step ----------------------
{
  const db = makeDb({ ...baseTrip }, [{ ...cancelledQaBooking }]);
  const unlock = await unlockLiveCompanion(db.supabase, TRIP_ID, "paid");
  eq("C unlockLiveCompanion succeeds", unlock.ok, true);
  eq("C tracking_unlocked set", db.roamly_trips[0].tracking_unlocked, true);
  eq("C live_companion_unlocked set", db.roamly_trips[0].live_companion_unlocked, true);
  check("C events created by the unlock call itself (no second step needed)",
    db.roamly_trip_companion_events.length >= 7);
}

console.log(`\n${passed} companion scheduling simulation checks passed`);
