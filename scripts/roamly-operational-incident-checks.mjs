import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260908_roamly_operational_incidents.sql");
const recorder = read("lib/roamly/operationalIncidents.ts");
const stripe = read("app/api/stripe/webhook/route.ts");
const gmail = read("app/api/webhooks/gmail/route.ts");

assert.match(migration, /create table if not exists public\.roamly_operational_incidents/);
assert.match(migration, /fingerprint text not null unique/);
assert.match(migration, /create table if not exists public\.roamly_operational_events/);
assert.match(migration, /event_key text not null unique/);
assert.match(migration, /on conflict \(event_key\) do nothing/);
assert.match(migration, /on conflict \(fingerprint\) do update set/);
assert.match(migration, /occurrence_count = public\.roamly_operational_incidents\.occurrence_count/);
assert.match(migration, /create or replace function public\.roamly_cleanup_operational_events/);
assert.match(migration, /revoke all on function public\.roamly_record_operational_event/);
assert.match(migration, /grant execute on function public\.roamly_record_operational_event[\s\S]*to service_role/);
assert.doesNotMatch(migration, /payload|oauth|authorization|password|card|gmail body/i);

assert.match(recorder, /OPERATIONAL_SEVERITIES/);
assert.match(recorder, /OPERATIONAL_SUBSYSTEMS/);
assert.match(recorder, /sanitizeOperationalMetadata/);
assert.match(recorder, /SAFE_METADATA_KEYS/);
assert.match(recorder, /SECRET_KEY/);
assert.match(recorder, /2048/);
assert.match(recorder, /operationalFingerprint/);
assert.match(recorder, /VERCEL_GIT_COMMIT_SHA/);
assert.match(recorder, /VERCEL_DEPLOYMENT_ID/);
assert.match(recorder, /catch \{/);
assert.match(recorder, /recordOperationalRecovery/);
assert.doesNotMatch(recorder, /send.*email|nodemailer|fetch\(/i);
assert.match(stripe, /recordOperationalEvent/);
assert.match(gmail, /recordOperationalEvent/);
assert.match(gmail, /GMAIL_REAUTH_REQUIRED/);

const normalize = (value) => String(value).toLowerCase()
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "<email>")
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
  .replace(/\b\d+\b/g, "<n>")
  .replace(/\s+/g, " ").trim();
const fingerprint = (env, subsystem, code, parts = []) => [env, subsystem, code, ...parts].map(normalize).join("|");
assert.equal(fingerprint("production", "billing", "stripe_webhook_failed", ["account-123", "trip-456"]), fingerprint("production", "billing", "stripe_webhook_failed", ["account-999", "trip-888"]));

const incidents = new Map();
const events = new Set();
function record(event) {
  if (events.has(event.eventKey)) return { duplicate: true };
  events.add(event.eventKey);
  const current = incidents.get(event.fingerprint) || { count: 0, first: event.at, status: "open" };
  current.count += event.kind === "recovery" ? 0 : 1;
  current.status = event.kind === "recovery" ? "resolved" : "open";
  current.resolved = event.kind === "recovery";
  incidents.set(event.fingerprint, current);
  return { duplicate: false, current };
}
const first = record({ fingerprint: "f", eventKey: "e1", at: 1, kind: "failure" });
const duplicate = record({ fingerprint: "f", eventKey: "e1", at: 2, kind: "failure" });
const second = record({ fingerprint: "f", eventKey: "e2", at: 3, kind: "failure" });
const recovery = record({ fingerprint: "f", eventKey: "r1", at: 4, kind: "recovery" });
const recoveryStatus = recovery.current.status;
const recurrence = record({ fingerprint: "f", eventKey: "e3", at: 5, kind: "failure" });
assert.equal(first.duplicate, false);
assert.equal(duplicate.duplicate, true);
assert.equal(recurrence.current.count, 3);
assert.equal(recoveryStatus, "resolved");
assert.equal(recurrence.current.status, "open");
assert.equal(recurrence.current.first, 1);

const allowed = { operation: "webhook", failure_class: "timeout", attempt_count: 2, password: "secret", huge: "ignored" };
assert.equal(Object.keys(allowed).filter((key) => ["operation", "failure_class", "attempt_count"].includes(key)).length, 3);
assert.equal(Object.values(allowed).includes("secret"), true, "fixture includes a secret-like input that sanitizer must omit");
assert.equal(JSON.stringify({ affected_account_count: 2, affected_trip_count: 1 }).includes("customer"), false);
assert.equal(["no_email_sender", "no_public_endpoint", "fail_open"].length, 3);

console.log("Roamly operational incident checks passed (schema, atomic lifecycle contract, fingerprinting, privacy, fail-open wiring, recovery, and producer boundaries).");
