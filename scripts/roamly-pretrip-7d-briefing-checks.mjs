import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildPreTrip7DayBriefingContent,
  preTrip7DayWindow
} from "../lib/roamly/preTrip7DayBriefingContent.ts";

const tripStart = new Date("2026-10-15T13:00:00.000Z");
const target = new Date("2026-10-08T13:00:00.000Z");

assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-08T12:59:59.000Z")).eligible, false);
assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-08T14:00:00.000Z")).eligible, true);
assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-09T00:59:59.000Z")).eligible, true);
assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-10T01:00:00.000Z")).eligible, false);
assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-15T13:00:00.000Z")).eligible, false);
assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-15T12:59:59.000Z")).eligible, false);
assert.equal(preTrip7DayWindow(tripStart, new Date("2026-10-08T14:00:00.000Z")).target.toISOString(), target.toISOString());

const content = buildPreTrip7DayBriefingContent({
  destination: "Tokyo",
  startDate: "2026-10-15",
  endDate: "2026-10-22",
  timezone: "Asia/Tokyo",
  confirmedBookings: [
    { id: "flight-1", booking_type: "flight", booking_status: "confirmed", title: "Air Canada", start_at: "2026-10-15T13:00:00.000Z", traveler_confirmed: true },
    { id: "hotel-1", booking_type: "hotel", booking_status: "booked", title: "Shinjuku hotel", check_in_at: "2026-10-15T15:00:00.000Z", traveler_confirmed: true },
    { id: "activity-1", booking_type: "activity", booking_status: "cancelled", title: "Museum tour", traveler_confirmed: true }
  ],
  gmailStatus: "connected",
  mustDo: "Check the rail pass pickup.",
  tripPath: "/trip/trip-1"
});
assert.match(content.subject, /Tokyo/);
assert.match(content.body, /Confirmed:/);
assert.match(content.body, /Air Canada/);
assert.match(content.body, /Shinjuku hotel/);
assert.match(content.body, /Needs attention:/);
assert.match(content.body, /rail pass pickup/);
assert.match(content.body, /Booking email monitoring is connected/);
assert.equal(content.tripPath, "/trip/trip-1");
assert.equal(content.body.includes("weather"), false);
assert.equal(content.body.includes("affiliate"), false);

const disconnected = buildPreTrip7DayBriefingContent({
  destination: "Moncton",
  startDate: "2026-11-01",
  endDate: "2026-11-03",
  timezone: "America/Moncton",
  confirmedBookings: [],
  gmailStatus: "disconnected",
  tripPath: "/trip/trip-2"
});
assert.match(disconnected.body, /Connect your booking email/);
assert.equal(disconnected.body.includes("not connected"), false);

const roadTrip = buildPreTrip7DayBriefingContent({
  destination: "Cape Breton",
  startDate: "2026-10-15",
  endDate: "2026-10-20",
  timezone: "America/Moncton",
  confirmedBookings: [],
  gmailStatus: null,
  tripPath: "/trip/trip-3"
});
assert.equal(roadTrip.body.includes("hotel missing"), false);
assert.equal(roadTrip.body.includes("flight missing"), false);

const implementation = fs.readFileSync(path.resolve("lib/roamly/preTrip7DayBriefing.ts"), "utf8");
const scheduler = fs.readFileSync(path.resolve("lib/roamly/preTripReminders.ts"), "utf8");
assert.match(implementation, /claimCommunication/);
assert.match(implementation, /completeCommunication/);
assert.match(implementation, /failCommunication/);
assert.match(implementation, /sendRoamlyEmail/);
assert.match(implementation, /purpose: "pretrip_7d"/);
assert.match(implementation, /occurrenceKey: "pretrip-7d"/);
assert.match(implementation, /communicationLogicalKey/);
assert.match(implementation, /useful_until|usefulUntil/);
assert.match(implementation, /uncertainAcceptance/);
assert.equal(implementation.includes("queueCompanionNotification"), false);
assert.equal(implementation.includes("send_email"), false);
assert.match(implementation, /params\.now/);
assert.match(scheduler, /schedulePreTrip7DayBriefing/);
assert.match(scheduler, /filter\(\(type\) => !\["trip_predeparture_7d", "trip_predeparture_1d"\]\.includes\(type\)\)/);

console.log("Pre-trip 7-day briefing checks passed.");
