import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  notificationSchedulerHealth,
  NOTIFICATION_SCHEDULER_GRACE_MS
} from "../lib/roamly/communicationHealthLogic.ts";

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260908_roamly_communication_health_foundation.sql"), "utf8");
const route = fs.readFileSync(path.resolve("app/api/cron/roamly-notifications/route.ts"), "utf8");

assert.match(migration, /add column if not exists last_successful_at timestamptz/);
assert.match(migration, /values \('notification_scheduler'\)/);
assert.match(migration, /on conflict \(system_key\) do nothing/);
assert.match(migration, /on public\.roamly_communication_ledger \(claimed_at\)/);
assert.match(migration, /where status = 'claimed'/);
assert.match(migration, /roamly_record_notification_scheduler_success/);
assert.match(migration, /revoke all on function public\.roamly_record_notification_scheduler_success\(\) from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.roamly_record_notification_scheduler_success\(\) to service_role/);
assert.match(route, /recordNotificationSchedulerSuccess/);
assert.ok(route.lastIndexOf("recordNotificationSchedulerSuccess") > route.indexOf("const ok ="));

const now = Date.parse("2026-09-08T12:59:00.000Z");
const t0 = new Date(now - 5 * 60 * 1000).toISOString();
assert.equal(notificationSchedulerHealth({ now, monitoringStartedAt: t0 }).state, "bootstrap");
assert.equal(notificationSchedulerHealth({ now: Date.parse("2026-09-08T13:20:00.000Z"), monitoringStartedAt: t0 }).state, "bootstrap");
assert.equal(notificationSchedulerHealth({ now: Date.parse("2026-09-08T13:31:00.000Z"), monitoringStartedAt: "2026-09-07T12:00:00.000Z" }).state, "stale");
assert.equal(notificationSchedulerHealth({ now: Date.parse("2026-09-08T13:31:00.000Z"), monitoringStartedAt: "2026-09-07T12:00:00.000Z", lastSuccessfulAt: "2026-09-08T13:05:00.000Z" }).state, "healthy");
assert.equal(notificationSchedulerHealth({ now, monitoringStartedAt: "2026-09-07T12:00:00.000Z", lastSuccessfulAt: "2026-09-07T13:05:00.000Z" }).state, "healthy");
assert.equal(NOTIFICATION_SCHEDULER_GRACE_MS, 30 * 60 * 1000);

assert.match(migration, /booking_monitor/);
assert.doesNotMatch(migration, /update public\.roamly_background_health[\s\S]*booking_monitor/);
assert.doesNotMatch(route, /sendRoamlyEmail/);
assert.doesNotMatch(route, /claimCommunication/);

console.log("Communication health foundation checks passed (durable T0, database success heartbeat, daily UTC window, and claimed-at index contract).");
