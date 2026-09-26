import assert from "node:assert/strict";
import fs from "node:fs";
import { customerTripLifecycleState, dedupeEquivalentNotifications, notificationActionState } from "../lib/roamly/liveCompanion.ts";

const upcoming = { status: "planned", startDate: "2026-10-15", endDate: "2026-10-20", metadata: { planning: { timezone: "America/Toronto" } } };
const active = { ...upcoming, startDate: "2026-10-01", endDate: "2026-10-15" };
const completed = { ...upcoming, startDate: "2026-09-01", endDate: "2026-09-05" };

assert.equal(customerTripLifecycleState(upcoming, "2026-10-08T12:00:00Z"), "upcoming");
assert.equal(customerTripLifecycleState(active, "2026-10-10T12:00:00Z"), "active");
assert.equal(customerTripLifecycleState(completed, "2026-10-10T12:00:00Z"), "completed");
assert.equal(customerTripLifecycleState({ ...upcoming, status: "completed" }, "2026-10-08T12:00:00Z"), "completed");

assert.equal(notificationActionState({ actionUrl: "/trip/upcoming/live", trip: upcoming, now: "2026-10-08T12:00:00Z" }), "available");
assert.equal(notificationActionState({ actionUrl: "/trip/active/live", trip: active, now: "2026-10-10T12:00:00Z" }), "available");
assert.equal(notificationActionState({ actionUrl: "/trip/completed/live", trip: completed, now: "2026-10-10T12:00:00Z" }), "history");
assert.equal(notificationActionState({ actionUrl: "/trip/missing/live", trip: null }), "unavailable");

const first = { id: "n1", trip_id: "trip-1", type: "trip_predeparture_7d", title: "One week before your trip", body: "Review bookings.", created_at: "2026-10-01T00:00:00Z", scheduled_for: "2026-10-08T00:00:00Z" };
const duplicate = { ...first, id: "n2", created_at: "2026-10-01T00:01:00Z" };
const distinctOccurrence = { ...first, id: "n3", scheduled_for: "2026-10-09T00:00:00Z" };
assert.deepEqual(dedupeEquivalentNotifications([first, duplicate, distinctOccurrence]).map((item) => item.id), ["n1", "n3"]);

const tripPage = fs.readFileSync("app/trip/[id]/page.tsx", "utf8");
const livePage = fs.readFileSync("app/trip/[id]/live/page.tsx", "utf8");
const notificationsPage = fs.readFileSync("app/notifications/page.tsx", "utf8");
assert.match(tripPage, /customerTripLifecycleState/);
assert.match(tripPage, /completedTrip \? null/);
assert.match(tripPage, /trackingUnlocked && !completedTrip/);
assert.match(tripPage, /status=\{completedTrip \? "Completed"/);
assert.match(livePage, /if \(!tripCompleted\) await scheduleCompanionEvents/);
assert.match(livePage, /tripCompleted \? \(/);
assert.match(livePage, /Live Companion is closed for this trip/);
assert.match(notificationsPage, /dedupeEquivalentNotifications/);
assert.match(notificationsPage, /actionState === "available"/);

console.log("G-A15-01 focused lifecycle and notification checks passed.");
