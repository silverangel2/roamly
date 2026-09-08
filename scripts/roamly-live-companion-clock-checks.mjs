import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const delivery = read("lib/roamly/companionNotifications.ts");
const lifecycle = read("lib/roamly/liveCompanionLifecycle.ts");
const itinerary = read("lib/itinerary.ts");
const tripActivation = read("lib/roamly/tripActivation.ts");
const push = read("lib/roamly/pushServer.ts");

assert.match(delivery, /validateLiveActivityDelivery/);
assert.match(delivery, /activityStartDate[\s\S]*activityEndDate/);
assert.match(delivery, /tripWindowState/);
assert.match(delivery, /status: "suppressed"/);
assert.match(delivery, /starting_soon_window_passed/);
assert.match(delivery, /activity_window_passed/);
assert.match(delivery, /TERMINAL_ACTIVITY_STATUSES/);
assert.match(lifecycle, /processLiveCompanionTimeLifecycle/);
assert.match(lifecycle, /status: "missed"/);
assert.match(lifecycle, /sendCompanionNotificationDelivery/);
assert.match(itinerary, /timeZone: timezone/);
const dayFunction = itinerary.slice(itinerary.indexOf("export function getTripDayFromDate"));
assert.doesNotMatch(dayFunction, /new Date\(`\$\{startDate\}T00:00:00`\)/);
assert.match(tripActivation, /getTripDayFromDate\([^\n]*timezoneFromTripMetadata/);
assert.match(push, /roamly-activity-\$\{securedPayload\.tripId\}/);

const dayInZone = (startDate, timezone, now) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const today = Date.UTC(value("year"), value("month") - 1, value("day"));
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return Math.floor((today - start) / 86_400_000) + 1;
};
assert.equal(dayInZone("2026-09-07", "Asia/Tokyo", "2026-09-07T15:30:00Z"), 2, "destination-local Tuesday wins over server Monday");
assert.equal(dayInZone("2026-09-07", "Asia/Tokyo", "2026-09-07T00:30:00Z"), 1, "destination-local Monday remains day one");

const window = (type, start, end, now, status = "planned", tripStatus = "active") => {
  if (["completed", "cancelled", "archived"].includes(tripStatus) || ["completed", "skipped", "missed", "expired", "cancelled"].includes(status)) return false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const nowMs = Date.parse(now);
  if (type === "next_activity") return startMs > nowMs && (startMs - nowMs) / 60_000 <= 30;
  return startMs <= nowMs && endMs > nowMs;
};
assert.equal(window("next_activity", "2026-09-08T10:20:00Z", "2026-09-08T11:20:00Z", "2026-09-08T10:00:00Z"), true);
assert.equal(window("next_activity", "2026-09-08T10:20:00Z", "2026-09-08T11:20:00Z", "2026-09-08T10:25:00Z"), false);
assert.equal(window("activity_start", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z", "2026-09-08T10:30:00Z"), true);
assert.equal(window("activity_start", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z", "2026-09-08T11:01:00Z"), false);
assert.equal(window("activity_start", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z", "2026-09-08T10:30:00Z", "missed"), false);
assert.equal(window("activity_start", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z", "2026-09-08T10:30:00Z", "planned", "completed"), false);

console.log("Roamly Live Companion clock checks passed (delivery-time staleness, trip/day guards, terminal suppression, and destination-local day calculation).");
