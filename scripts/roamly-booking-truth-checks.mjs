// Booking-truth semantics checks (Workstream A regression suite).
// Drives the ONE truth module (lib/roamly/bookingTruth.ts) directly, plus
// the surfaces that delegate to it: the wallet's isConfirmedBooking, the
// itinerary override stamper, and the place-detail badge inputs.
// Owner semantics pinned here: "Confirmed" requires ALL of credible
// patterned code + real provider + provider-issued origin +
// traveler_confirmed === true + active status + non-test. A confirmation
// code ALONE (the attach outcome: flag false, status needs_confirmation)
// is never confirmed, on any surface.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        --import ./scripts/roamly-booking-cancel-server-only-register.mjs \
//        scripts/roamly-booking-truth-checks.mjs   (TZ-safe: no local-time math)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bookingDisplayLabel,
  bookingTruthState,
  evidenceGrade,
  hasCredibleProviderEvidence,
  isConfirmed,
  hasProviderConfirmationEvidence,
  isTravelerConfirmedOnly,
  titleForTruth
} from "../lib/roamly/bookingTruth.ts";
import { isConfirmedBooking } from "../lib/roamly/bookingWallet.ts";
import { applyConfirmedBookingOverrideToItinerary } from "../lib/roamly/itineraryBookingOverrides.ts";
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

// The full house: every ingredient present at once.
const FULL = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "AGD8X42K",
  provider_name: "Agoda",
  source_type: "email",
  title: "Seaside Hotel",
  superseded_by_booking_id: null
};
const variant = (patch) => ({ ...FULL, ...patch });
const without = (key) => {
  const b = { ...FULL };
  delete b[key];
  return b;
};

eq("full house is confirmed", isConfirmed(FULL), true);
eq("full house state is confirmed", bookingTruthState(FULL), "confirmed");
eq("full house label states email provenance (Round 3)", bookingDisplayLabel(FULL), "Confirmed · from your Agoda email");
eq("full house has credible provider evidence", hasCredibleProviderEvidence(FULL), true);

// ---- Each single missing ingredient => NOT confirmed ----
const missingIngredient = [
  ["no confirmation code", without("confirmation_number")],
  ["placeholder code", variant({ confirmation_number: "pending" })],
  ["too-short code", variant({ confirmation_number: "AB1" })],
  ["code without digit and too short", variant({ confirmation_number: "ABCDE" })],
  ["no provider", without("provider_name")],
  ["pseudo provider (Gmail)", variant({ provider_name: "Gmail" })],
  ["pseudo provider (manual)", variant({ provider_name: "manual" })],
  ["unrecorded origin (unknown source string)", variant({ source_type: "carrier_pigeon" })],
  ["traveler_confirmed false", variant({ traveler_confirmed: false })],
  ["traveler_confirmed missing", without("traveler_confirmed")],
  ["status needs_confirmation", variant({ booking_status: "needs_confirmation" })],
  ["status missing", without("booking_status")],
  ["superseded", variant({ superseded_by_booking_id: "booking-2" })],
  ["is_test_booking flag", variant({ is_test_booking: true })],
  ["metadata qa_test", variant({ metadata: { qa_test: true } })]
];
for (const [name, booking] of missingIngredient) {
  eq(`not confirmed when ${name}`, isConfirmed(booking), false);
}

// ---- Origin alternatives that DO satisfy the provider-issued leg ----
// Round 2 (owner ruling 2026-10-30): the round-1 legacy compromise is
// ABOLISHED. A no-recorded-source row with the flag set is NOT
// provider-verified and NOT confirmed — it is travelerConfirmedOnly
// and renders "Confirmed by you". (Stricter replacement, diff in
// lane-Ev-r2.md.)
eq("legacy row, no recorded source, flag already set => NOT confirmed", isConfirmed(without("source_type")), false);
eq("legacy row, no recorded source => NO provider confirmation evidence", hasProviderConfirmationEvidence(without("source_type")), false);
eq("legacy row, no recorded source => no credible provider evidence", hasCredibleProviderEvidence(without("source_type")), false);
eq("legacy row, no recorded source => travelerConfirmedOnly", isTravelerConfirmedOnly(without("source_type")), true);
eq("legacy row, no recorded source => grade travelerConfirmedOnly", evidenceGrade(without("source_type")), "travelerConfirmedOnly");
eq("legacy row, no recorded source => state traveler_confirmed", bookingTruthState(without("source_type")), "traveler_confirmed");
eq("legacy row, no recorded source => label Confirmed by you", bookingDisplayLabel(without("source_type")), "Confirmed by you");
eq("full house grade is providerConfirmationEvidence", evidenceGrade(FULL), "providerConfirmationEvidence");
eq("manual (traveler-entered) origin => confirmed", isConfirmed(variant({ source_type: "manual" })), true);
eq("screenshot origin => confirmed", isConfirmed(variant({ source_type: "screenshot" })), true);
eq(
  "email_import provenance in metadata => confirmed",
  isConfirmed(variant({ source_type: "carrier_pigeon", metadata: { email_import: { attached_by: "traveler" } } })),
  true
);
eq(
  "source_reference email: provenance => confirmed",
  isConfirmed(variant({ source_type: "carrier_pigeon", source_reference: "email:gmail:msg-1" })),
  true
);
eq(
  "camelCase serialized shape => confirmed",
  isConfirmed({
    status: "confirmed",
    travelerConfirmed: true,
    confirmationCode: "AGD8X42K",
    provider: "Agoda",
    sourceType: "gmail",
    title: "Seaside Hotel"
  }),
  true
);

// ---- Confirmation code ALONE (the attach outcome) is never confirmed ----
// Attach hardcodes travelerConfirmed:false and status needs_confirmation;
// the booking carries a real code, a real provider and an email origin.
const ATTACH = {
  booking_status: "needs_confirmation",
  traveler_confirmed: false,
  confirmation_number: "AGD8X42K",
  provider_name: "Agoda",
  source_type: "email",
  title: "Seaside Hotel",
  superseded_by_booking_id: null
};
eq("attach-shaped booking: evidence leg alone holds (code+provider+origin)", hasCredibleProviderEvidence(ATTACH), true);
eq("attach-shaped booking is NOT confirmed (flag false)", isConfirmed(ATTACH), false);
eq("attach-shaped booking state is email_unverified", bookingTruthState(ATTACH), "email_unverified");
eq("attach-shaped booking label is the unverified label", bookingDisplayLabel(ATTACH), "From your email — not verified");
eq("attach-shaped booking gets no Confirmed: stamp", titleForTruth("Seaside Hotel", bookingTruthState(ATTACH)), "Seaside Hotel");
eq("bare code with nothing around it is not credible evidence", hasCredibleProviderEvidence({ confirmation_number: "AGD8X42K" }), false);
eq("bare code with nothing around it is not confirmed", isConfirmed({ confirmation_number: "AGD8X42K" }), false);

// ---- TEST-RMLY-shaped booking row: never confirmed, never stamped ----
const TEST_BOOKING = {
  booking_status: "booked",
  traveler_confirmed: true,
  confirmation_number: "TEST-RMLY-1024-MTL2",
  provider_name: "Roamly QA Test Provider",
  source_type: "email",
  title: "Roamly QA Test Stay — Montreal",
  superseded_by_booking_id: null
};
eq("TEST-RMLY booking is NOT confirmed even with flag+status", isConfirmed(TEST_BOOKING), false);
eq("TEST-RMLY booking state is test", bookingTruthState(TEST_BOOKING), "test");
eq(
  "TEST-RMLY booking gets no Confirmed: stamp",
  titleForTruth("Roamly QA Test Stay — Montreal", bookingTruthState(TEST_BOOKING)),
  "Roamly QA Test Stay — Montreal"
);

// ---- Wallet delegation: isConfirmedBooking is the same predicate ----
const SERIALIZED_FULL = {
  booking_status: "confirmed", // wallet serializer maps DB "booked" -> "confirmed"
  traveler_confirmed: true,
  confirmation_code: "AGD8X42K",
  provider: "Agoda",
  source_type: "email",
  title: "Seaside Hotel"
};
eq("wallet: serialized full house is confirmed", isConfirmedBooking(SERIALIZED_FULL), true);
eq(
  "wallet: serialized attach outcome is NOT confirmed",
  isConfirmedBooking({ ...SERIALIZED_FULL, booking_status: "needs_confirmation", traveler_confirmed: false }),
  false
);
eq(
  "wallet: partial shape (status+flag only, no evidence fields) is NOT confirmed",
  isConfirmedBooking({ booking_status: "confirmed", traveler_confirmed: true }),
  false
);

// ---- Itinerary override stamping follows the same truth ----
const baseItinerary = (items) => ({
  daily_itinerary: [{ day_number: 1, date: "2026-10-10", title: "Day 1", morning: "", live_timeline: items }]
});
const overrideBooking = (patch) => ({
  id: "bk-1",
  booking_type: "hotel",
  start_at: "2026-10-10T15:00:00Z",
  ...FULL,
  ...patch
});
{
  const r = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), overrideBooking({}));
  const item = r.itinerary.daily_itinerary[0].live_timeline[0];
  eq("override: full house stamps its provenance (Round 3)", item.title, "Confirmed · from your Agoda email: Seaside Hotel");
  eq("override: full house earns verified factual status", item.factualStatus, "verified");
}
{
  const r = applyConfirmedBookingOverrideToItinerary(
    baseItinerary([]),
    overrideBooking({ booking_status: "needs_confirmation", traveler_confirmed: false })
  );
  eq("override: attach-shaped booking stamps nothing", r.changed, false);
  eq("override: attach-shaped booking creates no item", r.itinerary.daily_itinerary[0].live_timeline.length, 0);
}
{
  const r = applyConfirmedBookingOverrideToItinerary(
    baseItinerary([]),
    overrideBooking({
      confirmation_number: "TEST-RMLY-1024-MTL2",
      provider_name: "Roamly QA Test Provider",
      title: "Roamly QA Test Stay — Montreal"
    })
  );
  eq("override: TEST-RMLY booking stamps nothing", r.changed, false);
}

// ---- Place-detail badge inputs follow the same truth ----
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
  const d = placeFor([{ ...ATTACH, address: "123 Seaside St" }]);
  check("place detail: attach-shaped booking earns no Confirmed badge", d?.badge !== "Confirmed");
  eq("place detail: attach-shaped booking evidence.confirmed is false", d?.evidence.confirmed, false);
  eq("place detail: attach-shaped booking withholds the address", d?.about.address, null);
}
{
  const d = placeFor([{ ...FULL, address: "123 Seaside St" }]);
  eq("place detail: full house earns the provenance badge (Round 3)", d?.badge, "Confirmed · from your Agoda email");
  eq("place detail: full house releases the address (control)", d?.about.address, "123 Seaside St");
}

// ---- Source pins: the writer paths stay incapable of confirming ----
// (Neighbouring suites pin wiring by source inspection; the runtime
// behaviour of these paths is covered by test:gmail-live-fixture and
// the junk-gmail suite.)
{
  const attachRoute = read("app/api/trips/[id]/bookings/email-imports/attach/route.ts");
  check("attach route hardcodes travelerConfirmed: false", attachRoute.includes("travelerConfirmed: false"));
  check("attach route lands bookings in needs_confirmation", attachRoute.includes('"needs_confirmation"'));
  check("attach route re-evaluates credibility before creating", attachRoute.includes("evaluateExtractionCredibility"));
  check(
    "attach route refuses the four junk classes with 422",
    attachRoute.includes('"test_or_qa_record"') &&
      attachRoute.includes('"non_booking_sender"') &&
      attachRoute.includes('"promotional_subject"') &&
      attachRoute.includes('"non_booking_notification"') &&
      attachRoute.includes("{ status: 422 }")
  );
  const extraction = read("lib/roamly/bookingExtraction.ts");
  const autoApply = extraction.slice(extraction.indexOf("extractAndMatchTravelEmailBooking"));
  check("auto-apply hardcodes travelerConfirmed: false", autoApply.includes("travelerConfirmed: false"));
  check(
    "auto-apply downgrades confirmed/missing status to needs_confirmation",
    autoApply.includes('? "needs_confirmation"') && autoApply.includes('extraction.booking.bookingStatus === "confirmed"')
  );
}

console.log(`\n${passed} booking-truth checks passed`);
