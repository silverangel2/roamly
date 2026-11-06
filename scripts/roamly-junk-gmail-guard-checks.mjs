// Junk-Gmail guard checks (filter + extraction level).
// Junk mail must never become a booking: GitHub notifications, promo
// subjects, subscription-suspension notices and receipts are stopped at
// the filter (shouldProcess=false) or, when a reference-shaped token
// lets one through the filter, the extraction still never confirms it
// (travelerConfirmed false, status needs_confirmation, deterministic
// confidence capped at 0.60 with no confirmation code — below the
// auto-apply bar). Sender-only evidence is never enough to process.
// The extraction module is driven through the same vm/mock harness as
// scripts/roamly-gmail-live-fixture-checks.mjs. Positive control: a real
// Agoda confirmation processes and extracts its code — still without
// traveler confirmation.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        scripts/roamly-junk-gmail-guard-checks.mjs   (TZ-safe)
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { hotelEmailFacts } from "../lib/roamly/emailBookingFacts.ts";
import { filterTravelEmail } from "../lib/roamly/travelEmailFiltering.ts";
import { bookingTruthState, isConfirmed } from "../lib/roamly/bookingTruth.ts";

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

const external = () => { throw new Error("Unexpected external I/O"); };
const mocks = {
  "@/lib/roamly/emailBookingFacts": { hotelEmailFacts },
  openai: { default: class { constructor() { external(); } } },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/bookingWallet": { createTripBooking: external },
  "@/lib/roamly/brain/bookingReconciliation": { reconcileTripBookings: external },
  "@/lib/roamly/reconciliationLane": { build2ReconciliationLaneActive: () => true }
};
const compiled = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("lib/roamly/bookingExtraction.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText,
  {
    exports: compiled.exports,
    module: compiled,
    require: (name) => {
      assert.ok(name in mocks, `Unexpected import ${name}`);
      return mocks[name];
    },
    Date,
    console
  }
);
const { deterministicBookingExtraction } = compiled.exports;

function drive(metadata) {
  const filter = filterTravelEmail(metadata);
  const extraction = deterministicBookingExtraction({ metadata, filter });
  return { filter, extraction };
}
// The extraction's booking, mapped onto bookingTruth field names.
function truthOf(extraction) {
  const b = extraction.booking;
  return {
    booking_status: b.bookingStatus,
    traveler_confirmed: b.travelerConfirmed,
    confirmation_number: b.confirmationCode,
    provider_name: b.provider,
    source_type: b.sourceType,
    title: b.title
  };
}

// ---- GitHub notification mail: excluded sender, never processed ----
{
  const metadata = {
    provider: "gmail", messageId: "m-gh",
    sender: "GitHub <notifications@github.com>",
    subject: "[repo] Pull request #42 review requested — confirmation needed",
    bodyText: "Pull request #42 opened. Confirmation of merge status. Dates: 2026-11-05. Reference code ABC12345. Please review the confirmation changes for the hotel module."
  };
  const { filter, extraction } = drive(metadata);
  eq("GitHub mail: shouldProcess is false", filter.shouldProcess, false);
  check("GitHub mail: reason is non_booking_sender", filter.reasons.includes("non_booking_sender"));
  eq("GitHub mail: extraction finds no confirmation code", extraction.booking.confirmationCode, null);
  eq("GitHub mail: extraction never traveler-confirms", extraction.booking.travelerConfirmed, false);
  eq("GitHub mail: extracted booking is not confirmed truth", isConfirmed(truthOf(extraction)), false);
}

// ---- Promo subject from a real travel brand: excluded ----
{
  const metadata = {
    provider: "gmail", messageId: "m-promo",
    sender: "Air Canada <offers@aircanada.com>",
    subject: "Fly Premium for less this holiday season",
    bodyText: "Book your flight today. Great fares to Montreal. Travel dates 2026-12-01 to 2026-12-20."
  };
  const { filter } = drive(metadata);
  eq("promo mail: shouldProcess is false", filter.shouldProcess, false);
  check("promo mail: reason is promotional_subject", filter.reasons.includes("promotional_subject"));
}

// ---- Known travel sender + promo content only (single evidence kind) ----
{
  const metadata = {
    provider: "gmail", messageId: "m-abnb",
    sender: "Airbnb <discover@airbnb.com>",
    subject: "Say hello to the new Trips tab",
    bodyText: "Explore stays and hotels for your next trip."
  };
  const { filter } = drive(metadata);
  eq("sender-only promo: shouldProcess is false (one evidence kind is never enough)", filter.shouldProcess, false);
}

// ---- Sender-only evidence: known travel sender, nothing else ----
{
  const metadata = {
    provider: "gmail", messageId: "m-so",
    sender: "Agoda <bookings@agoda.com>",
    subject: "Hello from Agoda",
    bodyText: "Thanks for being a member."
  };
  const { filter, extraction } = drive(metadata);
  eq("sender-only mail: shouldProcess is false", filter.shouldProcess, false);
  eq("sender-only mail: no confirmation code extracted", extraction.booking.confirmationCode, null);
  eq("sender-only mail: extracted booking is not confirmed truth", isConfirmed(truthOf(extraction)), false);
}

// ---- Subscription-suspension notice: never processed, never a booking ----
{
  const plain = {
    provider: "gmail", messageId: "m-sub",
    sender: "StreamCo <no-reply@streamco.example>",
    subject: "Your subscription has been suspended",
    bodyText: "Your subscription was suspended due to a payment issue. Please update your payment method to restore access."
  };
  const { filter, extraction } = drive(plain);
  eq("subscription suspension: shouldProcess is false", filter.shouldProcess, false);
  eq("subscription suspension: extraction status is needs_confirmation", extraction.booking.bookingStatus, "needs_confirmation");
  eq("subscription suspension: extraction never traveler-confirms", extraction.booking.travelerConfirmed, false);

  // Even with a reference-shaped number in the body, a lone booking
  // reference without travel language is a single evidence kind.
  const withRef = { ...plain, messageId: "m-sub2", bodyText: "Your subscription was suspended. Reference number: 99182347. Update payment to restore." };
  const r2 = drive(withRef);
  eq("subscription suspension with reference number: shouldProcess is still false", r2.filter.shouldProcess, false);
  eq("subscription suspension with reference number: never confirmed truth", isConfirmed(truthOf(r2.extraction)), false);
}

// ---- Receipt-style mail ----
{
  const plain = {
    provider: "gmail", messageId: "m-r2",
    sender: "Coffee Co <receipts@coffeeco.example>",
    subject: "Your receipt from Coffee Co",
    bodyText: "Thanks for your purchase. Item: Latte. Total $12.50. Come again soon."
  };
  const { filter } = drive(plain);
  eq("plain receipt: shouldProcess is false", filter.shouldProcess, false);

  // An order-number receipt can pass the filter on reference+date
  // evidence — the guard leg there is that it NEVER yields a bookable
  // (confirmed / auto-appliable) candidate.
  const orderReceipt = {
    provider: "gmail", messageId: "m-rcpt",
    sender: "Coffee Co <receipts@coffeeco.example>",
    subject: "Your receipt from Coffee Co",
    bodyText: "Thanks for your purchase. Order number: 88392017. Total $12.50. Date: 2026-10-20."
  };
  const r = drive(orderReceipt);
  eq("order receipt: extraction never traveler-confirms", r.extraction.booking.travelerConfirmed, false);
  eq("order receipt: extraction status is needs_confirmation", r.extraction.booking.bookingStatus, "needs_confirmation");
  check("order receipt: confidence stays below the auto-apply bar (0.82)", r.extraction.overallConfidence < 0.82);
  eq("order receipt: extracted booking is not confirmed truth", isConfirmed(truthOf(r.extraction)), false);
}

// ---- False-positive confidence: NO confirmation code => capped at 0.60 ----
{
  const metadata = {
    provider: "gmail", messageId: "m-nc",
    sender: "Agoda <bookings@agoda.com>",
    subject: "Your booking confirmation",
    bodyText: "Your hotel booking is confirmed. Hotel: Seaside Hotel. Check-in: 2026-11-10. Check-out: 2026-11-12. We look forward to your stay."
  };
  const { filter, extraction } = drive(metadata);
  eq("no-code hotel mail processes (it looks like a booking)", filter.shouldProcess, true);
  eq("no-code hotel mail: filter confidence is 1.00 (keyword-rich)", filter.confidence, 1);
  eq("no-code extraction finds no confirmation code", extraction.booking.confirmationCode, null);
  eq("no-code extraction confidence is capped at 0.60", extraction.overallConfidence, 0.6);
  check("no-code extraction confidence is <= 0.60", extraction.overallConfidence <= 0.6);
  // The cap holds even if the filter confidence is handed in at 1.0.
  const raised = deterministicBookingExtraction({ metadata, filter: { ...filter, confidence: 1 } });
  eq("cap holds against a hand-raised filter confidence", raised.overallConfidence, 0.6);
  eq("no-code extraction never traveler-confirms", extraction.booking.travelerConfirmed, false);
  eq("no-code extraction truth state is not confirmed", bookingTruthState(truthOf(extraction)) !== "confirmed", true);
}

// ---- Positive control: a real Agoda confirmation still works ----
{
  const metadata = {
    provider: "gmail", messageId: "m-ag",
    sender: "Agoda <bookings@agoda.com>",
    subject: "Your booking confirmation",
    bodyText: "Your hotel booking is confirmed. Confirmation number: AGD8X42K. Hotel: Seaside Hotel. Check-in: 2026-11-10. Check-out: 2026-11-12."
  };
  const { filter, extraction } = drive(metadata);
  eq("real Agoda mail: shouldProcess is true", filter.shouldProcess, true);
  eq("real Agoda mail: confirmation code extracted", extraction.booking.confirmationCode, "AGD8X42K");
  eq("real Agoda mail: extraction confidence reaches 1", extraction.overallConfidence, 1);
  // Extraction alone STILL never confirms: confirmation is a
  // verified-record state, not a parse result.
  eq("real Agoda mail: extraction never traveler-confirms", extraction.booking.travelerConfirmed, false);
  eq("real Agoda mail: extracted booking alone is not confirmed truth", isConfirmed(truthOf(extraction)), false);
  eq("real Agoda mail: extracted booking truth is email_unverified", bookingTruthState(truthOf(extraction)), "email_unverified");
}

console.log(`\n${passed} junk-gmail-guard checks passed`);
