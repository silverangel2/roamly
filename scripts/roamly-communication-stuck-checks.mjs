import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  COMMUNICATION_STUCK_GRACE_MS,
  classifyCommunicationStuck,
  communicationStuckStateKey,
  notificationSchedulerIsStale,
  NOTIFICATION_SCHEDULER_GRACE_MS
} from "../lib/roamly/communicationStuckLogic.ts";

const detector = fs.readFileSync(path.resolve("lib/roamly/communicationStuckDetector.ts"), "utf8");
const logic = fs.readFileSync(path.resolve("lib/roamly/communicationStuckLogic.ts"), "utf8");
const route = fs.readFileSync(path.resolve("app/api/cron/roamly-itinerary-generation/route.ts"), "utf8");
const now = Date.parse("2026-09-11T13:30:00.000Z");
const base = { id: "communication-1", status: "pending", scheduled_for: "2026-09-11T13:00:00.000Z", useful_until: null, attempt_count: 0, max_attempts: 5, retryable: true, next_retry_at: null, claimed_at: null, metadata: {} };
const result = (overrides = {}, at = now) => classifyCommunicationStuck({ ...base, ...overrides }, at, COMMUNICATION_STUCK_GRACE_MS);

assert.equal(result({ scheduled_for: "2026-09-11T13:20:00.000Z" }), null, "due inside grace is healthy");
assert.equal(result()?.failureClass, "due_never_processed", "overdue pending is detected");
assert.equal(result({ status: "claimed", claimed_at: "2026-09-11T13:00:00.000Z" })?.failureClass, "abandoned_claim");
assert.equal(result({ status: "failed", next_retry_at: "2026-09-11T13:20:00.000Z" }), null, "future retry is healthy");
assert.equal(result({ status: "failed", next_retry_at: "2026-09-11T12:00:00.000Z", attempt_count: 2 })?.failureClass, "overdue_retry");
assert.equal(result({ status: "failed", retryable: false, attempt_count: 5, max_attempts: 5 })?.failureClass, "retry_exhaustion");
assert.equal(result({ status: "sent" }), null, "delivered is excluded");
assert.equal(result({ status: "suppressed" }), null, "suppressed is excluded");
assert.equal(result({ useful_until: "2026-09-11T12:00:00.000Z" }), null, "stale communication is excluded");
assert.equal(result({ status: "failed", last_error_code: "SMTP_ACCEPTANCE_UNCERTAIN", next_retry_at: "2026-09-11T12:00:00.000Z", attempt_count: 5 }), null, "uncertain acceptance is not retried or classified");

const healthyAt = Date.parse("2026-09-11T13:00:41.000Z");
assert.equal(notificationSchedulerIsStale("2026-09-11T13:00:41.000Z", healthyAt, "2026-09-09T00:00:00.000Z", NOTIFICATION_SCHEDULER_GRACE_MS), false, "current heartbeat is healthy");
assert.equal(notificationSchedulerIsStale("2026-09-10T13:00:00.000Z", Date.parse("2026-09-11T15:01:00.000Z"), "2026-09-09T00:00:00.000Z", NOTIFICATION_SCHEDULER_GRACE_MS), true, "missed daily heartbeat is stale");

const finding = result();
assert.equal(communicationStuckStateKey(finding), communicationStuckStateKey(finding), "same state has stable dedupe key");
assert.equal(result({ status: "sent" }), null, "cleared delivery is not stuck");
assert.notEqual(communicationStuckStateKey(finding), communicationStuckStateKey({ failureClass: "due_never_processed", candidate: { ...finding.candidate, updated_at: "2026-09-11T14:00:00.000Z" } }), "a later recurrence gets a new event key");
assert.match(detector, /roamly_operational_incidents/);
assert.match(detector, /kind: "recovery"/);
assert.match(detector, /limit\(200\)/);
assert.match(detector, /communication-stuck:/);
assert.ok(logic.includes("uncertainAcceptance") && logic.includes("acceptance[_ -]?uncertain"));
assert.match(route, /runCommunicationStuckDetector/);
assert.match(route, /runBookingMonitorHealthDetector[\s\S]*runCommunicationStuckDetector/);
assert.match(detector, /operationalOpaqueId\(\["communication", candidateId\]\)/);
assert.doesNotMatch(detector, /customer@example\.com|private content/);

console.log("Roamly communication_stuck detector checks passed.");
