import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const billing = read("lib/roamly/billing.ts");
const migration = read("supabase/migrations/20260927000100_roamly_atomic_checkout_attempt_claim.sql");

assert.match(migration, /create unique index if not exists roamly_itinerary_purchases_pending_identity_uidx/);
assert.match(migration, /where status = 'pending'/);
assert.match(migration, /roamly_claim_checkout_attempt/);
assert.match(migration, /on conflict \(user_id, trip_id, purchase_type\) where status = 'pending'/);
assert.match(migration, /and status = 'paid'/);
assert.match(billing, /claimCheckoutAttempt\(/);
assert.match(billing, /roamly_claim_checkout_attempt/);
assert.match(billing, /roamly_checkout_attempt_\$\{attempt\.purchaseId\}/);
assert.doesNotMatch(billing, /const idempotencyWindow = Math\.floor\(Date\.now\(\) \/ 60_000\)/);
assert.match(billing, /CHECKOUT_ATTEMPT_PERSIST_FAILED/);
assert.match(billing, /CHECKOUT_SESSION_LOOKUP_FAILED/);
assert.match(billing, /CHECKOUT_ALREADY_COMPLETED/);
assert.match(billing, /onConflict: "stripe_session_id"/);
assert.match(billing, /createItineraryCheckoutSession/);
assert.match(billing, /createTrackingCheckoutSession/);
assert.match(billing, /createBundleCheckoutSession/);

class CheckoutAttemptFixture {
  constructor() {
    this.rows = new Map();
    this.stripeSessions = new Map();
  }

  async request(identity, { stripeFailure = false, persistenceFailure = false } = {}) {
    const existing = this.rows.get(identity);
    const row = existing || { id: `attempt-${this.rows.size + 1}`, status: "pending", sessionId: null };
    this.rows.set(identity, row);
    if (row.status === "expired" || row.status === "cancelled") {
      row.id = `attempt-${this.rows.size + 1}`;
      row.status = "pending";
      row.sessionId = null;
    }
    if (row.sessionId) return { attemptId: row.id, sessionId: row.sessionId, reused: true };
    const stripeKey = `roamly_checkout_attempt_${row.id}`;
    if (stripeFailure) return { attemptId: row.id, error: "stripe_failure", retryable: true };
    const session = this.stripeSessions.get(stripeKey) || { id: `stripe-${stripeKey}` };
    this.stripeSessions.set(stripeKey, session);
    if (!persistenceFailure) row.sessionId = session.id;
    return { attemptId: row.id, sessionId: session.id, persisted: !persistenceFailure };
  }
}

const fixture = new CheckoutAttemptFixture();
const identity = "user-1:trip-1:bundle";
const concurrent = await Promise.all(Array.from({ length: 10 }, () => fixture.request(identity)));
assert.equal(new Set(concurrent.map((result) => result.attemptId)).size, 1, "concurrent requests must claim one attempt");
assert.equal(new Set(concurrent.map((result) => result.sessionId)).size, 1, "concurrent requests must converge on one Stripe session");
assert.equal(new Set(concurrent.map((result) => `roamly_checkout_attempt_${result.attemptId}`)).size, 1);

const boundary = await fixture.request("user-1:trip-2:bundle");
const boundaryRetry = await fixture.request("user-1:trip-2:bundle");
assert.equal(boundary.attemptId, boundaryRetry.attemptId, "old minute boundary cannot split an active attempt");
fixture.rows.get("user-1:trip-2:bundle").status = "expired";
const newAttempt = await fixture.request("user-1:trip-2:bundle");
assert.notEqual(newAttempt.attemptId, boundary.attemptId, "terminal attempt must permit a legitimate new attempt");

const failed = await fixture.request("user-1:trip-3:bundle", { stripeFailure: true });
assert.equal(failed.retryable, true);
const recovered = await fixture.request("user-1:trip-3:bundle");
assert.equal(recovered.attemptId, failed.attemptId, "Stripe failure must not strand the attempt");

const persistence = await fixture.request("user-1:trip-4:bundle", { persistenceFailure: true });
const persistenceRetry = await fixture.request("user-1:trip-4:bundle");
assert.equal(persistenceRetry.attemptId, persistence.attemptId);
assert.equal(persistenceRetry.sessionId, persistence.sessionId, "persistence retry must reuse the original Stripe operation");

const tripTwo = await fixture.request("user-1:trip-5:bundle");
assert.notEqual(tripTwo.attemptId, concurrent[0].attemptId, "different trips must remain independent");
const differentType = await fixture.request("user-1:trip-1:tracking_addon");
assert.notEqual(differentType.attemptId, concurrent[0].attemptId, "different purchase types must remain independent");

console.log("G-A18-01 checkout concurrency checks passed");
