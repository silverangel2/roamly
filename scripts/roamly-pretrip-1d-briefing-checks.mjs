import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { communicationLogicalKey } from "../lib/roamly/communicationPolicy.ts";
import {
  buildPreTrip1DayBriefingContent,
  preTrip1DayWindow
} from "../lib/roamly/preTrip1DayBriefingContent.ts";
import { tripStartFromDate } from "../lib/roamly/preTrip7DayBriefingContent.ts";

const tripStart = new Date("2026-10-15T13:00:00.000Z");
const target = new Date("2026-10-14T13:00:00.000Z");
assert.equal(tripStartFromDate("2026-10-15", "Asia/Tokyo")?.toISOString(), "2026-10-15T00:00:00.000Z");
assert.equal(preTrip1DayWindow(tripStart, new Date("2026-10-14T12:59:59.000Z")).eligible, false);
assert.equal(preTrip1DayWindow(tripStart, new Date("2026-10-14T18:00:00.000Z")).eligible, true);
assert.equal(preTrip1DayWindow(tripStart, new Date("2026-10-15T12:59:59.000Z")).eligible, true);
assert.equal(preTrip1DayWindow(tripStart, tripStart).eligible, false);
assert.equal(preTrip1DayWindow(tripStart, new Date("2026-10-16T13:00:00.000Z")).eligible, false);
assert.equal(preTrip1DayWindow(tripStart, new Date("2026-10-14T18:00:00.000Z")).usefulUntil.toISOString(), tripStart.toISOString());

const t7Key = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_7d", occurrenceKey: "pretrip-7d" });
const t1Key = communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_1d", occurrenceKey: "pretrip-1d" });
assert.notEqual(t7Key, t1Key);
assert.equal(communicationLogicalKey({ userId: "user-1", tripId: "trip-1", purpose: "pretrip_1d", occurrenceKey: "pretrip-1d" }), t1Key);
assert.notEqual(communicationLogicalKey({ userId: "user-1", tripId: "trip-2", purpose: "pretrip_1d", occurrenceKey: "pretrip-1d" }), t1Key);

const content = buildPreTrip1DayBriefingContent({
  destination: "Tokyo",
  startDate: "2026-10-15",
  endDate: "2026-10-22",
  timezone: "Asia/Tokyo",
  tripStart,
  bookings: [
    { id: "flight-1", booking_type: "flight", booking_status: "confirmed", title: "Air Canada", start_at: "2026-10-15T13:00:00.000Z", origin: "YUL", destination: "NRT", traveler_confirmed: true },
    { id: "hotel-1", booking_type: "hotel", booking_status: "booked", title: "Shinjuku stay", check_in_at: "2026-10-15T15:00:00.000Z", traveler_confirmed: true },
    { id: "cancelled-1", booking_type: "activity", booking_status: "cancelled", title: "Cancelled museum", traveler_confirmed: true }
  ],
  firstActivity: { id: "activity-1", title: "Tsukiji walk", scheduled_start: "2026-10-15T23:00:00.000Z", address: "Tsukiji", status: "planned" },
  gmailStatus: "connected",
  liveCompanionIncluded: true,
  mustDo: "Pick up the rail pass.",
  tripPath: "/trip/trip-1"
});
assert.match(content.subject, /Tokyo starts tomorrow/);
assert.match(content.body, /Transport: Air Canada/);
assert.match(content.body, /YUL to NRT/);
assert.match(content.body, /Stay: Shinjuku stay/);
assert.match(content.body, /First up: Tsukiji walk/);
assert.match(content.body, /Cancelled museum needs attention/);
assert.match(content.body, /rail pass/);
assert.match(content.body, /Booking email monitoring is connected/);
assert.match(content.body, /Live Companion is included/);
assert.equal(content.body.includes("flight missing"), false);
assert.equal(content.body.includes("hotel missing"), false);
assert.equal(content.body.includes("delay"), false);
assert.equal(content.body.includes("weather"), false);
assert.equal(content.body.includes("affiliate"), false);
assert.equal(content.ctaLabel, "View tomorrow's plan");
assert.equal(content.tripPath, "/trip/trip-1");

const roadTrip = buildPreTrip1DayBriefingContent({
  destination: "Cape Breton",
  startDate: "2026-10-15",
  endDate: "2026-10-20",
  timezone: "America/Moncton",
  tripStart,
  bookings: [],
  firstActivity: null,
  gmailStatus: null,
  liveCompanionIncluded: false,
  tripPath: "/trip/trip-2"
});
assert.equal(roadTrip.body.includes("flight missing"), false);
assert.equal(roadTrip.body.includes("hotel missing"), false);
assert.equal(roadTrip.body.includes("Live Companion"), false);

const implementation = fs.readFileSync(path.resolve("lib/roamly/preTrip1DayBriefing.ts"), "utf8");
const scheduler = fs.readFileSync(path.resolve("lib/roamly/preTripReminders.ts"), "utf8");
assert.match(implementation, /claimCommunication/);
assert.match(implementation, /completeCommunication/);
assert.match(implementation, /failCommunication/);
assert.match(implementation, /sendRoamlyEmail/);
assert.match(implementation, /purpose: "pretrip_1d"/);
assert.match(implementation, /occurrenceKey: "pretrip-1d"/);
assert.match(implementation, /preferredChannel: "email"/);
assert.match(implementation, /\.eq\("trip_id", currentTrip\.id\)/);
assert.match(implementation, /\.eq\("user_id", currentTrip\.user_id\)/);
assert.match(implementation, /PRETRIP_1D_BOOKINGS_UNAVAILABLE/);
assert.match(implementation, /uncertainAcceptance/);
assert.equal(implementation.includes("queueCompanionNotification"), false);
assert.equal(implementation.includes("send_email"), false);
assert.match(scheduler, /schedulePreTrip1DayBriefing/);
assert.match(scheduler, /!\["trip_predeparture_7d", "trip_predeparture_1d"\]\.includes\(type\)/);

console.log("Pre-trip 1-day briefing checks passed.");
