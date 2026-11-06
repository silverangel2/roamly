// Cancelled-notification attribution checks (defect X1 residual, Round 3 Lane N).
//
// Round 1 suppressed a persisted Alerts notification only when it was
// marked withdrawn, event-linked to an inactive booking, or its title
// EXACTLY matched (page normalization: trim/ws-collapse/lowercase) a
// currently inactive booking's title. A pre-fix row with no event link
// and no exact title match still rendered as live (baseline evidence:
// verification/round3/lane-n/baseline.log).
//
// This suite drives the REAL read-path helper the Alerts page now
// renders by (lib/roamly/notificationBookingAttribution.ts) with
// synthetic local fixtures only — no stored rows are read or written.
//
// Rule under test (precision over recall): the round-1 tiers are
// unchanged; the new tiers act only for cancelled/refunded candidates,
// on booking-related rows, on the same trip, with multiple agreeing
// signals (fuzzy title + provider-or-window, or provider + window),
// and never when an active booking explains the row at least as well.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        --import ./scripts/roamly-booking-cancel-server-only-register.mjs \
//        scripts/roamly-cancelled-notification-attribution-checks.mjs   (TZ-safe)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attributionTitleMatch,
  normalizeAttributionTitle,
  normalizeExactTitle,
  suppressedCancelledNotifications
} from "../lib/roamly/notificationBookingAttribution.ts";
import { bookingTruthState } from "../lib/roamly/bookingTruth.ts";

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

const TRIP = "trip-1";
const STAY = { start_at: "2026-10-10T15:00:00Z", start_date: "2026-10-10", end_date: "2026-10-12", end_at: "2026-10-12T11:00:00Z" };
const EVIDENCE = { traveler_confirmed: true, confirmation_number: "AGD8X42K", source_type: "email", superseded_by_booking_id: null, metadata: {} };

function cancelledBooking(patch = {}) {
  return {
    id: "bk-cancelled", trip_id: TRIP, booking_type: "hotel", booking_status: "cancelled",
    title: "Seaside Hotel", provider_name: "Agoda", ...EVIDENCE, ...STAY, ...patch
  };
}
function activeBooking(patch = {}) {
  return {
    id: "bk-active", trip_id: TRIP, booking_type: "hotel", booking_status: "booked",
    title: "Harbour View Inn", provider_name: "Booking.com", ...EVIDENCE, ...STAY, ...patch
  };
}
function notification(patch = {}) {
  return {
    id: "n-1", trip_id: TRIP, event_id: null, type: "booking_confirmed",
    title: "Seaside Hotel", body: "Agoda at Oct 10, 2026, 3:00 PM.",
    scheduled_for: "2026-10-10T15:00:00Z", metadata: {}, ...patch
  };
}
function suppressed(notifications, bookings, eventBookingById = {}) {
  return suppressedCancelledNotifications({ notifications, bookings, eventBookingById });
}

// ------------------------------------------------------------ units
eq("truth control: cancelled fixture grades cancelled", bookingTruthState(cancelledBooking()), "cancelled");
eq("truth control: active fixture grades confirmed", bookingTruthState(activeBooking()), "confirmed");
eq("round-1 normalization keeps punctuation", normalizeExactTitle("  SEASIDE   Hotel! "), "seaside hotel!");
eq("aggressive normalization strips the stamp prefix", normalizeAttributionTitle("Confirmed: Seaside Hotel"), "seaside hotel");
eq("aggressive normalization strips the traveler stamp", normalizeAttributionTitle("Confirmed by you: Seaside Hotel"), "seaside hotel");
eq("aggressive normalization folds case + punctuation", normalizeAttributionTitle("SEASIDE HOTEL!"), "seaside hotel");
eq("title match: containment for an extended title", attributionTitleMatch("seaside hotel montreal", "seaside hotel"), "containment");
eq("title match: none for unrelated titles", attributionTitleMatch("your stay is coming up", "seaside hotel"), null);
eq("title match: short titles never fuzzy-match", attributionTitleMatch("seaside hotel suites extra words here", "sea"), null);

// ------------------------------------------------- (a) exact title
{
  const out = suppressed([notification()], [cancelledBooking()]);
  check("(a) no link + exact title: suppressed", out.has("n-1"));
  eq("(a) tier is the round-1 exact_title", out.get("n-1")?.tier, "exact_title");
  eq("(a) attributed to the cancelled booking", out.get("n-1")?.bookingId, "bk-cancelled");
}

// ------------------------------------------- (b) fuzzy title matches
{
  const out = suppressed([notification({ title: "Confirmed: Seaside Hotel" })], [cancelledBooking()]);
  check("(b1) stamp prefix + provider + window: suppressed", out.has("n-1"));
  eq("(b1) tier is fuzzy_title", out.get("n-1")?.tier, "fuzzy_title");
}
{
  const out = suppressed([notification({ type: "booking_reminder", title: "SEASIDE HOTEL!" })], [cancelledBooking()]);
  check("(b2) case/punctuation drift + provider + window: suppressed", out.has("n-1"));
  eq("(b2) tier is fuzzy_title", out.get("n-1")?.tier, "fuzzy_title");
}
{
  const out = suppressed([notification({ type: "booking_reminder", title: "Seaside Hotel, Montreal" })], [cancelledBooking()]);
  check("(b3) extended property name + provider + window: suppressed", out.has("n-1"));
  eq("(b3) tier is fuzzy_title", out.get("n-1")?.tier, "fuzzy_title");
}
{
  const booking = cancelledBooking({ id: "bk-grand", title: "Grand Seaside Hotel & Spa" });
  const out = suppressed(
    [notification({ type: "booking_reminder", title: "Grand Seaside Hotel", body: "Agoda at Oct 10, 2026, 3:00 PM." })],
    [booking]
  );
  check("(b4) truncated property name + provider + window: suppressed", out.has("n-1"));
  eq("(b4) tier is fuzzy_title", out.get("n-1")?.tier, "fuzzy_title");
}
{
  // Corroboration can be the window alone when the body names no provider.
  const out = suppressed(
    [notification({ type: "booking_reminder", title: "Seaside Hotel, Montreal", body: "Your booking is ready." })],
    [cancelledBooking()]
  );
  check("(b5) extended title + window only (no provider in body): suppressed", out.has("n-1"));
}

// ------------------------------------- (c) provider + window, no title
{
  const out = suppressed(
    [notification({ type: "check_in_reminder", title: "Your stay is coming up" })],
    [cancelledBooking()]
  );
  check("(c) no link + no title match, same trip + provider + window: suppressed", out.has("n-1"));
  eq("(c) tier is provider_window", out.get("n-1")?.tier, "provider_window");
  eq("(c) attributed to the cancelled booking", out.get("n-1")?.bookingId, "bk-cancelled");
}

// ---------------------------------------------------- (d) CONTROL
{
  const out = suppressed(
    [notification({ title: "Harbour View Inn", body: "Booking.com at Oct 10, 2026, 3:00 PM." })],
    [activeBooking()]
  );
  check("(d) CONTROL: active booking's exact notification is never suppressed", !out.has("n-1"));
}
{
  const out = suppressed(
    [notification({ title: "Harbour View Inn", body: "Booking.com at Oct 10, 2026, 3:00 PM." })],
    [cancelledBooking(), activeBooking()]
  );
  check("(d) CONTROL: active notification survives with a cancelled booking on the same trip", !out.has("n-1"));
}

// --------------------------- (e) same-trip two-booking guard (hardest)
{
  const activeSuites = activeBooking({ id: "bk-suites", title: "Seaside Hotel Suites", provider_name: "Agoda" });
  const cancelledNote = notification({ id: "n-cancelled", title: "Seaside Hotel" });
  const activeNote = notification({ id: "n-active", type: "booking_reminder", title: "Seaside Hotel Suites" });
  const out = suppressed([cancelledNote, activeNote], [cancelledBooking(), activeSuites]);
  check("(e) guard: the cancelled booking's own row is still suppressed", out.has("n-cancelled"));
  check("(e) guard: the ACTIVE booking's similar-title row survives (active exact-title veto)", !out.has("n-active"));
}
{
  // Ambiguity without an exact active match: both bookings fuzzy-match
  // with the same corroboration — the row is left rendering.
  const cancelledMontreal = cancelledBooking({ id: "bk-mtl", title: "Seaside Hotel Montreal" });
  const activeQuebec = activeBooking({ id: "bk-qc", title: "Seaside Hotel Quebec", provider_name: "Agoda" });
  const out = suppressed([notification({ type: "booking_reminder", title: "Seaside Hotel" })], [cancelledMontreal, activeQuebec]);
  check("(e2) ambiguous fuzzy match (cancelled + active equally plausible): survives", !out.has("n-1"));
}

// ------------------------------------------- precision: single signals
{
  const out = suppressed(
    [notification({ type: "booking_reminder", title: "Seaside Hotel, Montreal", body: "Your booking is ready.", scheduled_for: "2026-09-01T09:00:00Z" })],
    [cancelledBooking()]
  );
  check("(f) fuzzy title ALONE (no provider, outside window): survives", !out.has("n-1"));
}
{
  const out = suppressed(
    [notification({ type: "check_in_reminder", title: "Your stay is coming up", scheduled_for: null })],
    [cancelledBooking()]
  );
  check("(f2) provider ALONE (no window, no title): survives", !out.has("n-1"));
}
{
  const out = suppressed(
    [notification({ type: "check_in_reminder", title: "Your stay is coming up", body: "Your booking is ready." })],
    [cancelledBooking()]
  );
  check("(f3) window ALONE (no provider, no title): survives", !out.has("n-1"));
}

// ------------------------------------------------------- other guards
{
  const refunded = cancelledBooking({ booking_status: "refunded" });
  const out = suppressed([notification({ title: "Confirmed: Seaside Hotel" })], [refunded]);
  check("refunded candidate: fuzzy tier applies", out.has("n-1"));
}
{
  const superseded = cancelledBooking({ booking_status: "booked", superseded_by_booking_id: "bk-new" });
  eq("superseded fixture grades superseded", bookingTruthState(superseded), "superseded");
  const out = suppressed([notification({ title: "Confirmed: Seaside Hotel" })], [superseded]);
  check("superseded candidate: NEW tiers do not act (round-1 tiers only)", !out.has("n-1"));
}
{
  const out = suppressed(
    [notification({ trip_id: "trip-2", title: "Confirmed: Seaside Hotel" })],
    [cancelledBooking()]
  );
  check("cross-trip row: fuzzy tier never crosses trips", !out.has("n-1"));
}
{
  const out = suppressed(
    [notification({ type: "daily_briefing", title: "Seaside Hotel, Montreal" })],
    [cancelledBooking()]
  );
  check("non-booking type: new tiers never act", !out.has("n-1"));
}
{
  // Date-only booking window (no start_at/end_at stored).
  const dateOnly = cancelledBooking({ start_at: null, end_at: null });
  const out = suppressed(
    [notification({ type: "check_in_reminder", title: "Your stay is coming up", scheduled_for: "2026-10-11T09:00:00Z" })],
    [dateOnly]
  );
  check("provider + window with date-only stay bounds: suppressed", out.has("n-1"));
}

// ------------------------------------------- round-1 tiers regression
{
  const out = suppressed([notification({ metadata: { withdrawn: true } })], [activeBooking()]);
  eq("round-1: withdrawn rows stay suppressed", out.get("n-1")?.tier, "withdrawn");
}
{
  const out = suppressed(
    [notification({ event_id: "ev-1", type: "daily_briefing", title: "Unrelated title" })],
    [cancelledBooking()],
    { "ev-1": "bk-cancelled" }
  );
  eq("round-1: event-linked rows stay suppressed", out.get("n-1")?.tier, "event_link");
}
{
  const out = suppressed(
    [notification({ event_id: "ev-9", title: "Unrelated title", body: "Nothing here.", scheduled_for: null })],
    [cancelledBooking()],
    { "ev-9": "bk-active" }
  );
  check("round-1: event link to an ACTIVE booking does not suppress", !out.has("n-1"));
}

// ------------------------------------------------------------ wiring
{
  const page = read("app/notifications/page.tsx");
  check("wiring: Alerts page imports the attribution helper", page.includes("suppressedCancelledNotifications") && page.includes("notificationBookingAttribution"));
  check("wiring: Alerts page feeds its fetched rows to the helper", page.includes("notifications: travelUpdateItems") && page.includes("bookings: allTripBookings") && page.includes("eventBookingById"));
  const helper = read("lib/roamly/notificationBookingAttribution.ts");
  check("wiring: helper derives truth from bookingTruth (no local status rule)", helper.includes("bookingTruthState") && helper.includes("isInactiveTruthState"));
  check("wiring: helper performs no writes (read-time only)", !/\.update\(|\.insert\(|\.delete\(|\.upsert\(/.test(helper));
}

console.log(`\n${passed} cancelled-notification-attribution checks passed`);
