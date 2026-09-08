import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BOOKING_MONITOR_BOOTSTRAP_GRACE_MS,
  classifyBookingMonitorBootstrap
} from "../lib/roamly/bookingMonitorBootstrapLogic.ts";

const now = Date.parse("2026-09-08T12:00:00.000Z");
assert.equal(classifyBookingMonitorBootstrap(new Date(now - 5 * 60 * 1000).toISOString(), false, now).state, "bootstrap");
assert.equal(classifyBookingMonitorBootstrap(new Date(now - 29 * 60 * 1000).toISOString(), false, now).state, "bootstrap");
assert.equal(classifyBookingMonitorBootstrap(new Date(now - BOOKING_MONITOR_BOOTSTRAP_GRACE_MS).toISOString(), false, now).state, "stale");
assert.equal(classifyBookingMonitorBootstrap(new Date(now - 2 * 60 * 60 * 1000).toISOString(), true, now).state, "run_history");
assert.equal(classifyBookingMonitorBootstrap(new Date(now - 2 * 60 * 60 * 1000).toISOString(), false, now).reason, "never_ran");
assert.equal(classifyBookingMonitorBootstrap(null, false, now).state, "bootstrap");

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260908_roamly_booking_monitor_health_bootstrap.sql"), "utf8");
assert.match(migration, /system_key text primary key/);
assert.match(migration, /monitoring_started_at timestamptz not null default now\(\)/);
assert.match(migration, /on conflict \(system_key\) do nothing/);
assert.match(migration, /select 'booking_monitor', coalesce\(min\(started_at\), now\(\)\)/);
assert.match(migration, /revoke all on table public\.roamly_background_health from public, anon, authenticated/);
assert.match(migration, /grant all privileges on table public\.roamly_background_health to service_role/);

console.log("Roamly booking-monitor bootstrap checks passed (durable T0, bounded grace, run-history precedence, and service-role-only state).");
