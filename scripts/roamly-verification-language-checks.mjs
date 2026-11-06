// Verification-language checks (Round 3, Lane T — owner ruling
// 2026-10-30). No user-visible booking display may claim a stronger
// verification than the evidence proves. The confirmation-evidence
// tier (patterned code + real provider + RECORDED origin +
// traveler_confirmed + active + non-test) is earned by evidence
// CONTAINED IN traveler-supplied material — Roamly never checks the
// booking with the provider through an independent channel — so
// every surface must state the true provenance and must never render
// "verified"/"Verified" (or a bare "Confirmed") for classes (b)/(c)/(d):
//   (b) email-sourced        -> "Confirmed · from your {Provider} email"
//   (c) screenshot-sourced   -> "Confirmed · from your screenshot"
//   (c) manual-sourced       -> "Confirmed · from details you provided"
//   (c) provider-reported    -> "Confirmed · reported by {Provider}"
//   (d) traveler assertion   -> "Confirmed by you" (unchanged)
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        --import ./scripts/roamly-booking-cancel-server-only-register.mjs \
//        scripts/roamly-verification-language-checks.mjs   (TZ-safe: no local-time math)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bookingDisplayLabel,
  bookingProvenanceClass,
  bookingProvenanceLabel,
  bookingProvenanceSuffix,
  evidenceGrade,
  hasProviderConfirmationEvidence,
  stripBookingStampPrefix,
  titleForTruth,
  bookingTruthState
} from "../lib/roamly/bookingTruth.ts";
import { walletBookingDisplayLabel, bookingWalletSummary } from "../lib/roamly/bookingWallet.ts";
import {
  applyConfirmedBookingOverrideToItinerary,
  reconcileItineraryItemsWithCurrentBookings
} from "../lib/roamly/itineraryBookingOverrides.ts";
import { buildPlaceDetail } from "../lib/roamly/placeDetail.ts";
import { buildDailyTripBriefingContent } from "../lib/roamly/dailyTripBriefingContent.ts";

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
// A display string claims verification if it contains "verif" in any
// form OTHER than an explicit negation ("not verified").
function claimsVerified(text) {
  return /verif/i.test(String(text).replace(/not (?:provider-)?verified/gi, ""));
}

const BASE = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "AGD8X42K",
  provider_name: "Agoda",
  title: "Seaside Hotel",
  superseded_by_booking_id: null
};
const EMAIL_B = { ...BASE, source_type: "email" };
const GMAIL_B = { ...BASE, source_type: "gmail", provider_name: "Air Canada", confirmation_number: "AC8X42K9" };
const SCREENSHOT_C = { ...BASE, source_type: "screenshot" };
const MANUAL_C = { ...BASE, source_type: "manual" };
const AFFILIATE_C = { ...BASE, source_type: "affiliate" };
const TRAVELER_D = { ...BASE }; // no recorded origin at all
const CANCELLED = { ...EMAIL_B, booking_status: "cancelled" };
const TEST_BOOKING = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "TEST-RMLY-1024-MTL2",
  provider_name: "Roamly QA Test Provider",
  source_type: "email",
  title: "Roamly QA Test Stay — Montreal",
  superseded_by_booking_id: null
};

// ------------------------------------------------------- truth level
eq("class (b) email: grade is providerConfirmationEvidence", evidenceGrade(EMAIL_B), "providerConfirmationEvidence");
eq("class (b) email: internal predicate renamed", hasProviderConfirmationEvidence(EMAIL_B), true);
eq("class (b) email: provenance class is email", bookingProvenanceClass(EMAIL_B), "email");
eq("class (b) email: suffix names the provider email", bookingProvenanceSuffix(EMAIL_B), "from your Agoda email");
eq("class (b) email: label", bookingDisplayLabel(EMAIL_B), "Confirmed · from your Agoda email");
eq("class (b) gmail: label names the provider email", bookingDisplayLabel(GMAIL_B), "Confirmed · from your Air Canada email");
eq("class (b) via email_import metadata: label is email provenance", bookingDisplayLabel({ ...TRAVELER_D, metadata: { email_import: { attached_by: "traveler" } } }), "Confirmed · from your Agoda email");
eq("class (c) screenshot: label", bookingDisplayLabel(SCREENSHOT_C), "Confirmed · from your screenshot");
eq("class (c) manual: label", bookingDisplayLabel(MANUAL_C), "Confirmed · from details you provided");
eq("class (c) affiliate-reported: label", bookingDisplayLabel(AFFILIATE_C), "Confirmed · reported by Agoda");
eq("class (d) traveler-only: label is Confirmed by you (unchanged)", bookingDisplayLabel(TRAVELER_D), "Confirmed by you");
eq("cancelled: label is Cancelled", bookingDisplayLabel(CANCELLED), "Cancelled");
eq("test: label is Test booking", bookingDisplayLabel(TEST_BOOKING), "Test booking");
for (const [name, booking] of [["email (b)", EMAIL_B], ["screenshot (c)", SCREENSHOT_C], ["manual (c)", MANUAL_C], ["affiliate (c)", AFFILIATE_C], ["traveler-only (d)", TRAVELER_D]]) {
  check(`${name}: display label never claims verified`, !claimsVerified(bookingDisplayLabel(booking)));
  check(`${name}: display label is never a bare Confirmed`, bookingDisplayLabel(booking) !== "Confirmed");
}

// ------------------------------------------------------- title stamps
eq("stamp (b): provenance stamp", titleForTruth("Seaside Hotel", bookingTruthState(EMAIL_B), EMAIL_B), "Confirmed · from your Agoda email: Seaside Hotel");
eq("stamp (c): screenshot stamp", titleForTruth("Seaside Hotel", bookingTruthState(SCREENSHOT_C), SCREENSHOT_C), "Confirmed · from your screenshot: Seaside Hotel");
eq("stamp (d): Confirmed by you stamp (unchanged)", titleForTruth("Seaside Hotel", bookingTruthState(TRAVELER_D), TRAVELER_D), "Confirmed by you: Seaside Hotel");
eq("stamp: provenance stamp strips back to the bare title", stripBookingStampPrefix("Confirmed · from your Agoda email: Seaside Hotel"), "Seaside Hotel");
eq("stamp: re-stamping a provenance stamp is idempotent", titleForTruth("Confirmed · from your Agoda email: Seaside Hotel", bookingTruthState(EMAIL_B), EMAIL_B), "Confirmed · from your Agoda email: Seaside Hotel");
eq("stamp: cancelled never carries a confirmed stamp", titleForTruth("Seaside Hotel", bookingTruthState(CANCELLED), CANCELLED), "Cancelled: Seaside Hotel");

// ------------------------------------------------------------ wallet
const SER = (row) => ({
  booking_status: "confirmed",
  traveler_confirmed: true,
  confirmation_code: row.confirmation_number,
  provider: row.provider_name,
  source_type: row.source_type,
  title: row.title,
  superseded_by_booking_id: null
});
eq("wallet (b): label states email provenance", walletBookingDisplayLabel(SER(EMAIL_B)), "Confirmed · from your Agoda email");
eq("wallet (c): label states screenshot provenance", walletBookingDisplayLabel(SER(SCREENSHOT_C)), "Confirmed · from your screenshot");
eq("wallet (d): label is Confirmed by you", walletBookingDisplayLabel({ ...SER(TRAVELER_D), source_type: undefined }), "Confirmed by you");
{
  const timeline = read("components/companion/BookingWalletTimeline.tsx");
  check("wallet timeline: confirmed pill derives from walletBookingDisplayLabel", timeline.includes("walletBookingDisplayLabel(booking)"));
  check("wallet timeline: no bare \"Confirmed\" pill remains", !timeline.includes('? "Confirmed"') && !timeline.includes(': "Confirmed";'));
  const wallet = read("lib/roamly/bookingWallet.ts");
  check("wallet feed: title gated on the full truth rule", wallet.includes("bookingTruthIsConfirmed(writeBooking)"));
  check("wallet feed: old bare-code gate is gone", !wallet.includes("feedHasProviderEvidence"));
  check("wallet feed: confirmed title carries provenance label", wallet.includes("bookingTruthDisplayLabel(writeBooking)"));
}

// ------------------------------------------------- itinerary overrides
const baseItinerary = (items) => ({
  daily_itinerary: [{ day_number: 1, date: "2026-10-10", title: "Day 1", morning: "", live_timeline: items }]
});
const overrideBooking = (row) => ({ id: "bk-1", booking_type: "hotel", start_at: "2026-10-10T15:00:00Z", ...row });
{
  const item = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking(EMAIL_B)).itinerary.daily_itinerary[0].live_timeline[0];
  eq("override (b): title stamp states provenance", item.title, "Confirmed · from your Agoda email: Seaside Hotel");
  eq("override (b): booking_label states provenance", item.booking_label, "Confirmed · from your Agoda email");
  check("override (b): description states provenance", String(item.description).startsWith("Confirmed · from your Agoda email;"));
  check("override (b): no display field claims verified", !claimsVerified(item.title) && !claimsVerified(item.booking_label) && !claimsVerified(item.description));
}
{
  const item = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking(SCREENSHOT_C)).itinerary.daily_itinerary[0].live_timeline[0];
  eq("override (c): title stamp states screenshot provenance", item.title, "Confirmed · from your screenshot: Seaside Hotel");
}
{
  // Read path: a stored plain "Confirmed:" stamp on a class-(b)
  // booking is re-stamped to its provenance at render.
  const stale = {
    item_id: "i1", booking_id: "bk-1", title: "Confirmed: Seaside Hotel",
    description: "Confirmed booking; this replaces the itinerary recommendation as the actual reservation.",
    category: "Confirmed booking", booking_label: "Confirmed booking",
    booking_status: "confirmed", factualStatus: "verified", timing_status: "FACTUAL",
    plan_role: "protected_anchor", startTime: "15:00"
  };
  const out = reconcileItineraryItemsWithCurrentBookings(baseItinerary([structuredClone(stale)]), [overrideBooking(EMAIL_B)]);
  const item = out.daily_itinerary[0].live_timeline[0];
  eq("reconcile (b): stale plain stamp becomes the provenance stamp", item.title, "Confirmed · from your Agoda email: Seaside Hotel");
  eq("reconcile (b): booking_label becomes the provenance label", item.booking_label, "Confirmed · from your Agoda email");
  eq("reconcile (b): factual status stays verified-tier internal value", item.factualStatus, "verified");
}

// ------------------------------------------------------- place detail
const TRIP = { destination: "Montreal, Canada", origin: "Saint John", start_date: "2026-10-26", end_date: "2026-10-30" };
const ITEM = { item_id: "i1", title: "Seaside Hotel", description: "A hotel.", location_name: "Old Port", startTime: "15:00", endTime: "16:00", category: "hotel" };
function placeFor(bookings) {
  return buildPlaceDetail({
    item: ITEM,
    day: { day_number: 1, date: "2026-10-26", live_timeline: [ITEM] },
    siblings: [], trip: TRIP, tripTips: [], confirmedBookings: bookings, photo: null
  });
}
eq("place (b): badge states email provenance", placeFor([{ ...EMAIL_B, address: "123 Seaside St" }])?.badge, "Confirmed · from your Agoda email");
eq("place (c): badge states screenshot provenance", placeFor([{ ...SCREENSHOT_C, address: "123 Seaside St" }])?.badge, "Confirmed · from your screenshot");
eq("place (d): badge is Confirmed by you", placeFor([{ ...TRAVELER_D, address: "123 Seaside St" }])?.badge, "Confirmed by you");
eq("place cancelled: badge is Cancelled", placeFor([{ ...CANCELLED, address: "123 Seaside St" }])?.badge, "Cancelled");
check("place test: badge is neither provenance Confirmed nor Confirmed by you", !String(placeFor([{ ...TEST_BOOKING, title: "Seaside Hotel", address: "123 Seaside St" }])?.badge).startsWith("Confirmed"));

// ------------------------------------------------------ notifications
{
  const notifications = read("app/notifications/page.tsx");
  check("alerts: confirmed rows carry the provenance suffix", notifications.includes("booking confirmed · ${bookingProvenanceSuffix"));
  check("alerts: traveler-only rows keep 'booking confirmed by you'", notifications.includes("booking confirmed by you"));
  check("alerts: no plain confirmed title remains for the evidence tier", !notifications.includes("`${typeLabel} booking confirmed`,"));
}

// ------------------------------------------------------------- briefings
{
  const content = buildDailyTripBriefingContent({
    destination: "Tokyo", dayKey: "2026-10-11", timezone: "Asia/Tokyo",
    now: new Date("2026-10-10T22:30:00.000Z"),
    bookings: [{ id: "flight", booking_type: "flight", booking_status: "confirmed", title: "Air Canada", start_at: "2026-10-11T01:00:00.000Z", traveler_confirmed: true }],
    activities: [], liveCompanionIncluded: false, tripPath: "/trip/trip-1/live"
  });
  check("briefing (d): traveler-only booking is headed 'Booked', not 'Confirmed'", content.body.includes("Booked: Air Canada"));
  check("briefing (d): booking label carries 'confirmed by you'", content.body.includes("confirmed by you"));
  check("briefing (d): body never claims verified", !claimsVerified(content.body));
  const contentB = buildDailyTripBriefingContent({
    destination: "Tokyo", dayKey: "2026-10-11", timezone: "Asia/Tokyo",
    now: new Date("2026-10-10T22:30:00.000Z"),
    bookings: [{ id: "flight", booking_type: "flight", booking_status: "booked", title: "Air Canada", provider_name: "Air Canada", confirmation_number: "AC8X42K9", source_type: "email", start_at: "2026-10-11T01:00:00.000Z", traveler_confirmed: true }],
    activities: [], liveCompanionIncluded: false, tripPath: "/trip/trip-1/live"
  });
  check("briefing (b): booking label states its email provenance", contentB.body.includes("from your Air Canada email"));
}

// ------------------------------------------------------------ live copy
{
  const liveClient = read("components/trip/LiveTripClient.tsx");
  check("live: explainer no longer says 'verified booking'", !liveClient.includes("Confirmed only for a verified booking"));
  check("live: explainer says confirmation evidence on file", liveClient.includes("Confirmed only for a booking with confirmation evidence on file"));
  const manualForm = read("components/companion/ManualBookingForm.tsx");
  check("manual form: no 'Roamly can verify it' claim", !manualForm.includes("so Roamly can verify it"));
}

console.log(`\n${passed} verification-language checks passed`);
