import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const picker = await readFile("components/trip/HotelProductChoicePicker.tsx", "utf8");
const options = await readFile("components/trip/HotelProductOptions.tsx", "utf8");
const page = await readFile("app/trip/[id]/page.tsx", "utf8");
const api = await readFile("app/api/trips/[id]/hotel-product-choice/route.ts", "utf8");
const presentation = await readFile("lib/roamly/hotelProductPresentation.ts", "utf8");
const decision = await readFile("lib/roamly/selectedHotelProductDecision.ts", "utf8");
const storage = await readFile("lib/roamly/hotelProductChoiceStorage.ts", "utf8");

assert.match(picker, /"use client"/);
assert.match(picker, /providerProductId: productId/);
assert.match(picker, /acknowledgedMaterialChanges/);
assert.match(picker, /fetchWithSupabaseAuth/);
assert.match(picker, /hotel-product-choice/);
const postBody = picker.match(/const body: Record<string, unknown> = \{ providerProductId: productId \};[\s\S]*?body: JSON\.stringify\(body\)/)?.[0] || "";
assert.match(postBody, /providerProductId/);
for (const forbidden of ["provider:", "providerPropertyId:", "selectedHotelCandidateId:", "price:", "currency:", "checkIn:", "checkOut:", "travelers:", "rooms:", "revalidatedAt:", "chosenAt:", "providerUrl:", "bookingUrl:"]) {
  assert.doesNotMatch(postBody, new RegExp(forbidden), `A-K: browser body must omit ${forbidden}`);
}
assert.match(picker, /if \(response\.ok\) \{/);
assert.match(picker, /setPendingChoice\(next\)/);
assert.match(picker, /if \(response\.ok\)[\s\S]*?setPendingChoice\(next\)/);
assert.match(picker, /Selected option/);
for (const forbidden of ["Booked", "booked", "Confirmed", "confirmed", "Reserved", "reserved"]) assert.doesNotMatch(picker.match(/Selected option[\s\S]*?Choosing an option records/)?.[0] || "", new RegExp(forbidden));
assert.match(picker, /MATERIAL_CHANGE_ACKNOWLEDGEMENT_REQUIRED/);
assert.match(picker, /role="alertdialog"/);
assert.match(picker, /readableChanges\(review\.changes\)/);
assert.match(picker, /choose\(productId, review\.changes\)/);
assert.match(picker, /setReview\(null\)/);
assert.match(picker, /PRODUCT_NO_LONGER_CURRENT/);
assert.match(picker, /This option is no longer available/);
assert.match(picker, /PRODUCT_REVALIDATION_FAILED/);
assert.match(picker, /couldn't refresh this option right now/);
assert.match(picker, /presentation\.inventoryStatus === "CONFIRMED_BOOKING"/);
assert.match(picker, /setPendingChoice\(null\)/);
assert.match(picker, /method: "DELETE"/);
assert.match(picker, /selected hotel and trip remain unchanged/);
assert.match(picker, /mutationInFlight\.current/);
assert.match(picker, /disabled=\{Boolean\(busyProductId\)\}/);
assert.match(picker, /role="status"/);
assert.match(picker, /aria-label={`Choose this hotel option/);
assert.match(picker, /option\.eligibility === "ELIGIBLE"/);
assert.match(picker, /option\.actionability === "PROPERTY_HANDOFF_AVAILABLE"/);
assert.match(picker, /presentation\.inventoryStatus === "CURRENT"/);
assert.match(picker, /option\.identity === "IDENTIFIED_INFORMATIONAL"/);
assert.match(picker, /pendingMissingFromDisplay/);
assert.match(picker, /not shown in the current options/);
assert.match(picker, /does not guarantee availability, pricing, or booking terms/);
assert.doesNotMatch(picker, /orders\/(preview|create|details|cancel|modify)/i);
assert.doesNotMatch(picker, /paymentToken|checkout|reservation|\bPay\b/i);
assert.doesNotMatch(picker, /providerPayload|stack trace|SUPABASE_/i);

assert.match(options, /HotelProductChoicePicker/);
assert.match(options, /Room and rate details are for comparison/);
assert.match(options, /exact product booking is not verified/);
assert.doesNotMatch(options, /GuardedHotelActionButton/);
assert.match(page, /getPendingHotelProductChoice\(supabase, id\)/);
assert.match(page, /pendingHotelProductChoice/);
assert.match(page, /<HotelProductOptions presentation=\{hotelProductPresentation\} tripId=\{id\} pendingChoice=\{pendingHotelProductChoice\}/);
assert.match(page, /<GuardedHotelActionButton/);
assert.match(api, /PENDING_CUSTOMER_PRODUCT_CHOICE/);
assert.match(api, /providerProductId/);
assert.match(storage, /replacePendingHotelProductChoice/);

assert.match(presentation, /eligibility === "SATISFIED"/);
assert.match(presentation, /eligibility === "UNSATISFIED"/);
assert.match(presentation, /eligibility === "UNSATISFIED" \? "INELIGIBLE"/);
assert.match(decision, /confirmedHotelBooking/);
assert.doesNotMatch(picker, /recommendedProductId.*setPendingChoice|representativeProviderProductId.*setPendingChoice/);

for (const forbidden of ["candidateDecisionCore", "budget", "roamly_bookings.*update", "roamly_price_discoveries.*update", "facebook", "gmail", "stripe", "live-companion", "Orders"]) {
  assert.doesNotMatch(picker, new RegExp(forbidden, "i"));
}
assert.doesNotMatch(picker, /dark:bg-|dark:text-|dark:border-/);

console.log("roamly customer hotel product choice UI checks passed (A–BZ)");
