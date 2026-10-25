// Customer-cancel contract checks (no network, no database).
// Proves cancelTripBooking against the real bookingWallet module with an
// in-memory fake Supabase: ownership, idempotency, refusal cases, and that
// a cancel changes ONLY status + updated_at (price, currency, and segments
// history are never rewritten) and touches no table but roamly_bookings —
// except the companion-reminder withdrawal added by the cancel-reminders
// patch (cases 9-12): after a fresh cancel, still-scheduled companion
// events for that booking + trip become 'cancelled'; 'processing' events
// are never touched; other bookings'/trips' events are never touched; and a
// withdrawal failure is flagged without un-cancelling the booking.
import assert from "node:assert";
import {
  bookingWalletSummary,
  cancelTripBooking,
  isActiveTripBooking,
  isConfirmedBooking,
  listTripBookings
} from "../lib/roamly/bookingWallet.ts";

class Query {
  constructor(db, table, rows) {
    this.db = db;
    this.table = table;
    this.rows = rows;
    this.filters = [];
    this.sorts = [];
    this.pendingPatch = null;
  }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  order(col, opts = {}) {
    this.sorts.push({ col, asc: opts.ascending !== false });
    return this;
  }
  update(patch) {
    this.pendingPatch = patch;
    return this;
  }
  insert(row) {
    const rows = Array.isArray(row) ? row : [row];
    for (const r of rows) this.rows.push({ ...r });
    this.db.writes.push({ table: this.table, op: "insert", count: rows.length });
    this.matched = rows.map((r) => this.rows[this.rows.length - rows.length + rows.indexOf(r)]);
    return this;
  }
  matchedRows() {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.pendingPatch) {
      for (const r of out) Object.assign(r, this.pendingPatch);
      this.db.writes.push({ table: this.table, op: "update", count: out.length });
    }
    for (const s of this.sorts) {
      out = [...out].sort((a, b) => {
        const av = a[s.col] ?? "";
        const bv = b[s.col] ?? "";
        if (av < bv) return s.asc ? -1 : 1;
        if (av > bv) return s.asc ? 1 : -1;
        return 0;
      });
    }
    return out;
  }
  async maybeSingle() {
    const rows = this.matchedRows();
    return { data: rows[0] ?? null, error: null };
  }
  async single() {
    const rows = this.matchedRows();
    if (!rows[0]) return { data: null, error: { message: "No rows" } };
    return { data: rows[0], error: null };
  }
  then(resolve) {
    // Faithful fake for the reminder withdrawal: a failing events-table
    // update surfaces as an error value (as supabase-js does) and writes
    // nothing, so the test can prove the booking still stays cancelled.
    if (this.db.failEventsUpdate && this.table === "roamly_trip_companion_events" && this.pendingPatch) {
      resolve({ data: null, error: { message: "EVENTS_UPDATE_FAILED" } });
      return;
    }
    resolve({ data: this.matchedRows(), error: null });
  }
}

function makeDb(options = {}) {
  const db = {
    writes: [],
    trips: [{ id: "trip-1", user_id: "user-1" }],
    bookings: [],
    events: [],
    failEventsUpdate: options.failEventsUpdate === true
  };
  const supabase = {
    from(table) {
      const rows = table === "roamly_trips" ? db.trips : table === "roamly_trip_companion_events" ? db.events : db.bookings;
      return new Query(db, table, rows);
    }
  };
  return { db, supabase };
}

function eventRow(overrides = {}) {
  return {
    id: "event-1",
    trip_id: "trip-1",
    booking_id: "booking-1",
    status: "scheduled",
    ...overrides
  };
}

function bookingRow(overrides = {}) {
  return {
    id: "booking-1",
    trip_id: "trip-1",
    user_id: "user-1",
    booking_type: "activity",
    booking_status: "unknown",
    provider_name: "Test Provider",
    provider_booking_id: null,
    confirmation_number: "CANCEL1",
    source_type: "manual",
    source_reference: null,
    title: "Test activity",
    start_at: "2026-11-11T10:00:00",
    end_at: null,
    origin: null,
    destination: null,
    address: null,
    flight_number: null,
    terminal: null,
    gate: null,
    room_type: null,
    check_in_at: null,
    check_out_at: null,
    reservation_requirements: {},
    total_price: 45,
    amount_cents: 4500,
    currency: "USD",
    taxes_and_fees: null,
    cancellation_deadline: null,
    cancellation_terms: null,
    traveler_confirmed: false,
    last_synced_at: "2026-10-24T00:00:00.000Z",
    created_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
    superseded_by_booking_id: null,
    booking_segments: [{ sequence: 1, origin: "YUL", destination: "YYZ" }],
    metadata: {},
    ...overrides
  };
}

// ---- 1. Cancel own booking: status flips, everything else preserved ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow());
  const before = { ...db.bookings[0] };
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true, `cancel must succeed, got ${result.error}`);
  assert.equal(result.idempotent, false);
  assert.equal(result.alreadyCancelled, false);
  assert.equal(result.booking.booking_status, "cancelled", "serialized status must be cancelled");
  const row = db.bookings[0];
  assert.equal(row.booking_status, "cancelled", "raw status must be cancelled");
  assert.equal(row.total_price, before.total_price, "cancel must never rewrite price");
  assert.equal(row.currency, before.currency, "cancel must never rewrite currency");
  assert.deepEqual(row.booking_segments, before.booking_segments, "cancel must never rewrite segments");
  assert.equal(isActiveTripBooking(result.booking), false, "cancelled booking must leave the active set");
  // Reload proves the row reads back cancelled.
  const reloaded = await listTripBookings({ supabase, userId: "user-1", tripId: "trip-1", includeSegments: true });
  assert.equal(reloaded.error, null);
  assert.equal(reloaded.bookings.length, 1);
  assert.equal(reloaded.bookings[0].booking_status, "cancelled");
  assert.deepEqual(reloaded.bookings[0].booking_segments, before.booking_segments, "segments must survive cancel + reload");
  // Summary: still counted in total (history), never in active.
  const summary = bookingWalletSummary(reloaded.bookings);
  assert.equal(summary.total, 1, "cancelled booking stays in history");
  assert.equal(summary.active, 0, "cancelled booking leaves the active count");
  // Fresh cancel also runs the reminder withdrawal (zero events here, so
  // zero withdrawn and no failure). Writes are therefore roamly_bookings
  // plus the events-table withdrawal only; no purchase/Stripe table touched.
  assert.equal(result.remindersWithdrawn, 0, "fresh cancel with no reminders must report 0 withdrawn");
  assert.equal(result.reminderWithdrawalFailed, false, "successful withdrawal must not flag failure");
  assert.ok(db.writes.every((w) => w.table === "roamly_bookings" || w.table === "roamly_trip_companion_events"), "cancel must write only roamly_bookings + the reminder withdrawal");
}

// ---- 2. Cancel a confirmed booking drops it from confirmed totals ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ booking_status: "booked", traveler_confirmed: true }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true);
  assert.equal(isConfirmedBooking(result.booking), false, "cancelled booking must not count as confirmed");
}

// ---- 3. Cancel another user's booking is refused and changes nothing ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ user_id: "user-2" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "BOOKING_NOT_FOUND");
  assert.equal(db.bookings[0].booking_status, "unknown", "refused cancel must not change the row");
  assert.equal(db.writes.filter((w) => w.op === "update").length, 0, "refused cancel must not write");
}

// ---- 4. Cancel on someone else's trip is refused ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ trip_id: "trip-2" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-2", bookingId: "booking-1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "TRIP_NOT_FOUND");
}

// ---- 5. Already-cancelled is a harmless no-op ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ booking_status: "cancelled" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, true);
  assert.equal(result.alreadyCancelled, true);
  assert.equal(result.booking.booking_status, "cancelled");
  assert.equal(db.bookings[0].total_price, 45, "no-op cancel must not touch price");
}

// ---- 6. Superseded is refused (history is not actionable) ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ superseded_by_booking_id: "booking-2" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "BOOKING_ALREADY_SUPERSEDED");
  assert.equal(db.bookings[0].booking_status, "unknown");
}

// ---- 7. Refunded is refused (the refund fact must never be overwritten) ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ booking_status: "refunded" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "BOOKING_ALREADY_REFUNDED");
  assert.equal(db.bookings[0].booking_status, "refunded");
}

// ---- 8. Unknown booking id is refused ----
{
  const { supabase } = makeDb();
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "nope" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "BOOKING_NOT_FOUND");
}

// ---- 9. Fresh cancel withdraws scheduled reminders for that booking+trip ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow());
  db.events.push(eventRow({ id: "event-1" }));
  db.events.push(eventRow({ id: "event-2" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true);
  assert.equal(result.remindersWithdrawn, 2, "both scheduled reminders for this booking+trip must be withdrawn");
  assert.equal(result.reminderWithdrawalFailed, false);
  assert.ok(db.events.every((e) => e.status === "cancelled"), "scheduled reminders must become cancelled");
  assert.equal(db.bookings[0].booking_status, "cancelled", "booking cancel is still the primary result");
}

// ---- 10. Processing + other-booking + other-trip events are untouched ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow());
  db.events.push(eventRow({ id: "event-processing", status: "processing" }));
  db.events.push(eventRow({ id: "event-other-booking", booking_id: "booking-2" }));
  db.events.push(eventRow({ id: "event-other-trip", trip_id: "trip-2" }));
  db.events.push(eventRow({ id: "event-own", status: "scheduled" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true);
  assert.equal(result.remindersWithdrawn, 1, "only the own scheduled reminder must be withdrawn");
  assert.equal(result.reminderWithdrawalFailed, false);
  const byId = Object.fromEntries(db.events.map((e) => [e.id, e.status]));
  assert.equal(byId["event-processing"], "processing", "processing dispatch must never be touched (in-flight emailSentAt must not race)");
  assert.equal(byId["event-other-booking"], "scheduled", "another booking's reminder must be untouched");
  assert.equal(byId["event-other-trip"], "scheduled", "another trip's reminder must be untouched");
  assert.equal(byId["event-own"], "cancelled", "own scheduled reminder must be withdrawn");
}

// ---- 11. Withdrawal failure still leaves the booking cancelled ----
{
  const { db, supabase } = makeDb({ failEventsUpdate: true });
  db.bookings.push(bookingRow());
  db.events.push(eventRow({ id: "event-1" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true, "booking cancel must succeed even when the withdrawal fails");
  assert.equal(result.booking.booking_status, "cancelled");
  assert.equal(db.bookings[0].booking_status, "cancelled", "failed withdrawal must never un-cancel the booking");
  assert.equal(result.reminderWithdrawalFailed, true, "withdrawal failure must be surfaced as a flag");
  assert.equal(db.events[0].status, "scheduled", "failed withdrawal must write nothing to events");
}

// ---- 12. Already-cancelled no-op attempts no withdrawal ----
{
  const { db, supabase } = makeDb();
  db.bookings.push(bookingRow({ booking_status: "cancelled" }));
  db.events.push(eventRow({ id: "event-1" }));
  const result = await cancelTripBooking({ supabase, userId: "user-1", tripId: "trip-1", bookingId: "booking-1" });
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, true);
  assert.equal(result.remindersWithdrawn, null, "no-op cancel reports no withdrawal count");
  assert.equal(result.reminderWithdrawalFailed, false);
  assert.equal(db.events[0].status, "scheduled", "no-op cancel must not withdraw reminders (none were updated)");
}

console.log("booking-cancel: own cancel + reload OK; confirmed totals drop it; other-user / other-trip refused; already-cancelled no-op; superseded + refunded refused; price/currency/segments preserved; writes limited to roamly_bookings + reminder withdrawal; scheduled reminders withdrawn, processing/other-booking/other-trip untouched, withdrawal failure flagged without un-cancelling");
