// Evidence-grade checks (Round 2, Lane E2 — owner ruling 2026-10-30).
// The legacy compromise is abolished: a booking with NO recorded
// provider-issued origin and traveler_confirmed=true is
// travelerConfirmedOnly — it renders "Confirmed by you", on any
// surface. A genuine-evidence row (patterned code + real provider +
// RECORDED origin) has provider confirmation evidence at every
// surface and renders its PROVENANCE label ("Confirmed · from your
// Agoda email") — never plain "Confirmed"/"Verified" (Round 3). A cancelled row and
// a test row are neither tier.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        --import ./scripts/roamly-booking-cancel-server-only-register.mjs \
//        scripts/roamly-evidence-grade-checks.mjs   (TZ-safe: no local-time math)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bookingDisplayLabel,
  bookingTruthState,
  evidenceGrade,
  hasCredibleProviderEvidence,
  hasProviderIssuedOrigin,
  isConfirmed,
  hasProviderConfirmationEvidence,
  isTravelerConfirmedOnly,
  titleForTruth
} from "../lib/roamly/bookingTruth.ts";
import {
  bookingEvidenceGrade,
  bookingWalletSummary,
  isConfirmedBooking,
  isTravelerConfirmedOnlyBooking
} from "../lib/roamly/bookingWallet.ts";
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

// ------------------------------------------------------------ fixtures
// LEGACY: code + provider + flag + active status, but NO recorded
// source and NO provenance of any kind — the round-1 compromise case.
const LEGACY = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "AGD8X42K",
  provider_name: "Agoda",
  title: "Seaside Hotel",
  superseded_by_booking_id: null
};
// GENUINE: identical, plus a recorded provider-issued origin.
const GENUINE = { ...LEGACY, source_type: "email" };
const CANCELLED = { ...GENUINE, booking_status: "cancelled" };
const TEST_BOOKING = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "TEST-RMLY-1024-MTL2",
  provider_name: "Roamly QA Test Provider",
  source_type: "email",
  title: "Roamly QA Test Stay — Montreal",
  superseded_by_booking_id: null
};

// ------------------------------------------------------- bookingTruth
eq("legacy: grade is travelerConfirmedOnly", evidenceGrade(LEGACY), "travelerConfirmedOnly");
eq("legacy: NO provider confirmation evidence", hasProviderConfirmationEvidence(LEGACY), false);
eq("legacy: NOT confirmed", isConfirmed(LEGACY), false);
eq("legacy: travelerConfirmedOnly predicate holds", isTravelerConfirmedOnly(LEGACY), true);
eq("legacy: no credible provider evidence", hasCredibleProviderEvidence(LEGACY), false);
eq("legacy: no recorded provider-issued origin", hasProviderIssuedOrigin(LEGACY), false);
eq("legacy: state is traveler_confirmed", bookingTruthState(LEGACY), "traveler_confirmed");
eq("legacy: label is Confirmed by you", bookingDisplayLabel(LEGACY), "Confirmed by you");
eq("legacy: stamp is Confirmed by you:", titleForTruth("Seaside Hotel", bookingTruthState(LEGACY)), "Confirmed by you: Seaside Hotel");
check("legacy: stamp is never Confirmed:", titleForTruth("Seaside Hotel", bookingTruthState(LEGACY)) !== "Confirmed: Seaside Hotel");
eq(
  "legacy with an unrecorded-origin source string is still traveler-only",
  evidenceGrade({ ...LEGACY, source_type: "carrier_pigeon" }),
  "travelerConfirmedOnly"
);

eq("genuine: grade is providerConfirmationEvidence", evidenceGrade(GENUINE), "providerConfirmationEvidence");
eq("genuine: has provider confirmation evidence", hasProviderConfirmationEvidence(GENUINE), true);
eq("genuine: confirmed", isConfirmed(GENUINE), true);
eq("genuine: NOT traveler-only", isTravelerConfirmedOnly(GENUINE), false);
eq("genuine: state is confirmed", bookingTruthState(GENUINE), "confirmed");
eq("genuine: label states email provenance (Round 3)", bookingDisplayLabel(GENUINE), "Confirmed · from your Agoda email");
eq("genuine: stamp states email provenance (Round 3)", titleForTruth("Seaside Hotel", bookingTruthState(GENUINE), GENUINE), "Confirmed · from your Agoda email: Seaside Hotel");
eq(
  "genuine via email_import provenance (unknown source string) has provider confirmation evidence",
  evidenceGrade({ ...LEGACY, source_type: "carrier_pigeon", metadata: { email_import: { attached_by: "traveler" } } }),
  "providerConfirmationEvidence"
);
eq(
  "genuine via email: source reference has provider confirmation evidence",
  evidenceGrade({ ...LEGACY, source_type: "carrier_pigeon", source_reference: "email:gmail:msg-1" }),
  "providerConfirmationEvidence"
);
eq(
  "genuine via traveler-entered (manual) origin has provider confirmation evidence",
  evidenceGrade({ ...LEGACY, source_type: "manual" }),
  "providerConfirmationEvidence"
);
eq(
  "code+provider+origin but flag false is unverified (neither tier)",
  evidenceGrade({ ...GENUINE, traveler_confirmed: false }),
  "unverified"
);

eq("cancelled: grade is unverified (neither tier)", evidenceGrade(CANCELLED), "unverified");
eq("cancelled: NO provider confirmation evidence", hasProviderConfirmationEvidence(CANCELLED), false);
eq("cancelled: NOT traveler-only", isTravelerConfirmedOnly(CANCELLED), false);
eq("cancelled: state is cancelled", bookingTruthState(CANCELLED), "cancelled");
eq("test: grade is unverified (neither tier)", evidenceGrade(TEST_BOOKING), "unverified");
eq("test: NO provider confirmation evidence", hasProviderConfirmationEvidence(TEST_BOOKING), false);
eq("test: NOT traveler-only", isTravelerConfirmedOnly(TEST_BOOKING), false);
eq("test: state is test", bookingTruthState(TEST_BOOKING), "test");

// ------------------------------------------------------------ wallet
const SER_LEGACY = {
  booking_status: "confirmed",
  traveler_confirmed: true,
  confirmation_code: "AGD8X42K",
  provider: "Agoda",
  title: "Seaside Hotel",
  superseded_by_booking_id: null
};
const SER_GENUINE = { ...SER_LEGACY, source_type: "email" };
const SER_CANCELLED = { ...SER_GENUINE, booking_status: "cancelled" };
const SER_TEST = {
  booking_status: "confirmed",
  traveler_confirmed: true,
  confirmation_code: "TEST-RMLY-1024-MTL2",
  provider: "Roamly QA Test Provider",
  source_type: "email",
  title: "Roamly QA Test Stay — Montreal",
  superseded_by_booking_id: null
};
eq("wallet legacy: NOT confirmed", isConfirmedBooking(SER_LEGACY), false);
eq("wallet legacy: traveler-only predicate holds", isTravelerConfirmedOnlyBooking(SER_LEGACY), true);
eq("wallet legacy: grade travelerConfirmedOnly", bookingEvidenceGrade(SER_LEGACY), "travelerConfirmedOnly");
eq("wallet genuine: confirmed", isConfirmedBooking(SER_GENUINE), true);
eq("wallet genuine: grade providerConfirmationEvidence", bookingEvidenceGrade(SER_GENUINE), "providerConfirmationEvidence");
eq("wallet genuine: NOT traveler-only", isTravelerConfirmedOnlyBooking(SER_GENUINE), false);
eq("wallet cancelled: NOT confirmed", isConfirmedBooking(SER_CANCELLED), false);
eq("wallet cancelled: NOT traveler-only", isTravelerConfirmedOnlyBooking(SER_CANCELLED), false);
eq("wallet cancelled: grade unverified", bookingEvidenceGrade(SER_CANCELLED), "unverified");
eq("wallet test: NOT confirmed", isConfirmedBooking(SER_TEST), false);
eq("wallet test: NOT traveler-only", isTravelerConfirmedOnlyBooking(SER_TEST), false);
eq("wallet test: grade unverified", bookingEvidenceGrade(SER_TEST), "unverified");
{
  const legacySummary = bookingWalletSummary([SER_LEGACY]);
  eq("wallet summary: legacy row does NOT count as confirmed", legacySummary.confirmed, 0);
  eq("wallet summary: legacy row counts as travelerConfirmedOnly", legacySummary.travelerConfirmedOnly, 1);
  const genuineSummary = bookingWalletSummary([SER_GENUINE]);
  eq("wallet summary: genuine row counts as confirmed", genuineSummary.confirmed, 1);
  eq("wallet summary: genuine row does NOT count as traveler-only", genuineSummary.travelerConfirmedOnly, 0);
}

// ------------------------------------------------- itinerary overrides
const baseItinerary = (items) => ({
  daily_itinerary: [{ day_number: 1, date: "2026-10-10", title: "Day 1", morning: "", live_timeline: items }]
});
const overrideBooking = (row) => ({
  id: "bk-1",
  booking_type: "hotel",
  start_at: "2026-10-10T15:00:00Z",
  ...row
});
{
  const r = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking(LEGACY));
  const item = r.itinerary.daily_itinerary[0].live_timeline[0];
  eq("override legacy: stamps Confirmed by you:", item.title, "Confirmed by you: Seaside Hotel");
  check("override legacy: never stamps Confirmed:", item.title !== "Confirmed: Seaside Hotel");
  eq("override legacy: factual status is NOT verified", item.factualStatus, "unknown");
  eq("override legacy: booking_status is traveler_confirmed", item.booking_status, "traveler_confirmed");
  eq("override legacy: booking_label is Confirmed by you", item.booking_label, "Confirmed by you");
  eq("override legacy: anchor role is demoted", item.plan_role, "supporting");
}
{
  const r = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking(GENUINE));
  const item = r.itinerary.daily_itinerary[0].live_timeline[0];
  eq("override genuine: stamps its provenance (Round 3)", item.title, "Confirmed · from your Agoda email: Seaside Hotel");
  eq("override genuine: factual status is verified", item.factualStatus, "verified");
  eq("override genuine: booking_status is confirmed", item.booking_status, "confirmed");
}
{
  const r = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking(CANCELLED));
  const item = r.itinerary.daily_itinerary[0].live_timeline[0];
  eq("override cancelled: stamps Cancelled:", item.title, "Cancelled: Seaside Hotel");
  eq("override cancelled: factual status is NOT verified", item.factualStatus, "unknown");
}
{
  const r = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking(TEST_BOOKING));
  eq("override test: stamps nothing", r.changed, false);
}
{
  // Read path: a stale "Confirmed:" item linked to a legacy booking
  // is re-titled honestly, never left wearing the verified stamp.
  const stale = {
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
  const out = reconcileItineraryItemsWithCurrentBookings(baseItinerary([structuredClone(stale)]), [overrideBooking(LEGACY)]);
  const item = out.daily_itinerary[0].live_timeline[0];
  eq("reconcile legacy: title becomes Confirmed by you:", item.title, "Confirmed by you: Seaside Hotel");
  eq("reconcile legacy: verified factual status is downgraded", item.factualStatus, "unknown");
  eq("reconcile legacy: booking_label becomes Confirmed by you", item.booking_label, "Confirmed by you");
  eq("reconcile legacy: booking_status becomes traveler_confirmed", item.booking_status, "traveler_confirmed");
}

// ------------------------------------------------------- place detail
const TRIP = { destination: "Montreal, Canada", origin: "Saint John", start_date: "2026-10-26", end_date: "2026-10-30" };
const ITEM = {
  item_id: "i1",
  title: "Seaside Hotel",
  description: "A hotel.",
  location_name: "Old Port",
  startTime: "15:00",
  endTime: "16:00",
  category: "hotel"
};
function placeFor(bookings) {
  return buildPlaceDetail({
    item: ITEM,
    day: { day_number: 1, date: "2026-10-26", live_timeline: [ITEM] },
    siblings: [],
    trip: TRIP,
    tripTips: [],
    confirmedBookings: bookings,
    photo: null
  });
}
{
  const d = placeFor([{ ...LEGACY, address: "123 Seaside St" }]);
  eq("place legacy: badge is Confirmed by you", d?.badge, "Confirmed by you");
  eq("place legacy: evidence.confirmed is false", d?.evidence.confirmed, false);
  eq("place legacy: evidence.travelerConfirmed is true", d?.evidence.travelerConfirmed, true);
  eq("place legacy: address is withheld (provider-grade evidence only)", d?.about.address, null);
}
{
  const d = placeFor([{ ...GENUINE, address: "123 Seaside St" }]);
  eq("place genuine: badge states email provenance (Round 3)", d?.badge, "Confirmed · from your Agoda email");
  eq("place genuine: evidence.confirmed is true", d?.evidence.confirmed, true);
  eq("place genuine: evidence.travelerConfirmed is false", d?.evidence.travelerConfirmed, false);
  eq("place genuine: address is released", d?.about.address, "123 Seaside St");
}
{
  const d = placeFor([{ ...CANCELLED, address: "123 Seaside St" }]);
  eq("place cancelled: badge is Cancelled", d?.badge, "Cancelled");
  eq("place cancelled: evidence.confirmed is false", d?.evidence.confirmed, false);
  eq("place cancelled: evidence.travelerConfirmed is false", d?.evidence.travelerConfirmed, false);
  eq("place cancelled: address is withheld", d?.about.address, null);
}
{
  const testRow = { ...TEST_BOOKING, title: "Seaside Hotel", address: "123 Seaside St" };
  const d = placeFor([testRow]);
  check("place test: badge is neither Confirmed nor Confirmed by you", d?.badge !== "Confirmed" && d?.badge !== "Confirmed by you");
  eq("place test: evidence.confirmed is false", d?.evidence.confirmed, false);
  eq("place test: evidence.travelerConfirmed is false", d?.evidence.travelerConfirmed, false);
  eq("place test: address is withheld", d?.about.address, null);
}

// -------------------------------------------------------- source pins
{
  const notifications = read("app/notifications/page.tsx");
  check("alerts: traveler-only rows are worded 'booking confirmed by you'", notifications.includes("booking confirmed by you"));
  check("alerts: confirmation-evidence rows carry provenance (Round 3)", notifications.includes("`${typeLabel} booking confirmed · ${bookingProvenanceSuffix"));
  const timeline = read("components/companion/BookingWalletTimeline.tsx");
  check("wallet timeline: traveler-only label is Confirmed by you", timeline.includes('return "Confirmed by you"'));
  const live = read("app/trip/[id]/live/page.tsx");
  check("live: internal verified status derives from bookingTruth.isConfirmed (confirmation-evidence only)", live.includes("bookingTruthIsConfirmed"));
}

console.log(`\n${passed} evidence-grade checks passed`);
