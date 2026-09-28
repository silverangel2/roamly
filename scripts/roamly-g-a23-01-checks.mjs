import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripeWebhookPreVerificationIncident, STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES } from "../lib/roamly/stripeWebhookDiagnostics.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const route = fs.readFileSync(path.join(root, "app/api/stripe/webhook/route.ts"), "utf8");
const incidentSource = fs.readFileSync(path.join(root, "lib/roamly/operationalIncidents.ts"), "utf8");

const configuration = stripeWebhookPreVerificationIncident(STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.configurationMissing, 0);
const missingSignature = stripeWebhookPreVerificationIncident(STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.signatureMissing, 0);
const invalidSignature = stripeWebhookPreVerificationIncident(STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.signatureVerificationFailed, 0);
const repeatedInvalid = stripeWebhookPreVerificationIncident(STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.signatureVerificationFailed, 14 * 60 * 1000);
const nextInvalidBucket = stripeWebhookPreVerificationIncident(STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.signatureVerificationFailed, 15 * 60 * 1000);

assert.equal(configuration.eventCode, "stripe_webhook_configuration_missing");
assert.equal(missingSignature.eventCode, "stripe_webhook_signature_missing");
assert.equal(invalidSignature.eventCode, "stripe_webhook_signature_verification_failed");
assert.equal(configuration.severity, "high");
assert.equal(missingSignature.severity, "medium");
assert.equal(invalidSignature.severity, "medium");
assert.equal(invalidSignature.eventKey, repeatedInvalid.eventKey, "repeated public failures coalesce within the bounded bucket");
assert.notEqual(invalidSignature.eventKey, nextInvalidBucket.eventKey, "later buckets preserve bounded occurrence evidence");
assert.equal(configuration.correlationId, null, "pre-verification requests have no safe request correlation identifier");
assert.equal(missingSignature.correlationId, null);
assert.equal(invalidSignature.correlationId, null);

const serialized = JSON.stringify({ configuration, missingSignature, invalidSignature });
for (const forbidden of ["rawBody", "stripe-signature", "webhookSecret", "secret", "payload", "email", "card"]) {
  assert.equal(serialized.includes(forbidden), false, `diagnostic must not include ${forbidden}`);
}
assert.match(serialized, /pre_verification/);
assert.match(serialized, /failure_class/);

assert.match(route, /recordPreVerificationIncident\("configurationMissing"\)/);
assert.match(route, /recordPreVerificationIncident\("signatureMissing"\)/);
assert.match(route, /recordPreVerificationIncident\("signatureVerificationFailed"\)/);
assert.match(route, /\.catch\(\(\) => \{[\s\S]*Stripe webhook diagnostic unavailable/);
assert.match(route, /handleStripeWebhookEvent\(supabase, event\)/);
assert.match(route, /stripe_webhook_processing_failed/);
assert.match(incidentSource, /SAFE_METADATA_KEYS/);
assert.match(incidentSource, /on conflict|recordOperationalEvent/);

console.log("G-A23-01 Stripe pre-verification diagnostics checks passed.");
