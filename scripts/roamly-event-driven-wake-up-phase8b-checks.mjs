import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  OPERATIONS_EVENT_CATALOG,
  normalizeOperationsEvent,
  triageOperationsSignal
} from "../lib/roamly/operationsSignals.ts";
import { OperationsScheduler } from "../lib/roamly/opsControlPlane.ts";

const now = Date.parse("2026-09-28T12:00:00.000Z");
const base = {
  eventId: "event-1",
  observedAt: new Date(now).toISOString(),
  correlationKey: "release-sha-abc123",
  evidenceReference: "check:release-public-surface"
};

assert.equal(Object.keys(OPERATIONS_EVENT_CATALOG).length, 10, "event catalog is closed and code-defined");
for (const definition of Object.values(OPERATIONS_EVENT_CATALOG)) {
  assert.equal(definition.requiredAuthority, "LEVEL_1_OBSERVE");
  assert.equal(definition.tokenBudget, 0);
  assert.equal(definition.financialBudgetUsd, 0);
  assert.equal(definition.privacy, "sanitized_operational");
  assert.equal(definition.dedupeIdentity, "event_type_and_correlation_key");
}

const release = normalizeOperationsEvent({ ...base, eventType: "RELEASE_COMPLETED", producer: "release_pipeline", customerFacing: true }, now);
assert.equal(release.ok, true);
assert.equal(release.event.specialist, "UX_PRODUCT_EXPERIENCE");
assert.equal(release.signal.suggestedSpecialist, "UX_PRODUCT_EXPERIENCE");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "RELEASE_COMPLETED", producer: "release_pipeline", customerFacing: false }, now).error, "EVENT_SCOPE_NOT_ELIGIBLE");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "RELEASE_COMPLETED", producer: "SEO", customerFacing: true }, now).error, "EVENT_PRODUCER_NOT_AUTHORIZED");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "NOT_REGISTERED", producer: "release_pipeline", customerFacing: true }, now).error, "EVENT_NOT_REGISTERED");

const uiRegression = normalizeOperationsEvent({ ...base, eventId: "event-ui", eventType: "PUBLIC_UI_REGRESSION_DETECTED", producer: "public_surface_checks", evidenceReference: "check:public-ui" }, now);
assert.equal(uiRegression.ok, true);
assert.equal(uiRegression.signal.suggestedSpecialist, "UX_PRODUCT_EXPERIENCE");

const provider = normalizeOperationsEvent({ ...base, eventId: "event-provider", eventType: "PROVIDER_DEGRADED", producer: "provider_health_monitor", correlationKey: "provider-travelpayouts", evidenceReference: "health:provider-travelpayouts" }, now);
assert.equal(provider.ok, true);
assert.equal(provider.signal.suggestedSpecialist, "PROVIDER_TRAVEL_INTELLIGENCE");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "PROVIDER_DEGRADED", producer: "provider_health_monitor", evidenceReference: "check:provider-response" }, now).error, "EVENT_HEALTH_EVIDENCE_REQUIRED");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "PROVIDER_DEGRADED", producer: "provider_health_monitor", evidenceReference: "health:provider", safeMetadata: { customer: "x" } }, now).error, "SIGNAL_METADATA_KEY_REJECTED");

const marketing = normalizeOperationsEvent({ ...base, eventId: "event-marketing", eventType: "FUNNEL_ANOMALY_DETECTED", producer: "campaign_system", correlationKey: "funnel-checkout-v1", evidenceReference: "check:funnel-anomaly" }, now);
assert.equal(marketing.ok, true);
assert.equal(marketing.signal.suggestedSpecialist, "MARKETING_GROWTH");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "LOW_REVENUE", producer: "campaign_system", customerFacing: true }, now).error, "EVENT_NOT_REGISTERED");

const customer = normalizeOperationsEvent({ ...base, eventId: "event-customer", eventType: "CUSTOMER_JOURNEY_FAILURE", producer: "customer_workflow_monitor", correlationKey: "booking-reconciliation-systemic", evidenceReference: "check:workflow" }, now);
assert.equal(customer.ok, true);
assert.equal(customer.signal.suggestedSpecialist, "CUSTOMER_EXPERIENCE");
const sameSystemicEvent = normalizeOperationsEvent({ ...base, eventId: "event-customer-2", eventType: "CUSTOMER_JOURNEY_FAILURE", producer: "customer_workflow_monitor", correlationKey: "booking-reconciliation-systemic", evidenceReference: "check:workflow" }, now);
assert.equal(sameSystemicEvent.ok, true);
assert.equal(customer.signal.dedupeKey, sameSystemicEvent.signal.dedupeKey);

assert.equal(normalizeOperationsEvent({ ...base, eventType: "BOOKING_RECONCILIATION_FAILURE", producer: "booking_reconciliation_monitor", correlationKey: "booking-system", evidenceReference: "gmail:raw-body" }, now).error, "EVENT_EVIDENCE_OR_CORRELATION_INVALID");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "CUSTOMER_JOURNEY_FAILURE", producer: "customer_workflow_monitor", correlationKey: "customer-123", evidenceReference: "check:journey" }, now).error, "EVENT_EVIDENCE_OR_CORRELATION_INVALID");
assert.equal(normalizeOperationsEvent({ ...base, eventType: "CUSTOMER_JOURNEY_FAILURE", producer: "customer_workflow_monitor", correlationKey: "workflow", evidenceReference: "check:journey", safeMetadata: { payment: "secret" } }, now).error, "SIGNAL_METADATA_KEY_REJECTED");

const scheduler = new OperationsScheduler();
const first = triageOperationsSignal(provider.signal, scheduler, now, true);
assert.equal(first.decision.accepted, true);
assert.equal(first.decision.job?.authorityLevel, "LEVEL_1_OBSERVE");
assert.equal(first.decision.job?.tokenBudget, 0);
assert.equal(first.decision.job?.financialBudgetUsd, 0);
const duplicate = triageOperationsSignal(sameSystemicEvent.signal, scheduler, now + 1_000, true);
assert.equal(duplicate.suppressed, false, "different subsystem event is independent");
const providerDuplicate = triageOperationsSignal(provider.signal, scheduler, now + 1_000, true);
assert.equal(providerDuplicate.suppressed, true, "duplicate provider event is suppressed");
assert.equal(providerDuplicate.reason, "DUPLICATE_OR_COOLDOWN_SUPPRESSED");
assert.equal(triageOperationsSignal(provider.signal, scheduler, now + 2_000, true).suppressed, true, "retry cannot bypass cooldown");
assert.equal(triageOperationsSignal({ ...provider.signal, requiredAuthority: "LEVEL_2_DIAGNOSE" }, new OperationsScheduler(), now, true).reason, "PRODUCTION_OBSERVATION_ONLY");

assert.equal(Object.values(OPERATIONS_EVENT_CATALOG).some((definition) => definition.producer === definition.specialist), false, "specialists cannot self-wake");
const route = await readFile(new URL("../app/api/cron/roamly-operations-signals/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
assert.doesNotMatch(route, /normalizeOperationsEvent|eventType/, "cron route does not accept arbitrary external event creation");
assert.deepEqual(vercel.crons.filter(({ path }) => path.includes("roamly-operations-signals")), [
  { path: "/api/cron/roamly-operations-signals", schedule: "17 3 * * *" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=seo_weekly", schedule: "17 4 * * 1" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=security_weekly", schedule: "17 5 * * 0" }
]);
assert.equal(vercel.crons.some(({ path }) => /ux|provider|marketing|customer-experience|finops/i.test(path)), false);

console.log("Roamly Phase 8B event-driven wake-up checks passed");
