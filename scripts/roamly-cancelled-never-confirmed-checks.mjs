// Cancelled-never-Confirmed checks (defect X1 regression suite).
//
// A booking that was confirmed-shaped and is then cancelled must never
// remain displayed as Confirmed — on the truth predicate, the itinerary
// stamp (write path AND read-path reconcile), the place-detail badge,
// or persisted notifications.
//
// Levels, honestly:
//  - Wallet cancel entry point: driven END-TO-END against the real
//    cancelTripBooking with an in-memory fake Supabase, including the
//    X1 secondaries (stored-itinerary re-stamp via
//    applyStoredItineraryBookingOverride, notification withdrawal via
//    markBookingNotificationsWithdrawn).
//  - Booking-monitor flip entry point: monitorSingleFlight is not
//    exported and its runner needs live provider/Gmail seams, so it is
//    covered at the strongest available level — the two shared seams it
//    calls are driven directly (above and below), and its wiring is
//    pinned by source inspection, as neighbouring suites do.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        --import ./scripts/roamly-booking-cancel-server-only-register.mjs \
//        scripts/roamly-cancelled-never-confirmed-checks.mjs   (TZ-safe)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bookingTruthState, isConfirmed, titleForTruth } from "../lib/roamly/bookingTruth.ts";
import { cancelTripBooking, isConfirmedBooking } from "../lib/roamly/bookingWallet.ts";
import { markBookingNotificationsWithdrawn } from "../lib/roamly/bookingNotificationWithdrawal.ts";
import {
  applyConfirmedBookingOverrideToItinerary,
  reconcileItineraryItemsWithCurrentBookings
} from "../lib/roamly/itineraryBookingOverrides.ts";
import { buildPlaceDetail } from "../lib/roamly/placeDetail.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

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

// ---------------------------------------------------------------- truth
const CONFIRMED_SHAPED = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "AGD8X42K",
  provider_name: "Agoda",
  source_type: "email",
  title: "Seaside Hotel",
  superseded_by_booking_id: null
};
const CANCELLED = { ...CONFIRMED_SHAPED, booking_status: "cancelled" };

eq("pre-cancel shape is confirmed (control)", isConfirmed(CONFIRMED_SHAPED), true);
eq("cancelled booking truth state is cancelled", bookingTruthState(CANCELLED), "cancelled");
eq("cancelled booking is NOT confirmed", isConfirmed(CANCELLED), false);
eq("cancelled title re-stamps as Cancelled:", titleForTruth("Confirmed: Seaside Hotel", "cancelled"), "Cancelled: Seaside Hotel");
check("cancelled title never carries the Confirmed: stamp", !titleForTruth("Seaside Hotel", bookingTruthState(CANCELLED)).startsWith("Confirmed:"));
eq(
  "wallet predicate: cancelled serialized booking is NOT confirmed",
  isConfirmedBooking({
    booking_status: "cancelled",
    traveler_confirmed: true,
    confirmation_code: "AGD8X42K",
    provider: "Agoda",
    source_type: "email",
    title: "Seaside Hotel"
  }),
  false
);

// ------------------------------------------------- override write stamp
const baseItinerary = (items) => ({
  daily_itinerary: [{ day_number: 1, date: "2026-10-10", title: "Day 1", morning: "", live_timeline: items }]
});
{
  const r = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), {
    id: "bk-1",
    booking_type: "hotel",
    start_at: "2026-10-10T15:00:00Z",
    ...CANCELLED
  });
  const item = r.itinerary.daily_itinerary[0].live_timeline[0];
  eq("override stamp for cancelled booking is Cancelled:", item.title, "Cancelled: Seaside Hotel");
  eq("override stamp for cancelled booking is not verified", item.factualStatus, "unknown");
  eq("override stamp for cancelled booking forces timing UNKNOWN", item.timing_status, "UNKNOWN");
  eq("override stamp for cancelled booking demotes the anchor role", item.plan_role, "supporting");
  eq("override stamp records booking_status cancelled", item.booking_status, "cancelled");
}

// ------------------------------------------------------ read-path reconcile
const STALE_ITEM = {
  item_id: "i1",
  booking_id: "bk-1",
  title: "Confirmed: Seaside Hotel",
  description: "Confirmed booking; this replaces the itinerary recommendation as the actual reservation.",
  category: "Confirmed booking",
  booking_label: "Confirmed booking",
  booking_status: "confirmed",
  factualStatus: "verified",
  timing_status: "FACTUAL",
  plan_role: "protected_anchor",
  startTime: "15:00"
};
const overrideBookingRow = (patch) => ({
  id: "bk-1",
  booking_type: "hotel",
  start_at: "2026-10-10T15:00:00Z",
  ...CANCELLED,
  ...patch
});
{
  const out = reconcileItineraryItemsWithCurrentBookings(baseItinerary([structuredClone(STALE_ITEM)]), [overrideBookingRow({})]);
  const item = out.daily_itinerary[0].live_timeline[0];
  eq("reconcile (by booking_id): stale Confirmed: title becomes Cancelled:", item.title, "Cancelled: Seaside Hotel");
  eq("reconcile (by booking_id): booking_status becomes cancelled", item.booking_status, "cancelled");
  eq("reconcile (by booking_id): verified factual status is downgraded", item.factualStatus, "unknown");
  eq("reconcile (by booking_id): FACTUAL timing is forced UNKNOWN", item.timing_status, "UNKNOWN");
  eq("reconcile (by booking_id): protected anchor is demoted", item.plan_role, "supporting");
  check("reconcile (by booking_id): description no longer opens with Confirmed booking;", !String(item.description).startsWith("Confirmed booking;"));
}
{
  const noId = structuredClone(STALE_ITEM);
  delete noId.booking_id;
  const out = reconcileItineraryItemsWithCurrentBookings(baseItinerary([noId]), [overrideBookingRow({})]);
  eq("reconcile (by exact title match): stale item is corrected too", out.daily_itinerary[0].live_timeline[0].title, "Cancelled: Seaside Hotel");
}
{
  const stillConfirmed = { ...CONFIRMED_SHAPED };
  const out = reconcileItineraryItemsWithCurrentBookings(baseItinerary([structuredClone(STALE_ITEM)]), [
    { id: "bk-1", booking_type: "hotel", start_at: "2026-10-10T15:00:00Z", ...stillConfirmed }
  ]);
  eq("reconcile: a still-confirmed booking re-stamps to its provenance (Round 3)", out.daily_itinerary[0].live_timeline[0].title, "Confirmed · from your Agoda email: Seaside Hotel");
  eq("reconcile: still-confirmed item keeps verified status (control)", out.daily_itinerary[0].live_timeline[0].factualStatus, "verified");
}

// ------------------------------------------------------------- place detail
{
  const item = {
    item_id: "i1",
    title: "Confirmed: Seaside Hotel",
    description: "A hotel.",
    location_name: "Old Port",
    startTime: "15:00",
    endTime: "16:00",
    category: "hotel"
  };
  const d = buildPlaceDetail({
    item,
    day: { day_number: 1, date: "2026-10-26", live_timeline: [item] },
    siblings: [],
    trip: { destination: "Montreal, Canada", origin: "Saint John", start_date: "2026-10-26", end_date: "2026-10-30" },
    tripTips: [],
    confirmedBookings: [{ ...CANCELLED, address: "123 Seaside St" }],
    photo: null
  });
  eq("place detail: cancelled booking yields the Cancelled badge", d?.badge, "Cancelled");
  eq("place detail: cancelled booking strips the stored Confirmed: prefix", d?.title, "Seaside Hotel");
  eq("place detail: cancelled booking is not evidence-confirmed", d?.evidence.confirmed, false);
  eq("place detail: cancelled booking withholds the address", d?.about.address, null);
}

// --------------------------------------- wallet cancel, driven end-to-end
class Query {
  constructor(db, table, rows) {
    this.db = db;
    this.table = table;
    this.rows = rows;
    this.filters = [];
    this.sorts = [];
    this.pendingPatch = null;
    this.limitN = null;
  }
  select() { return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c, vals) { this.filters.push((r) => vals.includes(r[c])); return this; }
  order(c, o = {}) { this.sorts.push({ c, asc: o.ascending !== false }); return this; }
  limit(n) { this.limitN = n; return this; }
  update(p) { this.pendingPatch = p; return this; }
  matchedRows() {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.pendingPatch) {
      for (const r of out) Object.assign(r, this.pendingPatch);
      this.db.writes.push({ table: this.table, op: "update", count: out.length });
    }
    for (const s of this.sorts) {
      out = [...out].sort((a, b) => {
        const av = a[s.c] ?? "";
        const bv = b[s.c] ?? "";
        return av < bv ? (s.asc ? -1 : 1) : av > bv ? (s.asc ? 1 : -1) : 0;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }
  async maybeSingle() { const rows = this.matchedRows(); return { data: rows[0] ?? null, error: null }; }
  async single() { const rows = this.matchedRows(); if (!rows[0]) return { data: null, error: { message: "No rows" } }; return { data: rows[0], error: null }; }
  then(resolve) { resolve({ data: this.matchedRows(), error: null }); }
}
function makeDb() {
  const db = {
    writes: [],
    trips: [{
      id: "trip-1", user_id: "user-1", destination: "Montreal, Canada",
      start_date: "2026-10-10", end_date: "2026-10-12", days_count: 3,
      budget_amount: 1000, budget_currency: "CAD", travel_style: "Balanced",
      interests: [], accommodation_preference: "Not sure",
      transportation_preference: "Mixed", special_notes: "", metadata: {}
    }],
    bookings: [],
    events: [],
    itineraries: [],
    notifications: []
  };
  const tables = {
    roamly_trips: db.trips,
    roamly_trip_companion_events: db.events,
    roamly_itineraries: db.itineraries,
    roamly_notifications: db.notifications,
    roamly_bookings: db.bookings
  };
  return { db, supabase: { from: (t) => new Query(db, t, tables[t]) } };
}
function bookingRow(overrides = {}) {
  return {
    id: "bk-1", trip_id: "trip-1", user_id: "user-1", booking_type: "hotel",
    booking_status: "booked", provider_name: "Agoda", provider_booking_id: null,
    confirmation_number: "AGD8X42K", source_type: "email",
    source_reference: "email:gmail:m1", title: "Seaside Hotel",
    start_at: "2026-10-10T15:00:00Z", end_at: "2026-10-12T11:00:00Z",
    origin: null, destination: "Montreal, Canada", address: "123 Seaside St",
    flight_number: null, terminal: null, gate: null, room_type: null,
    check_in_at: null, check_out_at: null, reservation_requirements: {},
    total_price: 300, amount_cents: 30000, currency: "CAD",
    taxes_and_fees: null, cancellation_deadline: null, cancellation_terms: null,
    traveler_confirmed: true, last_synced_at: "2026-10-24T00:00:00.000Z",
    created_at: "2026-10-24T00:00:00.000Z", updated_at: "2026-10-24T00:00:00.000Z",
    superseded_by_booking_id: null, booking_segments: [], metadata: {},
    ...overrides
  };
}
function fullItinerary() {
  return {
    trip_title: "Fixture", destination_summary: "Fixture", best_for: [], route_reasoning: "",
    budget_fit_summary: "", booking_status_summary: "", free_or_low_cost_notes: [],
    estimated_budget_breakdown: { total_estimate: "$0", categories: [] },
    hotel_area_suggestions: [], transport_overview: "",
    daily_itinerary: [{
      day_number: 1, date: "2026-10-10", title: "Day 1", morning: "", afternoon: "",
      evening: "", food: [], estimated_cost: 0, map_queries: [],
      live_timeline: [{ ...STALE_ITEM }]
    }],
    packing_checklist: [], local_tips: [], safety_notes: [], emergency_notes: [],
    booking_suggestions: [], pre_trip_essentials: [], regenerate_suggestions: []
  };
}
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow());
  db.itineraries.push({ id: "itin-1", trip_id: "trip-1", user_id: "user-1", full_json: fullItinerary(), repair_revision: 3, created_at: "2026-10-24T00:00:00.000Z" });
  db.events.push({ id: "ev-1", trip_id: "trip-1", user_id: "user-1", booking_id: "bk-1", status: "scheduled" });
  db.notifications.push({ id: "n-1", user_id: "user-1", trip_id: "trip-1", event_id: "ev-1", action_url: "/trip/trip-1", metadata: {} });
  db.notifications.push({ id: "n-2", user_id: "user-1", trip_id: "trip-1", event_id: "ev-other", action_url: "/x", metadata: {} });

  eq("wallet cancel fixture starts confirmed (control)", isConfirmed(db.bookings[0]), true);
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "bk-1" });
  eq("wallet cancel succeeds", result.ok, true);
  eq("wallet cancel flips the row to cancelled", db.bookings[0].booking_status, "cancelled");
  eq("wallet cancel result is no longer confirmed", isConfirmedBooking(result.booking), false);
  eq("wallet cancel reports the itinerary re-stamp did not fail", result.itineraryRestampFailed, false);
  eq("wallet cancel marks exactly the linked notification withdrawn", result.notificationsMarked, 1);
  eq("wallet cancel reports notification marking did not fail", result.notificationMarkingFailed, false);

  const stored = db.itineraries[0].full_json.daily_itinerary[0].live_timeline[0];
  eq("write path: stored itinerary item is re-stamped Cancelled:", stored.title, "Cancelled: Seaside Hotel");
  eq("write path: stored item factual status is no longer verified", stored.factualStatus, "unknown");
  eq("write path: itinerary revision was bumped by the re-stamp", db.itineraries[0].repair_revision, 4);

  const n1 = db.notifications.find((n) => n.id === "n-1");
  eq("write path: linked notification is marked withdrawn (not deleted)", n1.metadata.withdrawn, true);
  eq("write path: withdrawal reason is booking_cancelled", n1.metadata.withdrawn_reason, "booking_cancelled");
  eq("write path: withdrawn notification loses its action_url", n1.action_url, null);
  check("write path: withdrawn_at is stamped as a string", typeof n1.metadata.withdrawn_at === "string");
  const n2 = db.notifications.find((n) => n.id === "n-2");
  eq("write path: another event's notification is untouched", n2.metadata.withdrawn, undefined);
  eq("write path: notification rows are never deleted", db.notifications.length, 2);
}

// --------------------------- withdrawal helper, driven directly (monitor seam)
{
  const { db, supabase } = makeDb();
  db.events.push({ id: "ev-1", trip_id: "trip-1", user_id: "user-1", booking_id: "bk-9", status: "scheduled" });
  db.notifications.push({ id: "n-1", user_id: "user-1", trip_id: "trip-1", event_id: "ev-1", action_url: "/trip/trip-1", metadata: {} });
  db.notifications.push({ id: "n-2", user_id: "user-1", trip_id: "trip-1", event_id: "ev-1", action_url: "/trip/trip-1", metadata: { withdrawn: true } });
  const w = await markBookingNotificationsWithdrawn(supabase, { userId: "user-1", tripId: "trip-1", bookingId: "bk-9", reason: "booking_cancelled" });
  eq("withdrawal helper succeeds", w.ok, true);
  eq("withdrawal helper marks only the not-yet-withdrawn row", w.marked, 1);
  eq("withdrawal helper never deletes rows", db.notifications.length, 2);
  const again = await markBookingNotificationsWithdrawn(supabase, { userId: "user-1", tripId: "trip-1", bookingId: "bk-9", reason: "booking_cancelled" });
  eq("withdrawal helper is idempotent (already-withdrawn skipped)", again.marked, 0);
}

// ------------------------- monitor entry point: wiring pinned by source
{
  const monitor = read("lib/roamly/bookingMonitor.ts");
  const x1 = monitor.slice(monitor.indexOf("X1 write path"));
  check(
    "booking monitor: cancellation flip re-stamps the itinerary via the shared seam",
    monitor.includes("cancellationChanged") && x1.includes("applyStoredItineraryBookingOverride")
  );
  check(
    "booking monitor: cancellation flip marks notifications withdrawn via the shared seam",
    x1.includes("markBookingNotificationsWithdrawn") && x1.includes('reason: "booking_cancelled"')
  );
  const wallet = read("lib/roamly/bookingWallet.ts");
  const wx1 = wallet.slice(wallet.indexOf("X1 write path"));
  check(
    "wallet cancel: X1 block calls the same two shared seams",
    wx1.includes("applyStoredItineraryBookingOverride") && wx1.includes("markBookingNotificationsWithdrawn")
  );
}

console.log(`\n${passed} cancelled-never-confirmed checks passed`);
