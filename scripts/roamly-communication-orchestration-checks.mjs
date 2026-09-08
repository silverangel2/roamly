import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  COMMUNICATION_PURPOSES,
  boundedRetryDelaySeconds,
  communicationChannelForPurpose,
  communicationLogicalKey,
  isCommunicationStale,
  sanitizeCommunicationMetadata
} from "../lib/roamly/communicationPolicy.ts";

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260908_roamly_communication_orchestration.sql"), "utf8");
assert.match(migration, /unique \(user_id, logical_key\)/);
assert.match(migration, /on conflict \(user_id, logical_key\) do nothing/);
assert.match(migration, /for update/);
assert.match(migration, /claim_token/);
assert.match(migration, /retryable boolean not null default true/);
assert.match(migration, /p_uncertain_acceptance/);
assert.match(migration, /revoke all on function/);

const key = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_7d", occurrenceKey: "2026-09-15" });
assert.equal(key, "user-1:trip-1:pretrip_7d:2026-09-15");
assert.equal(communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_7d", occurrenceKey: "2026-09-15" }), key);
assert.notEqual(communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_1d", occurrenceKey: "2026-09-15" }), key);
assert.equal(communicationChannelForPurpose("activity_now"), "push");
assert.equal(communicationChannelForPurpose("daily_trip_briefing"), "email");
assert.equal(COMMUNICATION_PURPOSES.includes("gmail_reconnect"), true);

const now = new Date("2026-09-08T12:00:00.000Z");
assert.equal(isCommunicationStale({ now, usefulUntil: "2026-09-08T11:59:59.000Z" }), true);
assert.equal(isCommunicationStale({ now, usefulUntil: "2026-09-08T12:00:01.000Z" }), false);
assert.equal(isCommunicationStale({ now, usefulUntil: null }), false);
assert.equal(boundedRetryDelaySeconds(1), 60);
assert.equal(boundedRetryDelaySeconds(20), 3600);

const safe = sanitizeCommunicationMetadata({ purpose: "briefing", attempt: 2, token: "secret", authorization: "Bearer secret", body: "raw Gmail body", long: "x".repeat(1000) });
assert.deepEqual(safe, { purpose: "briefing", attempt: 2 });
assert.equal(JSON.stringify(safe).length <= 4096, true);

const ledger = new Map();
function claim(logicalKey, scheduledFor, usefulUntil, at) {
  const existing = ledger.get(logicalKey) || { status: "pending", attempts: 0 };
  if (existing.status === "sent" || existing.status === "suppressed") return { claimed: false, status: existing.status };
  if (usefulUntil && isCommunicationStale({ now: at, usefulUntil })) {
    existing.status = "suppressed"; ledger.set(logicalKey, existing); return { claimed: false, status: "suppressed" };
  }
  if (new Date(scheduledFor) > at || existing.status === "claimed" || (existing.status === "failed" && existing.retryable === false)) return { claimed: false, status: existing.status };
  existing.status = "claimed"; existing.attempts += 1; ledger.set(logicalKey, existing); return { claimed: true, status: "claimed" };
}
assert.equal(claim(key, "2026-09-08T11:00:00Z", "2026-09-08T13:00:00Z", now).claimed, true);
assert.equal(claim(key, "2026-09-08T11:00:00Z", "2026-09-08T13:00:00Z", now).claimed, false);
ledger.get(key).status = "sent";
assert.equal(claim(key, "2026-09-08T11:00:00Z", "2026-09-08T13:00:00Z", now).claimed, false);
const staleKey = "user-1:trip-1:pretrip_7d:stale";
assert.equal(claim(staleKey, "2026-09-08T11:00:00Z", "2026-09-08T11:59:00Z", now).status, "suppressed");
const retryKey = "user-1:trip-1:booking_material_change:r1";
assert.equal(claim(retryKey, "2026-09-08T11:00:00Z", "2026-09-08T13:00:00Z", now).claimed, true);
ledger.get(retryKey).status = "failed";
assert.equal(claim(retryKey, "2026-09-08T11:00:00Z", "2026-09-08T13:00:00Z", now).claimed, true);
assert.equal(ledger.get(retryKey).attempts, 2);
ledger.get(retryKey).status = "failed";
ledger.get(retryKey).retryable = false;
assert.equal(claim(retryKey, "2026-09-08T11:00:00Z", "2026-09-08T13:00:00Z", now).claimed, false);

console.log("Communication orchestration checks passed.");
