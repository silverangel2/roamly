// B10–B15 audit-batch checks: screenshot corrections kept, wallet review
// workflow, superseded predicate, currency-aware budget card, zero-amount
// preservation, wallet load-failure state. Run:
//   npm run test:b10b15-booking-fixes
import assert from "node:assert/strict";
import fs from "node:fs";
import { diffBookingCorrections, sanitizeBookingCorrectionFields } from "../lib/roamly/bookingCorrections.ts";
import {
  bookingWalletSummary,
  isActiveTripBooking,
  isConfirmedBooking,
  legacyRoamlyBookingToWallet,
  listTripBookings,
  reviewTripBooking,
  serializeTripBookingRecord
} from "../lib/roamly/bookingWallet.ts";
import { groupConfirmedBudgetTotals, isConfirmedBudgetBooking } from "../lib/roamly/bookingBudgetCard.ts";
import { applyPaidItineraryPurchase } from "../lib/roamly/billing.ts";

// ---------- tiny fake Supabase (thenable builder) ----------
function makeFakeDb(seed, failTables = new Set()) {
  const tables = new Map(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes = [];
  function from(table) {
    const rows = () => {
      if (!tables.has(table)) tables.set(table, []);
      return tables.get(table);
    };
    const filters = [];
    let op = "select";
    let payload = null;
    let upsertOpts = null;
    const b = {
      select() { op = "select"; return b; },
      eq(c, v) { filters.push([c, v, "eq"]); return b; },
      in(c, vs) { filters.push([c, vs, "in"]); return b; },
      order() { return b; },
      limit() { return b; },
      update(p) { op = "update"; payload = p; return b; },
      upsert(p, o) { op = "upsert"; payload = p; upsertOpts = o; return b; },
      insert(p) { op = "insert"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      maybeSingle() { return Promise.resolve(exec(true)); },
      single() { return Promise.resolve(exec(true)); },
      then(resolve, reject) {
        try { resolve(exec(false)); } catch (e) { reject(e); }
      }
    };
    function match(row) {
      return filters.every(([c, v, kind]) => (kind === "in" ? v.includes(row[c]) : row[c] === v));
    }
    function exec(singleRow) {
      if (failTables.has(table)) return { data: singleRow ? null : [], error: { message: "simulated read failure" } };
      if (op === "select") {
        const found = rows().filter(match);
        return singleRow ? { data: found[0] || null, error: null } : { data: found, error: null };
      }
      if (op === "update") {
        const found = rows().filter(match);
        for (const r of found) Object.assign(r, payload);
        writes.push({ table, op, payload, count: found.length });
        return { data: found, error: null };
      }
      if (op === "upsert") {
        const arr = Array.isArray(payload) ? payload : [payload];
        for (const p of arr) {
          const cols = upsertOpts?.onConflict ? upsertOpts.onConflict.split(",") : [];
          const existing = cols.length ? rows().find((r) => cols.every((c) => r[c] === p[c])) : undefined;
          if (existing) Object.assign(existing, p); else rows().push({ ...p });
        }
        writes.push({ table, op, payload: arr });
        return { data: arr, error: null };
      }
      if (op === "insert") {
        const arr = Array.isArray(payload) ? payload : [payload];
        for (const p of arr) rows().push({ ...p });
        writes.push({ table, op, payload: arr });
        return { data: arr, error: null };
      }
      return { data: null, error: null };
    }
    return b;
  }
  return { from, tables, writes };
}

// ---------- B10: corrections diff + confirm route wiring ----------
{
  const extracted = {
    booking_type: "hotel", title: "Hotel Alpha", provider_name: "Alpha Hotels",
    confirmation_number: "ABC123", amount_cents: 49900, currency: "cad",
    start_date: "2026-11-10", start_time: "15:00", address: "1 Main St", city: "Montreal"
  };
  const edited = { ...extracted, title: "Hotel Alpha Downtown", amount_cents: 52000, currency: "CAD" };
  const diff = diffBookingCorrections(edited, extracted);
  assert.deepEqual(diff, { title: "Hotel Alpha Downtown", amount_cents: 52000 }, "only real edits become corrections");
  assert.equal(diffBookingCorrections({ ...extracted }, extracted), null, "no-op review stores no assertion");
  assert.equal(diffBookingCorrections({ title: "  ", amount_cents: -5, currency: "xx", start_date: "10/11/2026" }, extracted), null, "malformed corrections are dropped, never stored");
  const sanitized = sanitizeBookingCorrectionFields({ title: "X", unknown_field: "dropped", booking_type: "bogus" });
  assert.equal(sanitized.unknown_field, undefined, "unknown fields are not whitelisted");
  assert.equal(sanitized.booking_type, null, "unknown booking type is dropped");

  const confirmRoute = fs.readFileSync("app/api/roamly/bookings/confirm/route.ts", "utf8");
  assert.match(confirmRoute, /diffBookingCorrections\(body\.corrections/, "confirm route diffs client edits against the signed extraction");
  assert.match(confirmRoute, /customerCorrections: corrections/, "corrections stored as a pending assertion");
  assert.match(confirmRoute, /correctionEvidenceToken/, "assertion is bound to the signed evidence token");
  assert.match(confirmRoute, /captureState: "customer_asserted"/, "assertion is marked customer-asserted");
  assert.match(confirmRoute, /bookingStatus: "needs_confirmation"/, "confirm row stays unconfirmed");
  assert.doesNotMatch(confirmRoute, /travelerConfirmed: true/, "confirm never promotes the traveler to confirmed");
  const manager = fs.readFileSync("components/roamly/TripBookingsManager.tsx", "utf8");
  assert.match(manager, /corrections: extracted/, "manager sends review edits with the confirm");
  assert.match(manager, /correctionsSaved/, "manager surfaces the corrections-saved state");
  assert.match(manager, /not confirmed yet/, "traveler is told corrections are pending, not confirmed");
}

// ---------- B11: review workflow (metadata only, never promotion) ----------
{
  const seed = {
    roamly_trips: [{ id: "t1", user_id: "u1" }],
    roamly_bookings: [
      { id: "b1", trip_id: "t1", user_id: "u1", booking_status: "needs_confirmation", traveler_confirmed: false, superseded_by_booking_id: null, metadata: {} },
      { id: "b2", trip_id: "t1", user_id: "u1", booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: "b3", metadata: {} }
    ]
  };
  const db = makeFakeDb(seed);
  const asserted = await reviewTripBooking({ supabase: db, userId: "u1", tripId: "t1", bookingId: "b1", action: "assert" });
  assert.equal(asserted.ok, true, "assert succeeds");
  assert.equal(asserted.reviewState, "traveler_asserted", "assert records traveler_asserted");
  const row1 = db.tables.get("roamly_bookings").find((r) => r.id === "b1");
  assert.equal(row1.booking_status, "needs_confirmation", "assert never changes status");
  assert.equal(row1.traveler_confirmed, false, "assert never flips traveler_confirmed (no auto-promotion)");
  assert.ok(row1.metadata.travelerAssertion.assertedAt, "assert records provenance timestamp");

  const dismissed = await reviewTripBooking({ supabase: db, userId: "u1", tripId: "t1", bookingId: "b1", action: "dismiss", reason: "Not my booking" });
  assert.equal(dismissed.reviewState, "dismissed", "dismiss records dismissed");
  assert.equal(row1.metadata.reviewDismissed.reason, "Not my booking", "dismiss reason is kept");

  const corrected = await reviewTripBooking({ supabase: db, userId: "u1", tripId: "t1", bookingId: "b1", action: "correct", corrections: { title: "Fixed Title", bogus: 1 } });
  assert.equal(corrected.ok, true, "correct succeeds");
  assert.equal(row1.metadata.customerCorrections.title, "Fixed Title", "correction is stored as a pending assertion");
  assert.equal(row1.metadata.customerCorrections.bogus, undefined, "correction whitelist applies on the review path too");
  assert.equal(row1.booking_status, "needs_confirmation", "correct never changes status");

  const wrongUser = await reviewTripBooking({ supabase: db, userId: "u2", tripId: "t1", bookingId: "b1", action: "assert" });
  assert.equal(wrongUser.ok, false, "another user cannot review this booking");
  const superseded = await reviewTripBooking({ supabase: db, userId: "u1", tripId: "t1", bookingId: "b2", action: "assert" });
  assert.equal(superseded.error, "BOOKING_NOT_CURRENT", "superseded history cannot be reviewed");
  const empty = await reviewTripBooking({ supabase: db, userId: "u1", tripId: "t1", bookingId: "b1", action: "correct", corrections: {} });
  assert.equal(empty.error, "NO_VALID_CORRECTIONS", "empty corrections are refused");

  const reviewRoute = fs.readFileSync("app/api/roamly/bookings/review/route.ts", "utf8");
  assert.match(reviewRoute, /reviewTripBooking/, "review route uses the metadata-only review function");
  assert.doesNotMatch(reviewRoute, /traveler_confirmed:|booking_status:/, "review route never writes confirmation flags");
  const timeline = fs.readFileSync("components/companion/BookingWalletTimeline.tsx", "utf8");
  assert.match(timeline, /BookingReviewActions/, "timeline renders per-record review actions");
  assert.match(timeline, /review_state == null/, "reviewed records leave the Action-needed set");
  assert.match(timeline, /Found via/, "action-needed records show provenance");
}

// ---------- B12: one operational-current predicate ----------
{
  const current = { booking_status: "booked", superseded_by_booking_id: null };
  const superseded = { booking_status: "booked", superseded_by_booking_id: "next" };
  const cancelled = { booking_status: "cancelled", superseded_by_booking_id: null };
  assert.equal(isActiveTripBooking(current), true, "current booking is active");
  assert.equal(isActiveTripBooking(superseded), false, "superseded booking is NOT active even with a live status");
  assert.equal(isActiveTripBooking(cancelled), false, "cancelled booking is not active");
  assert.equal(isActiveTripBooking({ booking_status: "booked" }), true, "rows without the lineage field stay active (back-compat)");

  const confirmed = { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: null };
  const confirmedSuperseded = { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: "next" };
  assert.equal(isConfirmedBooking(confirmed), true, "confirmed current booking counts");
  assert.equal(isConfirmedBooking(confirmedSuperseded), false, "superseded confirmed booking does not count");

  const summary = bookingWalletSummary([
    { booking_status: "needs_confirmation", superseded_by_booking_id: null },
    { booking_status: "needs_confirmation", superseded_by_booking_id: "next" },
    { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: null }
  ]);
  assert.equal(summary.needsConfirmation, 1, "summary counts only active needs-confirmation rows");
  assert.equal(summary.active, 2, "summary active set excludes superseded rows");

  const serialized = serializeTripBookingRecord({
    id: "b9", trip_id: "t1", user_id: "u1", booking_type: "hotel", booking_status: "unknown",
    title: "X", metadata: { reviewState: "dismissed", customerCorrections: { title: "Y" } }
  });
  assert.equal(serialized.review_state, "dismissed", "serializer exposes review state");
  assert.deepEqual(serialized.pending_corrections, { title: "Y" }, "serializer exposes pending corrections");
  const legacy = legacyRoamlyBookingToWallet({ booking_status: "booked", title: "L" }, { userId: "u1", tripId: "t1" });
  assert.equal(legacy.review_state, null, "legacy conversion carries the new fields");
  assert.equal(legacy.pending_corrections, null, "legacy conversion carries null corrections");

  const timeline = fs.readFileSync("components/companion/BookingWalletTimeline.tsx", "utf8");
  assert.match(timeline, /Booking history/, "superseded rows get a labeled history section");
  assert.match(timeline, /supersededBookings/, "history section is fed by superseded rows only");
}

// ---------- B13: currency-aware, confirmed-only budget card ----------
{
  const rows = [
    { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: null, amount_cents: 10000, currency: "CAD" },
    { booking_status: "booked", traveler_confirmed: true, superseded_by_booking_id: null, total_price: 99, currency: "PHP" },
    { booking_status: "needs_confirmation", traveler_confirmed: false, superseded_by_booking_id: null, amount_cents: 50000, currency: "CAD" },
    { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: null, amount_cents: 77700, currency: "CAD" },
    { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: "next", amount_cents: 99900, currency: "CAD" },
    { booking_status: "cancelled", traveler_confirmed: true, superseded_by_booking_id: null, amount_cents: 1000, currency: "CAD" },
    { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: null, amount_cents: null, total_price: null, currency: "CAD" },
    { booking_status: "confirmed", traveler_confirmed: true, superseded_by_booking_id: null, amount_cents: 0, currency: "CAD" }
  ];
  const { confirmedCount, totals } = groupConfirmedBudgetTotals(rows);
  assert.equal(confirmedCount, 5, "only current + traveler-confirmed + confirmed-status rows count (unknown-amount confirmed row counts, but adds no total)");
  assert.deepEqual(totals, [{ currency: "CAD", cents: 87700 }, { currency: "PHP", cents: 9900 }], "totals are per-currency, pending/superseded/cancelled excluded, zero preserved, unknown skipped");

  // Agreement with the canonical wallet predicate on canonical rows.
  for (const row of rows) {
    const canonical = { booking_status: row.booking_status === "booked" ? "confirmed" : row.booking_status, traveler_confirmed: row.traveler_confirmed, superseded_by_booking_id: row.superseded_by_booking_id };
    assert.equal(isConfirmedBudgetBooking(row), isConfirmedBooking(canonical), `budget mirror agrees with isConfirmedBooking for ${row.booking_status}`);
  }
  const manager = fs.readFileSync("components/roamly/TripBookingsManager.tsx", "utf8");
  assert.match(manager, /groupConfirmedBudgetTotals\(bookings\)/, "budget card uses the shared grouping");
  assert.doesNotMatch(manager, /booking_status !== "cancelled"/, "budget card no longer filters only cancelled rows");
  assert.doesNotMatch(manager, /formatMoney\(committed, "CAD"/, "budget card no longer formats one total as CAD");
}

// ---------- B14: zero totals preserved (null-only fallback) ----------
{
  const billing = fs.readFileSync("lib/roamly/billing.ts", "utf8");
  assert.doesNotMatch(billing, /session\.amount_total \|\|/, "no || fallback remains on amount_total");
  assert.equal((billing.match(/session\.amount_total \?\?/g) || []).length, 5, "all five amount_total sites use null-only fallback");

  const tripRow = { id: "t1", user_id: "u1", itinerary_locked: false, itinerary_status: "draft", itinerary_generated_at: null, tracking_unlocked: false, live_companion_unlocked: false, metadata: {} };
  const session = (amountTotal, currency) => ({
    id: "cs_test", payment_status: "paid", status: "complete", amount_total: amountTotal, currency,
    payment_intent: "pi_test", subscription: null,
    metadata: { trip_id: "t1", user_id: "u1", purchase_type: "itinerary_unlock" }
  });
  const dbZero = makeFakeDb({ roamly_trips: [{ ...tripRow }] });
  const zero = await applyPaidItineraryPurchase(dbZero, session(0, "cad"));
  assert.equal(zero.ok, true, "zero-total purchase applies");
  const zeroPurchase = dbZero.tables.get("roamly_itinerary_purchases").find((r) => r.stripe_checkout_session_id === "cs_test");
  assert.equal(zeroPurchase.amount_cents, 0, "legitimate zero total is preserved, not replaced by the catalog price");
  const zeroPayment = dbZero.tables.get("roamly_trip_payments").find((r) => r.stripe_session_id === "cs_test");
  assert.equal(zeroPayment.amount, 0, "payment ledger also keeps the zero");

  const dbNull = makeFakeDb({ roamly_trips: [{ ...tripRow }] });
  const nulled = await applyPaidItineraryPurchase(dbNull, session(null, null));
  assert.equal(nulled.ok, true, "null-total purchase applies");
  const nullPurchase = dbNull.tables.get("roamly_itinerary_purchases").find((r) => r.stripe_checkout_session_id === "cs_test");
  assert.ok(typeof nullPurchase.amount_cents === "number" && nullPurchase.amount_cents > 0, "null total still falls back to the catalog price");
}

// ---------- B15: read failures surface, never render as empty ----------
{
  const dbFail = makeFakeDb(
    { roamly_trips: [{ id: "t1", user_id: "u1" }], roamly_bookings: [{ id: "b1", trip_id: "t1", user_id: "u1" }] },
    new Set(["roamly_bookings"])
  );
  const failed = await listTripBookings({ supabase: dbFail, userId: "u1", tripId: "t1" });
  assert.deepEqual(failed.bookings, [], "failed read returns no rows");
  assert.ok(failed.error, "failed read still reports its error (the page distinguishes it from empty)");

  const page = fs.readFileSync("app/trip/[id]/bookings/page.tsx", "utf8");
  assert.match(page, /bookingsLoadError/, "page computes a load-failure flag");
  assert.match(page, /loadError=\{bookingsLoadError\}/, "page passes the flag to the timeline");
  const timeline = fs.readFileSync("components/companion/BookingWalletTimeline.tsx", "utf8");
  assert.match(timeline, /Bookings could not be loaded/, "timeline renders an explicit load-failure state");
  assert.match(timeline, /Try loading bookings again/, "failure state offers a retry");
  assert.match(timeline, /does not mean you have no bookings/, "failure state never implies an empty wallet");
}

console.log("B10–B15 booking fixes checks: PASS (corrections, review workflow, superseded predicate, budget card, zero totals, load failure)");
