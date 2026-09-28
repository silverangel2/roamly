import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeOperationsSignal, scheduleSignal, signalCorrelationId, triageOperationsSignal } from "../lib/roamly/operationsSignals.ts";
import { OperationsScheduler } from "../lib/roamly/opsControlPlane.ts";

const now = Date.parse("2026-09-28T12:00:00.000Z");
const base = {
  signalId: "signal-seo-1",
  signalType: "seo.crawlability.failed",
  source: "deterministic_check",
  observedAt: new Date(now).toISOString(),
  subsystem: "seo",
  severity: "low",
  cooldownClass: "deterministic_failure",
  requiredAuthority: "LEVEL_1_OBSERVE",
  safeMetadata: { check_id: "seo-crawlability", retryable: false },
  evidenceReference: "check:seo-crawlability",
  correlationKey: "release-52d82cf",
  expiresAt: new Date(now + 60 * 60 * 1000).toISOString()
};

const normalized = normalizeOperationsSignal(base, now);
assert.equal(normalized.ok, true, "valid signal is accepted");
assert.equal(normalized.signal.suggestedSpecialist, "SEO");
assert.equal(signalCorrelationId(normalized.signal).length, 64);
assert.equal(normalizeOperationsSignal({ ...base, source: "unknown" }, now).error, "SIGNAL_SHAPE_INVALID");
assert.equal(normalizeOperationsSignal({ ...base, observedAt: new Date(now - 48 * 60 * 60 * 1000).toISOString() }, now).error, "SIGNAL_STALE");
assert.equal(normalizeOperationsSignal({ ...base, safeMetadata: { body: "private" } }, now).error, "SIGNAL_METADATA_KEY_REJECTED");
assert.equal(normalizeOperationsSignal({ ...base, requiredAuthority: "LEVEL_3_SAFE_REPAIR" }, now).error, "SIGNAL_AUTHORITY_INVALID");
assert.equal(normalizeOperationsSignal({ ...base, suggestedSpecialist: "SECURITY_PRIVACY" }, now).error, "SIGNAL_SPECIALIST_MISMATCH");
assert.equal(normalizeOperationsSignal({ ...base, signalType: "public_route.failed", subsystem: "public_routes" }, now).ok, true, "ambiguous envelope can be held for Adrian review");

const ambiguous = normalizeOperationsSignal({ ...base, signalId: "ambiguous-1", signalType: "public_route.failed", subsystem: "public_routes" }, now);
assert.equal(ambiguous.signal.suggestedSpecialist, null);
const ambiguousResult = triageOperationsSignal(ambiguous.signal, new OperationsScheduler(), now, true);
assert.equal(ambiguousResult.reason, "AMBIGUOUS_SIGNAL_REQUIRES_REVIEW");
assert.equal(ambiguousResult.decision.job, null);

const scheduler = new OperationsScheduler();
const first = triageOperationsSignal(normalized.signal, scheduler, now, true);
assert.equal(first.decision.accepted, true, "Level 1 signal reaches Adrian");
assert.equal(first.decision.job?.authorityLevel, "LEVEL_1_OBSERVE");
assert.equal(first.decision.job?.tokenBudget, 0);
assert.equal(first.decision.job?.financialBudgetUsd, 0);
assert.ok(first.decision.job?.cooldownUntil && Date.parse(first.decision.job.cooldownUntil) > now);
const duplicate = triageOperationsSignal(normalized.signal, scheduler, now + 1_000, true);
assert.equal(duplicate.suppressed, true, "duplicate signal is suppressed");
assert.equal(duplicate.reason, "DUPLICATE_OR_COOLDOWN_SUPPRESSED");

const levelTwo = normalizeOperationsSignal({ ...base, signalId: "seo-diagnosis-1", requiredAuthority: "LEVEL_2_DIAGNOSE" }, now);
assert.equal(triageOperationsSignal(levelTwo.signal, new OperationsScheduler(), now, true).reason, "PRODUCTION_OBSERVATION_ONLY");
assert.equal(triageOperationsSignal(levelTwo.signal, new OperationsScheduler(), now, false).decision.accepted, true, "local diagnosis remains policy-represented");

const schedule = scheduleSignal("seo_weekly", now);
assert.equal(schedule.ok, true);
assert.equal(schedule.signal.source, "schedule");
assert.equal(schedule.signal.suggestedSpecialist, "SEO");
assert.equal(schedule.signal.cooldownClass, "scheduled_sweep");
assert.equal(scheduleSignal("not-registered", now).error, "SCHEDULE_NOT_REGISTERED");

const route = await readFile(new URL("../app/api/cron/roamly-operations-signals/route.ts", import.meta.url), "utf8");
const vercelConfig = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
const crons = JSON.parse(vercelConfig).crons;
assert.match(route, /isCronRequestAuthorized/);
assert.match(route, /x-roamly-schedule-id/);
assert.match(route, /searchParams\.get\("scheduleId"\)/);
assert.match(route, /\|\| "gap_audit_daily"/);
assert.match(route, /Schedule identity mismatch/);
assert.match(route, /seo_weekly/);
assert.match(route, /security_weekly/);
assert.doesNotMatch(route, /searchParams.*secret|console\.(log|warn).*secret/i);
assert.doesNotMatch(route, /customer|gmail|latitude|longitude|payment|credential|token/i);
assert.deepEqual(crons, [
  { path: "/api/cron/roamly-live-companion", schedule: "*/5 * * * *" },
  { path: "/api/cron/roamly-notifications", schedule: "0 13 * * *" },
  { path: "/api/cron/roamly-social-autopost", schedule: "*/30 * * * *" },
  { path: "/api/cron/roamly-itinerary-generation", schedule: "*/5 * * * *" },
  { path: "/api/cron/roamly-booking-monitor", schedule: "*/10 * * * *" },
  { path: "/api/cron/roamly-successful-trip-patterns", schedule: "17 4 * * *" },
  { path: "/api/cron/roamly-operations-signals", schedule: "17 3 * * *" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=seo_weekly", schedule: "17 4 * * 1" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=security_weekly", schedule: "17 5 * * 0" }
]);
assert.deepEqual(crons.filter(({ path }) => path.includes("roamly-operations-signals")), [
  { path: "/api/cron/roamly-operations-signals", schedule: "17 3 * * *" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=seo_weekly", schedule: "17 4 * * 1" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=security_weekly", schedule: "17 5 * * 0" }
]);
assert.equal(crons.some(({ path }) => path.includes("ux") || path.includes("provider") || path.includes("marketing") || path.includes("customer-experience") || path.includes("finops") || path.includes("executive")), false);
assert.equal(scheduleSignal("gap_audit_daily", now).signal.suggestedSpecialist, "GAP_AUDIT_QA_RELIABILITY");
assert.equal(scheduleSignal("seo_weekly", now).signal.suggestedSpecialist, "SEO");
assert.equal(scheduleSignal("security_weekly", now).signal.suggestedSpecialist, "SECURITY_PRIVACY");
console.log("Roamly Phase 6 signal and scheduling checks passed");
