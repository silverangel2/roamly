import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { communicationLogicalKey } from "../lib/roamly/communicationPolicy.ts";
import { tripStartFromDate } from "../lib/roamly/preTrip7DayBriefingContent.ts";
import { buildDailyTripBriefingContent, dailyTripWindow, findFirstDailyEvent, localDayStart } from "../lib/roamly/dailyTripBriefingContent.ts";

const tripStart = tripStartFromDate("2026-10-10", "Asia/Tokyo");
assert.ok(tripStart);
const dayTwo = new Date("2026-10-11T00:00:00.000Z");
const earlyEvent = new Date("2026-10-11T01:00:00.000Z");
const dayTwoWindow = dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-10T22:30:00.000Z"), firstEventAt: earlyEvent });
assert.equal(dayTwoWindow.dayKey, "2026-10-11");
assert.equal(dayTwoWindow.eligible, true);
assert.equal(dayTwoWindow.target.toISOString(), "2026-10-10T22:00:00.000Z");
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-10T14:59:59.000Z"), firstEventAt: earlyEvent }).eligible, false);
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-10T22:00:00.000Z"), firstEventAt: earlyEvent }).eligible, true);
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-11T01:01:00.000Z"), firstEventAt: earlyEvent }).eligible, false);
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-10T23:00:00.000Z"), firstEventAt: null }).eligible, true);
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-10T23:00:00.000Z"), firstEventAt: null }).dayKey, "2026-10-11");
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-10T00:00:00.000Z") }).eligible, false);
assert.equal(dailyTripWindow({ tripStart, tripEnd: "2026-10-12", timezone: "Asia/Tokyo", now: new Date("2026-10-12T03:00:00.000Z") }).eligible, false);
assert.equal(localDayStart(dayTwo, "Asia/Tokyo").toISOString(), "2026-10-10T15:00:00.000Z");

const activities = [
  { id: "done", title: "Breakfast", scheduled_start: "2026-10-10T23:00:00.000Z", status: "completed" },
  { id: "skipped", title: "Museum", scheduled_start: "2026-10-11T00:00:00.000Z", status: "skipped" },
  { id: "next", title: "Gallery", scheduled_start: "2026-10-11T04:00:00.000Z", status: "planned" },
  { id: "later", title: "Dinner", scheduled_start: "2026-10-11T10:00:00.000Z", status: "planned" }
];
const firstEvent = findFirstDailyEvent({ date: dayTwo, timezone: "Asia/Tokyo", bookings: [], activities });
assert.equal(firstEvent?.toISOString(), "2026-10-11T04:00:00.000Z");
const content = buildDailyTripBriefingContent({ destination: "Tokyo", dayKey: "2026-10-11", timezone: "Asia/Tokyo", now: new Date("2026-10-10T22:30:00.000Z"), bookings: [{ id: "flight", booking_type: "flight", booking_status: "confirmed", title: "Air Canada", start_at: "2026-10-11T01:00:00.000Z", traveler_confirmed: true }], activities, mustDo: "Pick up the rail pass", liveCompanionIncluded: true, tripPath: "/trip/trip-1/live" });
assert.match(content.subject, /Your day in Tokyo/);
assert.match(content.body, /First up: Gallery/);
assert.doesNotMatch(content.body, /Breakfast/);
assert.doesNotMatch(content.body, /Museum/);
assert.match(content.body, /Confirmed: Air Canada/);
assert.match(content.body, /Traveler note: Pick up the rail pass/);
assert.match(content.body, /Live Companion is available/);
assert.doesNotMatch(content.body, /weather|delay|affiliate/i);
assert.equal(content.ctaLabel, "View today's plan");

const malformedTimestampContent = buildDailyTripBriefingContent({
  destination: "Tokyo",
  dayKey: "2026-10-11",
  timezone: "Asia/Tokyo",
  now: new Date("2026-10-10T22:30:00.000Z"),
  bookings: [],
  activities: [{ id: "bad", title: "Malformed", scheduled_start: "not-a-date", status: "planned" }],
  liveCompanionIncluded: false,
  tripPath: "/trip/trip-1"
});
assert.doesNotMatch(malformedTimestampContent.body, /Malformed/);

const quiet = buildDailyTripBriefingContent({ destination: "Tokyo", dayKey: "2026-10-11", timezone: "Asia/Tokyo", now: new Date("2026-10-10T22:30:00.000Z"), bookings: [], activities: [], liveCompanionIncluded: false, tripPath: "/trip/trip-1" });
assert.match(quiet.body, /schedule is open/);
assert.doesNotMatch(quiet.body, /Live Companion/);

const t1 = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_1d", occurrenceKey: "pretrip-1d" });
const daily = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "daily_trip_briefing", occurrenceKey: "daily:2026-10-11" });
const nextDaily = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "daily_trip_briefing", occurrenceKey: "daily:2026-10-12" });
assert.equal(new Set([t1, daily, nextDaily]).size, 3);

const implementation = fs.readFileSync(path.resolve("lib/roamly/dailyTripBriefing.ts"), "utf8");
const scheduler = fs.readFileSync(path.resolve("lib/roamly/preTripReminders.ts"), "utf8");
assert.match(implementation, /claimCommunication/);
assert.match(implementation, /completeCommunication/);
assert.match(implementation, /failCommunication/);
assert.match(implementation, /sendRoamlyEmail/);
assert.match(implementation, /purpose: "daily_trip_briefing"/);
assert.match(implementation, /occurrenceKey/);
assert.match(implementation, /\.eq\("trip_id", currentTrip\.id\)/);
assert.match(implementation, /\.eq\("user_id", currentTrip\.user_id\)/);
assert.equal(implementation.includes("queueCompanionNotification"), false);
assert.equal(implementation.includes("sendPush"), false);
assert.match(scheduler, /scheduleDailyTripBriefing/);
assert.match(scheduler, /type: "daily_trip_briefing"/);

console.log("Daily trip briefing checks passed.");
