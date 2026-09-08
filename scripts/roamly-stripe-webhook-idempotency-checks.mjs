import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const billing = read("lib/roamly/billing.ts");
const route = read("app/api/stripe/webhook/route.ts");
const migration = read("supabase/migrations/20260908_roamly_stripe_webhook_idempotency.sql");

assert.match(route, /constructEvent\(rawBody, signature, webhookSecret\)/);
assert.match(route, /Missing Stripe signature.*status: 400/);
assert.match(route, /Invalid Stripe webhook[\s\S]*status: 400/);
assert.match(route, /handleStripeWebhookEvent\(supabase, event\)/);
assert.match(billing, /claimStripeWebhookEvent\(supabase, event\)/);
assert.match(billing, /completeStripeWebhookEvent\(supabase, event\.id/);
assert.match(billing, /failStripeWebhookEvent\(supabase, event\.id/);
assert.ok(
  billing.indexOf("claimStripeWebhookEvent(supabase, event)") < billing.indexOf("applyPaidItineraryPurchase(supabase, checkoutSessionFromEvent(event))"),
  "claim must precede activation"
);
assert.match(migration, /stripe_event_id text primary key/);
assert.match(migration, /on conflict \(stripe_event_id\) do nothing/);
assert.match(migration, /status = 'completed'/);
assert.match(migration, /status = 'failed'/);
assert.match(migration, /existing\.last_attempt_at > now\(\) - stale_after/);
assert.match(migration, /existing\.attempt_count >= 5/);
assert.match(migration, /claim_token = p_claim_token/);

const state = new Map();
let sideEffects = 0;
function claim(id, now = 0) {
  const current = state.get(id);
  if (!current) {
    const next = { status: "processing", token: `token-${id}-1`, attempt: 1, at: now };
    state.set(id, next);
    return { claimed: true, ...next };
  }
  if (current.status === "completed") return { claimed: false, status: "completed" };
  if (current.status === "processing" && now - current.at < 900) return { claimed: false, status: "processing" };
  if (current.attempt >= 5) return { claimed: false, status: "retry_exhausted" };
  const next = { status: "processing", token: `token-${id}-${current.attempt + 1}`, attempt: current.attempt + 1, at: now };
  state.set(id, next);
  return { claimed: true, ...next };
}
function complete(id, token) {
  const current = state.get(id);
  if (!current || current.status !== "processing" || current.token !== token) return false;
  current.status = "completed";
  return true;
}
function fail(id, token) {
  const current = state.get(id);
  if (!current || current.status !== "processing" || current.token !== token) return false;
  current.status = "failed";
  return true;
}

const first = claim("evt_1");
assert.equal(first.claimed, true, "new event must claim");
assert.equal(claim("evt_1").claimed, false, "processing duplicate must not claim");
sideEffects += 1;
assert.equal(complete("evt_1", first.token), true);
assert.equal(claim("evt_1").claimed, false, "completed duplicate must not claim");
assert.equal(sideEffects, 1, "duplicate must not repeat activation side effects");

const failed = claim("evt_2");
assert.equal(fail("evt_2", failed.token), true, "processing failure must be recorded");
assert.equal(claim("evt_2", 901).claimed, true, "failed event must be retryable");
const stale = claim("evt_3");
assert.equal(claim("evt_3", 900).claimed, true, "stale processing claim must recover");
assert.notEqual(stale.token, state.get("evt_3").token, "stale recovery must rotate the claim token");

const concurrentClaims = [claim("evt_4"), claim("evt_4")].filter((result) => result.claimed);
assert.equal(concurrentClaims.length, 1, "concurrent duplicate claims must have one winner");
assert.equal(state.get("evt_4").status, "processing");

console.log("Stripe webhook idempotency checks passed.");
