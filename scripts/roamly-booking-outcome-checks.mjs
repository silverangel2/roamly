import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const outcome = read("lib/roamly/bookingOutcome.ts");
const tracking = read("lib/roamly/affiliateTracking.ts");
const cta = read("lib/roamly/bookingCtaLinks.ts");
const button = read("components/trip/BookingRecommendationButton.tsx");
const timeline = read("components/companion/BookingWalletTimeline.tsx");
const bookingsPage = read("app/trip/[id]/bookings/page.tsx");
const tripPage = read("app/trip/[id]/page.tsx");

// The customer state is intentionally a closed set with canonical evidence first.
for (const state of ["UNBOOKED", "REFERRED", "AWAITING_CONFIRMATION", "CONFIRMED", "NEEDS_REVIEW"]) {
  assert.match(outcome, new RegExp(`\\|?\\s*"${state}"`), `${state} must remain part of the shared outcome model`);
}
assert.ok(outcome.indexOf("canonical_confirmation") < outcome.indexOf("tracked_referral"), "canonical confirmation must outrank referral evidence");
assert.match(outcome, /matchingBookings\.some\(isConfirmedBooking\)/);
assert.match(outcome, /matchingBookings\.some\(\(booking\) => booking\.booking_status === "detected"/);
assert.match(outcome, /matchingBookings\.some\(isBookingClickOnly\)/);
assert.match(outcome, /candidate\.recommendation_id === input\.recommendationId/);
assert.match(outcome, /conflictingEvidence/);

// Candidate identity travels from the recommendation into the existing click record and conversion booking.
assert.match(button, /recommendationId\?: string \| null/);
assert.match(button, /recommendationId,\n  hasAffiliateUrl/);
assert.match(button, /recommendationId, hasAffiliateUrl/);
assert.match(cta, /searchParams\.set\("recommendationId", params\.recommendationId\)/);
assert.match(tripPage, /recommendationId=\{suggestion\.candidateId \|\| null\}/);
assert.match(tracking, /recommendation_id: string \| null/);
assert.match(tracking, /recommendation_id: recommendationId \|\| null/);
assert.match(tracking, /recommendationId: params\.click\.recommendation_id \|\| booking\.recommendationId \|\| null/);

// Direct links remain direct links; only supported affiliate URLs enter the click recorder.
assert.match(cta, /if \(!params\.hasAffiliateUrl && params\.urlType !== "affiliate"\) \{\n    return params\.href;/);
assert.match(bookingsPage, /from\("roamly_booking_referrals"\)/);
assert.match(timeline, /deriveBookingOutcome/);
assert.match(timeline, /Roamly has not marked these as booked unless confirmation evidence exists/);

// Readiness remains canonical: this feature only projects booking evidence and does not alter its engine.
assert.doesNotMatch(outcome, /deriveTripReadiness|affiliate_clicks|roamly_booking_referrals|supabase/);

console.log("Roamly booking outcome checks passed (identity continuity, truthful outcome precedence, direct-link safety, and readiness separation).");
