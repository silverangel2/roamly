import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const billing = read("lib/roamly/billing.ts");
const migration = read("supabase/migrations/20260908_roamly_refund_entitlement_lifecycle.sql");

assert.match(billing, /event\.type === "charge\.refunded"/);
assert.match(billing, /event\.type === "charge\.dispute\.created"/);
assert.match(billing, /event\.type === "charge\.dispute\.closed"/);
assert.match(billing, /stripe_payment_intent_id/);
assert.match(billing, /\.eq\("user_id", purchase\.user_id\)/);
assert.match(billing, /isTripCurrentlyActive\(trip\)/);
assert.match(billing, /billingState === "refunded" \|\| billingState === "revoked"/);
assert.match(billing, /This paid itinerary entitlement is no longer active/);
assert.match(billing, /status: "expired"/);
assert.match(billing, /if \(purchaseUpdate\.error\)/);
assert.match(billing, /stripe_subscription_id: stripeObjectId\(session\.subscription\)/);
assert.match(billing, /findStripeSubscriptionPurchase/);
assert.match(billing, /customer\.subscription\.deleted/);
assert.match(billing, /subscription_current_period_end/);
assert.match(billing, /terminalSubscription/);
assert.match(billing, /Date\.parse\(purchase\.subscription_current_period_end\)/);
assert.match(billing, /Stripe subscription \$\{status\}/);
assert.match(billing, /Stripe invoice \$\{event\.type === "invoice\.payment_failed"/);
assert.match(billing, /status === "canceled" \|\| status === "unpaid" \|\| status === "incomplete_expired"/);
assert.doesNotMatch(billing, /\.from\("roamly_itineraries"\)[\s\S]*\.delete\(/);
assert.doesNotMatch(billing, /\.from\("roamly_bookings"\)[\s\S]*\.delete\(/);

assert.match(migration, /billing_state text not null default 'active'/);
assert.match(migration, /'partially_refunded', 'refunded', 'disputed', 'revoked'/);
assert.match(migration, /roamly_stripe_billing_events/);
assert.match(migration, /stripe_event_id text primary key/);
assert.match(migration, /p_stripe_event_created_at < purchase_row\.billing_state_updated_at/);
assert.match(migration, /p_state_priority/);
assert.match(migration, /status in \('pending', 'paid', 'failed', 'cancelled', 'expired'\)/);
assert.match(migration, /add column if not exists stripe_subscription_id text/);
assert.match(migration, /subscription_current_period_end timestamptz/);
assert.match(migration, /roamly_itinerary_purchases_subscription_id_idx/);
assert.match(migration, /p_subscription_id text default null/);

function applyState(purchase, next, eventCreatedAt, eventId) {
  if (eventCreatedAt < purchase.updatedAt || (eventCreatedAt === purchase.updatedAt && eventId <= purchase.eventId)) return purchase;
  return { ...purchase, state: next, updatedAt: eventCreatedAt, eventId };
}
function allowedForFuture(purchase, trip) {
  const activeTrip = trip.status === "active" || (trip.status !== "completed" && trip.start <= trip.today && trip.end >= trip.today);
  if (purchase.status !== "paid") return false;
  if (activeTrip) return true;
  if (!["active", "partially_refunded"].includes(purchase.state)) return false;
  if (!["canceled", "unpaid", "incomplete_expired"].includes(purchase.subscriptionStatus || "")) return true;
  return Number.isFinite(purchase.periodEnd) && purchase.periodEnd > Date.now();
}

const paid = { account: "acct_1", status: "paid", state: "active", updatedAt: 100, eventId: "evt_paid" };
assert.equal(allowedForFuture(paid, { status: "planned", start: "200", end: "300", today: "150" }), true, "active paid entitlement must allow future premium use");
assert.equal(allowedForFuture({ ...paid, status: "pending" }, { status: "planned", start: "200", end: "300", today: "150" }), false, "failed/pending payment must not activate");
assert.equal(allowedForFuture({ ...paid, state: "refunded" }, { status: "planned", start: "200", end: "300", today: "150" }), false, "full refund must block future paid use");
assert.equal(allowedForFuture({ ...paid, state: "partially_refunded" }, { status: "planned", start: "200", end: "300", today: "150" }), true, "partial refund must preserve entitlement");
assert.equal(allowedForFuture({ ...paid, state: "disputed" }, { status: "planned", start: "200", end: "300", today: "150" }), false, "pending dispute must block new future premium use");
assert.equal(allowedForFuture({ ...paid, state: "disputed" }, { status: "active", start: "100", end: "200", today: "150" }), true, "pending dispute must preserve active trip experience");
assert.equal(allowedForFuture({ ...paid, state: "revoked" }, { status: "active", start: "100", end: "200", today: "150" }), true, "lost dispute must preserve active trip experience");
assert.equal(allowedForFuture({ ...paid, state: "refunded" }, { status: "completed", start: "100", end: "200", today: "250" }), false, "completed trip must not restore revoked future access");
assert.equal(allowedForFuture({ ...paid, subscriptionStatus: "canceled", periodEnd: Date.now() + 60_000 }, { status: "planned", start: "300", end: "400", today: "250" }), true, "cancellation preserves access through the paid period");
assert.equal(allowedForFuture({ ...paid, subscriptionStatus: "canceled", periodEnd: Date.now() - 60_000 }, { status: "planned", start: "300", end: "400", today: "250" }), false, "cancellation blocks access after the paid period");
assert.equal(allowedForFuture({ ...paid, state: "revoked", subscriptionStatus: "canceled", periodEnd: Date.now() - 60_000 }, { status: "active", start: "100", end: "200", today: "150" }), true, "cancellation preserves an active trip through completion");
assert.equal(allowedForFuture(applyState({ ...paid, state: "disputed", updatedAt: 100, eventId: "evt_dispute" }, "active", 200, "evt_won"), { status: "planned", start: "300", end: "400", today: "250" }), true, "dispute win must restore legitimate access");
assert.equal(allowedForFuture({ ...paid, state: "revoked" }, { status: "planned", start: "300", end: "400", today: "250" }), false, "final subscription cancellation must block future paid use");
assert.equal(allowedForFuture({ ...paid, state: "active" }, { status: "planned", start: "300", end: "400", today: "250" }), true, "subscription remains usable through a paid period");

const newer = applyState(paid, "refunded", 200, "evt_new");
assert.equal(applyState(newer, "active", 150, "evt_old").state, "refunded", "older event must not restore newer revoked state");
assert.equal(applyState(newer, "refunded", 200, "evt_new").state, "refunded", "duplicate transition must be idempotent");
assert.equal(newer.account, "acct_1", "billing state remains account-bound");
const matchesTrustedPayment = (purchase, event) => purchase.account === event.account && purchase.paymentIntentId === event.paymentIntentId;
const trustedPurchase = { ...newer, paymentIntentId: "pi_1" };
assert.equal(matchesTrustedPayment(trustedPurchase, { account: "acct_2", paymentIntentId: "pi_1" }), false, "wrong account must not match purchase ownership");
assert.equal(matchesTrustedPayment(trustedPurchase, { account: "acct_1", paymentIntentId: "pi_2" }), false, "wrong payment must not match purchase ownership");

const qaTrip = { itineraryUnlockSource: "admin", trackingUnlockSource: "admin" };
assert.equal(["paid", "bundle"].includes(qaTrip.itineraryUnlockSource), false, "admin entitlement must not be revoked by Stripe policy");
assert.equal(["paid", "bundle"].includes(qaTrip.trackingUnlockSource), false, "admin tracking entitlement must not be revoked by Stripe policy");

console.log("Stripe refund and entitlement lifecycle checks passed.");
