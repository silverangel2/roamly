import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BOOKING_MONITOR_RUN_GRACE_MS,
  BOOKING_MONITOR_STALE_AFTER_MS,
  classifyBookingMonitorHealth
} from "../lib/roamly/bookingMonitorHealthLogic.ts";

const now = Date.parse("2026-09-08T12:00:00.000Z");
const completed = (overrides = {}) => ({ id: "run", status: "completed", started_at: "2026-09-08T11:50:00.000Z", completed_at: "2026-09-08T11:51:00.000Z", failures: 0, ...overrides });

assert.equal(classifyBookingMonitorHealth([], now, "2026-09-08T11:55:00.000Z").state, "bootstrap");
assert.equal(classifyBookingMonitorHealth([], now, "2026-09-08T11:29:00.000Z").state, "stale");
assert.equal(classifyBookingMonitorHealth([], now, "2026-09-08T11:30:00.000Z").reason, "never_ran");
assert.equal(classifyBookingMonitorHealth([completed()], now).state, "healthy");
assert.equal(classifyBookingMonitorHealth([completed({ status: "running", completed_at: null, started_at: "2026-09-08T11:55:00.000Z" })], now).state, "healthy");
assert.equal(classifyBookingMonitorHealth([completed({ status: "running", completed_at: null, started_at: new Date(now - BOOKING_MONITOR_RUN_GRACE_MS - 1).toISOString() })], now).state, "stale");
assert.equal(classifyBookingMonitorHealth([completed({ completed_at: new Date(now - BOOKING_MONITOR_STALE_AFTER_MS - 1).toISOString() })], now).state, "stale");
assert.equal(classifyBookingMonitorHealth([completed({ id: "old-failure", status: "failed", completed_at: "2026-09-08T11:40:00.000Z", failures: 1 }), completed({ id: "new-success" })], now).state, "healthy");
assert.equal(classifyBookingMonitorHealth([completed({ id: "recent-success" }), completed({ id: "isolated-failure", status: "failed", completed_at: "2026-09-08T11:59:00.000Z", failures: 1 })], now).state, "healthy");
assert.equal(classifyBookingMonitorHealth([completed({ id: "failed-2", status: "failed", completed_at: "2026-09-08T11:55:00.000Z", failures: 1 }), completed({ id: "failed-1", status: "partial", completed_at: "2026-09-08T11:45:00.000Z", failures: 1 })], now).state, "stale");
assert.equal(classifyBookingMonitorHealth([completed({ id: "old-run", status: "failed", completed_at: "2026-09-08T11:30:00.000Z" }), completed({ id: "newer-success" })], now).state, "healthy");

const route = fs.readFileSync(path.resolve("app/api/cron/roamly-itinerary-generation/route.ts"), "utf8");
assert.ok(route.indexOf("processGenerationQueue") < route.indexOf("runStuckGenerationDetector"));
assert.ok(route.indexOf("runStuckGenerationDetector") < route.indexOf("runBookingMonitorHealthDetector"));
assert.match(route, /runBookingMonitorHealthDetector\(\)\.catch/);
const detector = fs.readFileSync(path.resolve("lib/roamly/bookingMonitorHealth.ts"), "utf8");
assert.match(detector, /from\("roamly_background_health"\)/);
assert.match(detector, /from\("roamly_booking_monitor_runs"\)/);
assert.match(detector, /\.limit\(20\)/);
assert.doesNotMatch(detector, /sendRoamlyEmail|gmail|email_connections|roamly_trips/i);

console.log("Roamly booking-monitor health checks passed (durable bootstrap aging, run-history precedence, systemic classification, bounded queries, and fail-open sequential wiring).");
