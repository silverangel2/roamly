import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { communicationLogicalKey } from "../lib/roamly/communicationPolicy.ts";
import {
  buildTravelDayBriefingContent,
  findFirstTravelDayEvent,
  travelDayWindow,
  tripLocalDayStart
} from "../lib/roamly/travelDayBriefingContent.ts";
import { tripStartFromDate } from "../lib/roamly/preTrip7DayBriefingContent.ts";

const tripStart = tripStartFromDate("2026-10-15", "Asia/Tokyo");
assert.ok(tripStart);
assert.equal(tripStart.toISOString(), "2026-10-15T00:00:00.000Z");
const firstEvent = new Date("2026-10-15T01:30:00.000Z");
const window = travelDayWindow(tripStart, "Asia/Tokyo", firstEvent, new Date("2026-10-14T23:00:00.000Z"));
assert.equal(window.eligible, true);
assert.equal(window.target.toISOString(), "2026-10-14T22:30:00.000Z");
assert.equal(travelDayWindow(tripStart, "Asia/Tokyo", firstEvent, new Date("2026-10-15T02:00:00.000Z")).eligible, false);
assert.equal(travelDayWindow(tripStart, "Asia/Tokyo", null, new Date("2026-10-14T20:59:59.000Z")).eligible, false);
assert.equal(travelDayWindow(tripStart, "Asia/Tokyo", null, new Date("2026-10-14T21:00:00.000Z")).eligible, true);
const earlyEvent = new Date("2026-10-14T15:30:00.000Z");
assert.equal(travelDayWindow(tripStart, "Asia/Tokyo", earlyEvent, new Date("2026-10-14T14:59:59.000Z")).eligible, false);
assert.equal(travelDayWindow(tripStart, "Asia/Tokyo", earlyEvent, new Date("2026-10-14T15:00:00.000Z")).eligible, true);

const dayStart = tripLocalDayStart(tripStart, "Asia/Tokyo");
assert.equal(dayStart.toISOString(), "2026-10-14T15:00:00.000Z");
const bookings = [
  { id: "flight", booking_type: "flight", booking_status: "confirmed", title: "Air Canada", start_at: "2026-10-15T01:30:00.000Z", origin: "YUL", destination: "NRT", traveler_confirmed: true },
  { id: "hotel", booking_type: "hotel", booking_status: "booked", title: "Shinjuku stay", check_in_at: "2026-10-15T08:00:00.000Z", traveler_confirmed: true },
  { id: "old", booking_type: "activity", booking_status: "completed", title: "Yesterday", start_at: "2026-10-14T10:00:00.000Z", traveler_confirmed: true }
];
const selected = findFirstTravelDayEvent({ tripStart, timezone: "Asia/Tokyo", now: new Date("2026-10-14T23:00:00.000Z"), bookings, activities: [
  { id: "old-activity", title: "Old", scheduled_start: "2026-10-14T20:00:00.000Z", status: "expired" },
  { id: "museum", title: "Museum", scheduled_start: "2026-10-15T04:00:00.000Z", status: "planned" }
] });
assert.equal(selected?.toISOString(), firstEvent.toISOString());
assert.equal(findFirstTravelDayEvent({ tripStart, timezone: "Asia/Tokyo", now: new Date("2026-10-15T02:00:00.000Z"), bookings, activities: [] })?.toISOString(), firstEvent.toISOString());
assert.equal(travelDayWindow(tripStart, "Asia/Tokyo", firstEvent, new Date("2026-10-15T02:00:00.000Z")).eligible, false);
assert.equal(findFirstTravelDayEvent({ tripStart, timezone: "Asia/Tokyo", now: new Date("2026-10-14T23:00:00.000Z"), bookings: [{ id: "tomorrow", booking_type: "flight", booking_status: "confirmed", start_at: "2026-10-16T01:00:00.000Z", traveler_confirmed: true }], activities: [] }), null);

const content = buildTravelDayBriefingContent({
  destination: "Tokyo",
  startDate: "2026-10-15",
  endDate: "2026-10-22",
  timezone: "Asia/Tokyo",
  tripStart,
  bookings,
  firstActivity: { id: "museum", title: "Museum", scheduled_start: "2026-10-15T04:00:00.000Z", status: "planned" },
  gmailStatus: null,
  liveCompanionIncluded: true,
  mustDo: "Pick up the rail pass.",
  tripPath: "/trip/trip-1/live"
});
assert.equal(content.subject, "Tokyo starts today");
assert.match(content.body, /Confirmed transport: Air Canada/);
assert.match(content.body, /Stay: Shinjuku stay/);
assert.match(content.body, /First up: Museum/);
assert.match(content.body, /Traveler note: Pick up the rail pass/);
assert.match(content.body, /Live Companion is available/);
assert.equal(content.body.includes("weather"), false);
assert.equal(content.body.includes("delay"), false);
assert.equal(content.ctaLabel, "Open my trip");

const noCompanion = buildTravelDayBriefingContent({ destination: "Cape Breton", tripStart, bookings: [], firstActivity: null, gmailStatus: null, liveCompanionIncluded: false, tripPath: "/trip/trip-2" });
assert.equal(noCompanion.body.includes("Live Companion"), false);
assert.equal(noCompanion.body.includes("flight"), false);
assert.equal(noCompanion.body.includes("hotel"), false);

const t7 = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_7d", occurrenceKey: "pretrip-7d" });
const t1 = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_1d", occurrenceKey: "pretrip-1d" });
const travel = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "travel_day", occurrenceKey: "travel-day" });
assert.equal(new Set([t7, t1, travel]).size, 3);
assert.equal(communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "travel_day", occurrenceKey: "travel-day" }), travel);

const implementation = fs.readFileSync(path.resolve("lib/roamly/travelDayBriefing.ts"), "utf8");
const scheduler = fs.readFileSync(path.resolve("lib/roamly/preTripReminders.ts"), "utf8");
assert.match(implementation, /claimCommunication/);
assert.match(implementation, /completeCommunication/);
assert.match(implementation, /failCommunication/);
assert.match(implementation, /sendRoamlyEmail/);
assert.match(implementation, /purpose: "travel_day"/);
assert.match(implementation, /occurrenceKey: "travel-day"/);
assert.match(implementation, /preferredChannel: "email"/);
assert.match(implementation, /\.eq\("trip_id", currentTrip\.id\)/);
assert.match(implementation, /\.eq\("user_id", currentTrip\.user_id\)/);
assert.equal(implementation.includes("queueCompanionNotification"), false);
assert.equal(implementation.includes("sendPush"), false);
assert.match(scheduler, /scheduleTravelDayBriefing/);
assert.match(scheduler, /type: "travel_day"/);

console.log("Travel-day briefing checks passed.");
