// roamly-ux-notification-timezone-checks.mjs — NOTIFICATION-TIMEZONE
// ROUND (2026-10-27, local only). The residual from the timezone round:
// background notification-scheduling code resolved the trip zone from
// stored metadata alone and silently fell back to UTC, while Live,
// Alerts, and Country info already used the shared resolver (metadata,
// then the verified destination registry, else explicit unknown).
// The fix: lib/roamly/backgroundNotificationTimezone.ts — the SAME
// server resolution for every background scheduler — plus HELD (never
// a guessed-zone send) when the zone is genuinely unknown.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-notification-timezone-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKGROUND_TIMEZONE_HOLD,
  resolveBackgroundTripTimezone
} from "@/lib/roamly/backgroundNotificationTimezone.ts";
import {
  duePreTripReminderTypes,
  preTripReminderVersion,
  tripStartInstant,
  zonedDateTimeToUtc
} from "@/lib/roamly/preTripReminders.ts";
import { localDateInZone } from "@/lib/roamly/tripTimezone.ts";
import { tripStartFromDate, preTrip7DayWindow } from "@/lib/roamly/preTrip7DayBriefingContent.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const montrealTrip = (over = {}) => ({
  id: "trip-montreal", user_id: "user-a", title: "Montreal trip",
  destination: "Montreal", destination_name: "Montreal", destination_city: null,
  start_date: "2026-10-27", end_date: "2026-10-31", status: "active",
  itinerary_status: "ready", metadata: {}, ...over
});
const torontoTrip = (over = {}) => ({
  id: "trip-toronto", user_id: "user-a", title: "Toronto trip",
  destination: "Toronto", destination_name: "Toronto", destination_city: null,
  start_date: "2026-11-10", end_date: "2026-11-14", status: "planned",
  itinerary_status: "ready", metadata: {}, ...over
});

// ---- 1. The shared resolution, background edition ----
check("background resolution: stored metadata wins over the registry",
  (() => {
    const r = resolveBackgroundTripTimezone(montrealTrip({ metadata: { planning: { timezone: "America/Halifax" } } }));
    return r.zone === "America/Halifax" && r.source === "metadata" && r.known && !r.held && r.holdReason === null;
  })());
check("background resolution: Montreal + Toronto with empty metadata resolve via the registry (the tester-trip case)",
  resolveBackgroundTripTimezone(montrealTrip()).zone === "America/Toronto" &&
  resolveBackgroundTripTimezone(montrealTrip()).source === "destination-registry" &&
  resolveBackgroundTripTimezone(torontoTrip()).zone === "America/Toronto");
check("background resolution: invalid metadata falls through to the registry, never presented",
  resolveBackgroundTripTimezone(montrealTrip({ metadata: { timezone: "Not/AZone" } })).zone === "America/Toronto");
check("background resolution: seed destinations resolve (Halifax, Banff, Manila)",
  resolveBackgroundTripTimezone(montrealTrip({ destination: "Halifax", destination_name: "Halifax" })).zone === "America/Halifax" &&
  resolveBackgroundTripTimezone(montrealTrip({ destination: "Banff", destination_name: "Banff" })).zone === "America/Edmonton" &&
  resolveBackgroundTripTimezone(montrealTrip({ destination: "Manila", destination_name: "Manila" })).zone === "Asia/Manila");

// ---- 2a. Midnight boundary: send times land on the correct destination-local day ----
check("send-time fix: Montreal 9:00 destination-local start is 13:00Z, not the old 09:00Z UTC guess",
  (() => {
    const start = tripStartInstant({ trip: montrealTrip(), confirmedBookings: [] });
    const oldUtcControl = zonedDateTimeToUtc("2026-10-27", 9 * 60, "UTC");
    return start?.start.toISOString() === "2026-10-27T13:00:00.000Z" &&
      start?.timezone === "America/Toronto" && start?.source === "trip_start_date" && !start?.held &&
      oldUtcControl?.toISOString() === "2026-10-27T09:00:00.000Z";
  })());
check("send-time fix: Toronto trip start uses the same destination zone (Nov 10 9:00 EST = 14:00Z, not 09:00Z)",
  (() => {
    const start = tripStartInstant({ trip: torontoTrip(), confirmedBookings: [] });
    return start?.start.toISOString() === "2026-11-10T14:00:00.000Z" && start?.timezone === "America/Toronto";
  })());
check("midnight boundary: a 23:30 EDT reminder is Oct 27 destination-local but Oct 28 in UTC (UTC-day math lands it on the wrong day)",
  (() => {
    const instant = zonedDateTimeToUtc("2026-10-27", 23 * 60 + 30, "America/Toronto");
    return instant?.toISOString() === "2026-10-28T03:30:00.000Z" &&
      localDateInZone(instant, "America/Toronto") === "2026-10-27" &&
      localDateInZone(instant, "UTC") === "2026-10-28";
  })());
check("midnight boundary: a 00:30 EDT reminder is Oct 27 destination-local (not the previous day)",
  (() => {
    const instant = zonedDateTimeToUtc("2026-10-27", 30, "America/Toronto");
    return instant?.toISOString() === "2026-10-27T04:30:00.000Z" &&
      localDateInZone(instant, "America/Toronto") === "2026-10-27";
  })());
check("ADT-viewer contrast (the original bug): 23:30 EDT Oct 27 is Oct 28 00:30 in the viewer's ADT zone but still Oct 27 in the destination zone",
  (() => {
    const instant = new Date("2026-10-28T03:30:00.000Z");
    return localDateInZone(instant, "America/Moncton") === "2026-10-28" &&
      localDateInZone(instant, "America/Toronto") === "2026-10-27";
  })());
check("7-day reminder send time follows the destination zone (trip start minus 7 days, destination-local 9:00)",
  (() => {
    const start = tripStartInstant({ trip: montrealTrip(), confirmedBookings: [] });
    const send = new Date(start.start.getTime() - 7 * 24 * 60 * 60 * 1000);
    return send.toISOString() === "2026-10-20T13:00:00.000Z" &&
      localDateInZone(send, "America/Toronto") === "2026-10-20";
  })());
check("briefing window target follows the destination zone (7d window from a zone-correct trip start)",
  (() => {
    const start = tripStartFromDate("2026-10-27", "America/Toronto");
    const window = preTrip7DayWindow(start, new Date("2026-10-21T00:00:00Z"));
    return start.toISOString() === "2026-10-27T13:00:00.000Z" &&
      window.target.toISOString() === "2026-10-20T13:00:00.000Z" &&
      window.usefulUntil.toISOString() === "2026-10-22T01:00:00.000Z";
  })());
check("confirmed-booking start keeps its absolute instant and its stored zone (gmail-suite case preserved)",
  (() => {
    const trip = montrealTrip({ metadata: { timezone: "America/Toronto" } });
    const flight = { id: "b1", booking_type: "flight", booking_status: "booked", title: "Porter", provider_name: "Porter", confirmation_number: "P1", start_at: "2026-11-10T14:30:00-05:00", end_at: null, check_in_at: null, check_out_at: null, origin: "YUL", destination: "YYZ", flight_number: "PD1", traveler_confirmed: true, updated_at: "2026-08-30T12:00:00Z" };
    const start = tripStartInstant({ trip, confirmedBookings: [flight] });
    return start?.timezone === "America/Toronto" && start?.source === "confirmed_booking" && !start?.held;
  })());

// ---- 2b. DST transitions: no duplicate, no skipped send ----
check("DST spring forward 2026: Mar 7 9:00 Toronto is 14:00Z (EST), Mar 8 9:00 is 13:00Z (EDT)",
  zonedDateTimeToUtc("2026-03-07", 9 * 60, "America/Toronto")?.toISOString() === "2026-03-07T14:00:00.000Z" &&
  zonedDateTimeToUtc("2026-03-08", 9 * 60, "America/Toronto")?.toISOString() === "2026-03-08T13:00:00.000Z");
check("DST fall back 2026: Oct 31 9:00 Toronto is 13:00Z (EDT), Nov 1 9:00 is 14:00Z (EST)",
  zonedDateTimeToUtc("2026-10-31", 9 * 60, "America/Toronto")?.toISOString() === "2026-10-31T13:00:00.000Z" &&
  zonedDateTimeToUtc("2026-11-01", 9 * 60, "America/Toronto")?.toISOString() === "2026-11-01T14:00:00.000Z");
check("DST: daily 9:00-local sends across spring forward are all distinct instants on their own local dates (no duplicate, no skip)",
  (() => {
    const days = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"];
    const instants = days.map((d) => zonedDateTimeToUtc(d, 9 * 60, "America/Toronto").toISOString());
    return new Set(instants).size === 4 &&
      days.every((d, i) => localDateInZone(new Date(instants[i]), "America/Toronto") === d);
  })());
check("DST: daily 9:00-local sends across fall back are all distinct instants on their own local dates (no duplicate, no skip)",
  (() => {
    const days = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
    const instants = days.map((d) => zonedDateTimeToUtc(d, 9 * 60, "America/Toronto").toISOString());
    return new Set(instants).size === 4 &&
      days.every((d, i) => localDateInZone(new Date(instants[i]), "America/Toronto") === d);
  })());
check("DST: 7-day / 1-day due windows track the zone-correct trip start across spring forward",
  (() => {
    const tripStart = new Date("2026-03-08T13:00:00.000Z");
    return duePreTripReminderTypes({ tripStart, now: new Date("2026-03-01T13:00:00Z") }).includes("trip_predeparture_7d") &&
      duePreTripReminderTypes({ tripStart, now: new Date("2026-03-07T13:00:00Z") }).includes("trip_predeparture_1d") &&
      // The old UTC-derived start (Mar 8 09:00Z) would have opened the
      // 7-day window at Mar 1 09:00Z; the zone-correct window opens
      // at 13:00Z, so 10:00Z is still too early.
      !duePreTripReminderTypes({ tripStart, now: new Date("2026-03-01T10:00:00Z") }).includes("trip_predeparture_7d");
  })());

// ---- 2c. Unknown timezones: held, never guessed ----
check("unknown: country alone (Canada) is unknown + held, never inferred",
  (() => {
    const r = resolveBackgroundTripTimezone(montrealTrip({ destination: "Canada", destination_name: "Canada", destination_city: null }));
    return r.zone === null && !r.known && r.held && r.holdReason === BACKGROUND_TIMEZONE_HOLD;
  })());
check("unknown: near-named destination (Montrealville) is unknown + held, never borrows Montreal's zone",
  (() => {
    const r = resolveBackgroundTripTimezone(montrealTrip({ destination: "Montrealville", destination_name: "Montrealville" }));
    return r.zone === null && r.held;
  })());
check("unknown: date-only trip start returns NO instant (no guessed-zone 9:00 exists to schedule)",
  tripStartInstant({ trip: montrealTrip({ destination: "Montrealville", destination_name: "Montrealville" }), confirmedBookings: [] }) === null);
check("unknown: confirmed-booking trip with an unknown zone is flagged held with a null zone (instant retained, scheduling held)",
  (() => {
    const flight = { id: "b1", booking_type: "flight", booking_status: "booked", title: "X", provider_name: "X", confirmation_number: "X", start_at: "2026-11-10T14:30:00-05:00", end_at: null, check_in_at: null, check_out_at: null, origin: null, destination: null, flight_number: null, traveler_confirmed: true, updated_at: null };
    const start = tripStartInstant({ trip: montrealTrip({ destination: "Montrealville", destination_name: "Montrealville" }), confirmedBookings: [flight] });
    return start?.held === true && start?.timezone === null && start?.holdReason === BACKGROUND_TIMEZONE_HOLD;
  })());

// ---- 2d. Duplicate-send prevention: the key is interpretation-independent ----
check("dedupe: reminder version is invariant to the zone reinterpretation (same trip, Montreal vs Toronto destination, empty metadata → same key)",
  (() => {
    const a = preTripReminderVersion({ trip: montrealTrip(), confirmedBookings: [] });
    const b = preTripReminderVersion({ trip: montrealTrip({ destination: "Toronto", destination_name: "Toronto" }), confirmedBookings: [] });
    return a === b && a.length === 24;
  })());
check("dedupe: reminder version still changes when the trip genuinely changes (start date / bookings), so real updates still reschedule",
  (() => {
    const base = preTripReminderVersion({ trip: montrealTrip(), confirmedBookings: [] });
    const moved = preTripReminderVersion({ trip: montrealTrip({ start_date: "2026-10-28" }), confirmedBookings: [] });
    const booked = preTripReminderVersion({ trip: montrealTrip(), confirmedBookings: [{ id: "b1", booking_type: "flight", booking_status: "booked", title: "X", provider_name: "X", confirmation_number: "X", start_at: "2026-10-27T14:30:00-04:00", end_at: null, check_in_at: null, check_out_at: null, origin: null, destination: null, flight_number: null, traveler_confirmed: true, updated_at: null }] });
    return base !== moved && base !== booked;
  })());
check("dedupe: reminder rules unchanged — same types, same 7d/1d cadences",
  (() => {
    const src = read("lib/roamly/preTripReminders.ts");
    return src.includes('"trip_predeparture_7d"') && src.includes('"trip_predeparture_1d"') &&
      src.includes("trip_predeparture_7d: { days: 7") && src.includes("trip_predeparture_1d: { days: 1");
  })());
check("dedupe: scheduleSingleReminder checks the existing event before inserting, and the queue returns deduplicated on a unique-key conflict",
  read("lib/roamly/preTripReminders.ts").includes("reminderEventExists({") &&
  read("lib/roamly/companionNotifications.ts").includes('if (deliveryInsert.error.code === "23505")') &&
  read("lib/roamly/companionNotifications.ts").includes("deduplicated: true"));

// ---- 3. Wiring: every background scheduler uses the shared resolution; no silent UTC remains ----
const schedulers = [
  "lib/roamly/preTripReminders.ts",
  "lib/roamly/preTrip7DayBriefing.ts",
  "lib/roamly/preTrip1DayBriefing.ts",
  "lib/roamly/travelDayBriefing.ts",
  "lib/roamly/dailyTripBriefing.ts",
  "lib/roamly/companionNotifications.ts",
  "lib/roamly/liveCompanionLifecycle.ts",
  "lib/roamly/pushServer.ts",
  "lib/roamly/fyiDigest.ts"
];
check("wiring: all nine background scheduling files import the shared background resolver",
  schedulers.every((f) => read(f).includes("resolveBackgroundTripTimezone")));
check("wiring: no scheduler still computes send times from metadata-only (the one remaining metadata read is the version-identity hash, documented in-file)",
  schedulers.filter((f) => f !== "lib/roamly/preTripReminders.ts").every((f) => !read(f).includes("timezoneFromTripMetadata")) &&
  (read("lib/roamly/preTripReminders.ts").match(/timezoneFromTripMetadata/g) || []).length === 2);
check("wiring: scheduling rows that lacked a destination now resolve through the trip record (destination columns on the selects)",
  read("lib/roamly/companionNotifications.ts").includes("metadata,destination,destination_name,destination_city,itinerary_locked") &&
  read("lib/roamly/pushServer.ts").includes("metadata,destination,destination_name,destination_city") &&
  read("lib/roamly/fyiDigest.ts").includes("destination,destination_name,destination_city,start_date"));
check("wiring: held behavior is explicit in every scheduler (hold code + held record, not a silent skip)",
  read("lib/roamly/preTripReminders.ts").includes("held: true, reason: BACKGROUND_TIMEZONE_HOLD") &&
  read("lib/roamly/preTrip7DayBriefing.ts").includes('suppressed: BACKGROUND_TIMEZONE_HOLD') &&
  read("lib/roamly/preTrip1DayBriefing.ts").includes('suppressed: BACKGROUND_TIMEZONE_HOLD') &&
  read("lib/roamly/travelDayBriefing.ts").includes('suppressed: BACKGROUND_TIMEZONE_HOLD') &&
  read("lib/roamly/dailyTripBriefing.ts").includes('suppressed: BACKGROUND_TIMEZONE_HOLD') &&
  read("lib/roamly/liveCompanionLifecycle.ts").includes('skipped: BACKGROUND_TIMEZONE_HOLD') &&
  read("lib/roamly/companionNotifications.ts").includes('"timezone_unknown_held"') &&
  read("lib/roamly/fyiDigest.ts").includes("heldTrips"));
check("wiring: held claims fail retryable (a later run schedules once the zone is resolvable) — no schedule row is written while held",
  read("lib/roamly/preTrip7DayBriefing.ts").includes("errorCode: BACKGROUND_TIMEZONE_HOLD, retryable: true") &&
  read("lib/roamly/preTrip1DayBriefing.ts").includes("errorCode: BACKGROUND_TIMEZONE_HOLD, retryable: true") &&
  read("lib/roamly/travelDayBriefing.ts").includes("errorCode: BACKGROUND_TIMEZONE_HOLD, retryable: true") &&
  read("lib/roamly/dailyTripBriefing.ts").includes("errorCode: BACKGROUND_TIMEZONE_HOLD, retryable: true"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
