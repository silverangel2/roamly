import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const route = read("app/api/trips/[id]/bookings/route.ts");
const form = read("components/companion/ManualBookingForm.tsx");
const wallet = read("lib/roamly/bookingWallet.ts");
const bookings = read("lib/roamly/bookings.ts");
const confirmRoute = read("app/api/roamly/bookings/confirm/route.ts");
const extractRoute = read("app/api/roamly/bookings/extract/route.ts");
const tracking = read("lib/roamly/affiliateTracking.ts");
const reconciliation = read("lib/roamly/brain/bookingReconciliation.ts");
const timeline = read("components/companion/BookingWalletTimeline.tsx");
const addPage = read("app/trip/[id]/bookings/add/page.tsx");

// Browser booking capture must fail closed for authoritative confirmation fields.
assert.match(route, /bookingStatus: null/);
assert.match(route, /travelerConfirmed: false/);
assert.match(form, /bookingStatus: null/);
assert.match(form, /travelerConfirmed: false/);
assert.match(form, /status: "unknown"/);
assert.doesNotMatch(route, /bookingStatus: text\(body, "bookingStatus"/);

// Referral identity is exact, durable, and server-resolved.
assert.match(tracking, /resolveAffiliateReferral/);
assert.match(tracking, /eq\("id", params\.affiliateClickId\)/);
assert.match(tracking, /eq\("user_id", params\.userId\)/);
assert.match(tracking, /eq\("trip_id", params\.tripId\)/);
assert.match(tracking, /from\("roamly_booking_referrals"\)/);
assert.match(tracking, /provider_tracking_reference: subId/);
assert.match(tracking, /commercial_partner: partner/);
assert.match(tracking, /writer: SupabaseClient/);
assert.doesNotMatch(tracking, /from\("affiliate_clicks"\)|from\("affiliate_conversions"\)/);
assert.match(read("app/api/roamly/affiliate/click/route.ts"), /createSupabaseAdminClient/);
assert.match(tracking, /AFFILIATE_REFERRAL_MISMATCH/);
assert.match(addPage, /resolveAffiliateReferral/);
assert.match(route, /resolveAffiliateReferral/);

// Pending capture uses existing canonical metadata and cannot overwrite confirmation.
assert.match(wallet, /captureState/);
assert.match(wallet, /affiliateClickId/);
assert.match(wallet, /contains\("metadata", \{ affiliateClickId/);
assert.match(wallet, /eq\("referral_id", referralId\)/);
assert.match(wallet, /roamly_bookings_referral_capture_uidx/);
assert.match(wallet, /code !== "23505"/);
assert.match(read("components/roamly/TripBookingsManager.tsx"), /api\/roamly\/bookings\?tripId/);
assert.match(wallet, /preservedConfirmed: true/);
assert.match(bookings, /createBookingEvidenceToken/);
assert.match(bookings, /verifyBookingEvidenceToken/);
assert.match(read("lib/roamly/bookingEvidenceToken.ts"), /15 \* 60 \* 1000/);
assert.match(confirmRoute, /verifyBookingEvidenceToken/);
assert.doesNotMatch(confirmRoute, /body\.booking/);
assert.match(confirmRoute, /bookingStatus: "needs_confirmation"/);
assert.match(confirmRoute, /travelerConfirmed: false/);
assert.doesNotMatch(confirmRoute, /saveConfirmedBooking/);
assert.match(extractRoute, /createBookingEvidenceToken/);

// Reconciliation must read referral identity from roamly_bookings.metadata.
assert.match(reconciliation, /select\("id,booking_type,booking_status,[^\"]*metadata/);
assert.match(reconciliation, /bookingReferralMetadata\(booking\.metadata\)/);
assert.doesNotMatch(reconciliation, /select\([^\n]*recommendation_id/);

// Only exact recommendation referrals may open the new capture action.
assert.match(timeline, /Boolean\(referral\.recommendation_id\)/);
assert.match(timeline, /findIndex\(\(candidate\) => candidate\.referral\.recommendation_id === referral\.recommendation_id\)/);
assert.match(timeline, /I booked this/);
assert.match(form, /Add the actual booking details so Roamly can verify it/);

console.log("Roamly booking closure checks passed (browser confirmation hardening, exact referral binding, pending capture, canonical metadata, and referral UX).");
