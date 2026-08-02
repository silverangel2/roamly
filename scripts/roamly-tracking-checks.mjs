import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compileTs(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    require,
    console,
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox);
  return sandbox.module.exports;
}

const { calculateDistanceMeters, isWithinRadius, normalizeCoordinates } = compileTs("../lib/roamly/location.ts");
const live = compileTs("../lib/roamly/liveCompanion.ts");

const cnTower = { latitude: 43.6426, longitude: -79.3871 };
const ripley = { latitude: 43.6424, longitude: -79.386 };
const montreal = { latitude: 45.5019, longitude: -73.5674 };

assert.equal(normalizeCoordinates({ latitude: 91, longitude: 0 }), null);
const normalized = normalizeCoordinates({ latitude: 43.6, longitude: -79.3, accuracy: 12 });
assert.equal(normalized.latitude, 43.6);
assert.equal(normalized.longitude, -79.3);
assert.equal(normalized.accuracy, 12);

assert.ok(calculateDistanceMeters(cnTower.latitude, cnTower.longitude, ripley.latitude, ripley.longitude) < 150);
assert.equal(isWithinRadius(cnTower.latitude, cnTower.longitude, ripley.latitude, ripley.longitude, 250), true);
assert.equal(isWithinRadius(montreal.latitude, montreal.longitude, cnTower.latitude, cnTower.longitude, 250), false);

const trip = {
  id: "trip-1",
  startDate: "2026-08-01",
  endDate: "2026-08-03",
  timezone: "America/Toronto",
  enabled: true,
  destination: { label: "Toronto", latitude: 43.6532, longitude: -79.3832 }
};
const futureTrip = { ...trip, startDate: "2026-08-05", endDate: "2026-08-06" };
const activities = [
  {
    id: "cn",
    title: "CN Tower",
    date: "2026-08-01",
    timeLabel: "9:00 AM",
    latitude: 43.6426,
    longitude: -79.3871,
    radiusMeters: 130
  },
  {
    id: "ripley",
    title: "Ripley's Aquarium of Canada",
    date: "2026-08-01",
    timeLabel: "11:00 AM",
    latitude: 43.6424,
    longitude: -79.386,
    radiusMeters: 130
  },
  {
    id: "rom",
    title: "Royal Ontario Museum",
    date: "2026-08-01",
    timeLabel: "3:00 PM",
    latitude: 43.6677,
    longitude: -79.3948,
    radiusMeters: 130
  }
];
const activeNow = "2026-08-01T13:00:00Z";
const nearToronto = { latitude: 43.6426, longitude: -79.3871 };
const farAway = { latitude: 45.5019, longitude: -73.5674 };

assert.equal(
  live.isTodayWithinTripDates({ startDate: trip.startDate, endDate: trip.endDate, timezone: trip.timezone, now: activeNow }),
  true,
  "Live Companion must activate only inside the trip date window"
);
assert.equal(
  live.evaluateLiveCompanionActivation({ trip: futureTrip, permission: "granted", location: nearToronto, now: activeNow }).status,
  "future_trip",
  "future trips must not activate"
);
assert.equal(
  live.localDateInTimeZone("2026-08-02T03:30:00Z", "America/Vancouver"),
  "2026-08-01",
  "timezone handling must use the destination local date"
);
const selection = live.selectNowAndNextActivity({
  activities,
  tripStartDate: trip.startDate,
  timezone: trip.timezone,
  now: "2026-08-01T14:10:00Z"
});
assert.equal(selection.now.title, "CN Tower", "Now activity should follow local trip timing");
assert.equal(selection.next.title, "Ripley's Aquarium of Canada", "Next activity should be the next incomplete stop");

const route = {
  status: "verified",
  provider: "test_maps",
  mode: "walking",
  durationMinutes: 18,
  retrievedAt: activeNow,
  mapsUrl: "https://maps.example.test"
};
const nextStart = live.activityStartDate({ activity: activities[1], tripStartDate: trip.startDate, timezone: trip.timezone });
const departure = live.calculateRecommendedDeparture({ nextStartAt: nextStart, routeDurationMinutes: 18, bufferMinutes: 12 });
assert.equal(departure.toISOString(), "2026-08-01T14:30:00.000Z", "departure time must subtract route duration and buffer");
assert.equal(
  live.evaluateLateUserAdjustment({
    now: "2026-08-01T14:50:00Z",
    recommendedDepartureAt: departure,
    nextStartAt: nextStart,
    lateThresholdMinutes: 8
  }).late,
  true,
  "late-user adjustment should trigger after the configured threshold"
);
assert.equal(
  live.detectArrival({ location: nearToronto, activity: activities[0], radiusMeters: 130 }).arrived,
  true,
  "arrival detection should trigger inside the activity radius"
);
assert.equal(
  live.evaluateLiveCompanionActivation({ trip, permission: "denied", location: nearToronto, now: activeNow }).status,
  "permission_required",
  "location permission denied should keep Live Companion in schedule-only fallback"
);
assert.equal(
  live.evaluateLiveCompanionActivation({ trip, permission: "granted", location: farAway, now: activeNow }).status,
  "too_far",
  "destination proximity must be required for live activation"
);

const history = [
  {
    key: "arrival:cn:2026-08-01",
    eventType: "arrival",
    activityId: "cn",
    sentAt: "2026-08-01T14:02:00Z"
  }
];
assert.equal(
  live.evaluateNotificationDecision({
    eventType: "arrival",
    activity: activities[0],
    now: "2026-08-01T14:05:00Z",
    history,
    activeWindow: true,
    locationState: "arrived",
    reason: "Arrived at stop."
  }).suppressionReason,
  "duplicate_event",
  "arrival notification must only fire once for an activity"
);
assert.equal(
  live.evaluateNotificationDecision({
    eventType: "leave_by",
    activity: activities[1],
    now: "2026-08-01T14:06:00Z",
    history: [{ key: "leave_by:ripley:2026-08-01", eventType: "leave_by", activityId: "ripley", sentAt: "2026-08-01T14:00:00Z" }],
    activeWindow: true,
    locationState: "away",
    reason: "Departure reminder."
  }).suppressionReason,
  "cooldown",
  "reminder cooldown must suppress repeated notifications"
);
assert.equal(
  live.evaluateNotificationDecision({
    eventType: "late",
    activity: activities[1],
    now: activeNow,
    history: [],
    activeWindow: false,
    locationState: "away",
    reason: "Late."
  }).suppressionReason,
  "outside_active_trip_window",
  "notifications must not fire outside the active trip window"
);
assert.equal(
  live.evaluateNotificationDecision({
    eventType: "next_activity",
    activity: activities[1],
    now: activeNow,
    history: [],
    activeWindow: true,
    paused: true,
    locationState: "away",
    reason: "Next activity changed."
  }).suppressionReason,
  "paused",
  "notifications must not fire while Live Companion is paused"
);
const state = live.buildLiveCompanionState({
  trip,
  activities,
  permission: "granted",
  location: nearToronto,
  route,
  now: "2026-08-01T14:05:00Z"
});
assert.equal(state.activationStatus, "active", "active trip near destination should activate");
assert.equal(state.route.status, "verified", "verified route data should stay labeled as verified");
const offlineState = live.buildLiveCompanionState({
  trip,
  activities,
  permission: "granted",
  location: nearToronto,
  route: {
    status: "offline",
    mapsUrl: "https://maps.example.test",
    reason: "Offline mode."
  },
  now: activeNow
});
assert.equal(offlineState.route.status, "offline", "offline fallback should keep itinerary state available");
assert.equal(
  live.applyVerifiedBookingOverride(
    { id: "flight-step", title: "AC123 to Toronto", timeLabel: "9:00 AM", booking: { status: "stale", startTime: "2026-08-01T13:00:00Z" } },
    [{ id: "booking-1", title: "AC123 to Toronto", reference: "ABC123", startTime: "2026-08-01T14:00:00Z", status: "verified" }]
  ).startAt,
  "2026-08-01T14:00:00Z",
  "verified booking changes must override stale itinerary timing"
);

console.log("Roamly tracking checks passed.");
