import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// Acceptance-review round (2026-10-28, owner-approved): this script
// runs with --experimental-strip-types + the @/ alias register (see
// package.json test:live-companion-clock) so it can import the REAL
// timezone module below instead of re-implementing day math inline.
import {
  UNKNOWN_TZ_LABEL,
  resolveTripTimezone,
  tripDayNumberInZone,
  zoneForMath
} from "@/lib/roamly/tripTimezone.ts";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const delivery = read("lib/roamly/companionNotifications.ts");
const lifecycle = read("lib/roamly/liveCompanionLifecycle.ts");
const itinerary = read("lib/itinerary.ts");
const tripActivation = read("lib/roamly/tripActivation.ts");
const push = read("lib/roamly/pushServer.ts");
const tripTimezoneSrc = read("lib/roamly/tripTimezone.ts");

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
// OLD assertion (removed, owner-approved): assert.match(itinerary,
// /timeZone: timezone/) against protected lib/itinerary.ts, which
// contains 0 occurrences — the timezone logic moved in the timezone
// release-blocker round to lib/roamly/tripTimezone.ts (+ the server
// module). OLD coverage: (a) a timezone is threaded into the day
// computation; (b) destination-local day boundaries (the inline
// dayInZone fixture below). NEW coverage, strictly stronger — it
// pins the REAL module, at runtime, not a regex on its old home:
// (a) the resolver module exposes resolveTripTimezone +
//     tripDayNumberInZone + zoneForMath and the server module
//     exposes resolveTripTimezoneServer; (b) stored metadata wins
//     over the registry; (c) an unresolvable trip resolves to
//     zone null / source "unknown" / known false — never a silent
//     zone — with the explicit fallback label
//     "Timezone unknown — days shown in UTC" and UTC used for math
//     ONLY through zoneForMath (the labeled fallback); (d) the
//     destination-local day boundary, computed by the real module
//     (Tokyo: 15:30Z on day 1's date is already day 2 locally,
//     00:30Z is still day 1). The protected file's own day-function
//     guard below is RETAINED unchanged, as is every other assertion
//     in this file — only the stale regex and its inline day-math
//     reimplementation are replaced.
assert.match(tripTimezoneSrc, /export function resolveTripTimezone/);
assert.match(tripTimezoneSrc, /export function tripDayNumberInZone/);
assert.match(tripTimezoneSrc, /export function zoneForMath/);
assert.match(tripTimezoneSrc, /UNKNOWN_TZ_LABEL/);
assert.equal(UNKNOWN_TZ_LABEL, "Timezone unknown — days shown in UTC");
assert.equal(resolveTripTimezone({ metadata: { planning: { timezone: "America/Toronto" } }, destination_name: "Montreal" }).zone, "America/Toronto");
assert.equal(resolveTripTimezone({ metadata: { planning: { timezone: "America/Toronto" } }, destination_name: "Montreal" }).source, "metadata");
assert.deepEqual(resolveTripTimezone({ metadata: {}, destination_name: "Nowhereville" }), { zone: null, source: "unknown", known: false });
assert.equal(zoneForMath({ zone: null, source: "unknown", known: false }), "UTC");
assert.equal(resolveTripTimezoneServer({ destination_name: "Montreal" }).zone, "America/Toronto");
assert.equal(tripDayNumberInZone("2026-09-07", 5, "Asia/Tokyo", "2026-09-07T15:30:00Z"), 2, "destination-local Tuesday wins over server Monday");
assert.equal(tripDayNumberInZone("2026-09-07", 5, "Asia/Tokyo", "2026-09-07T00:30:00Z"), 1, "destination-local Monday remains day one");
const dayFunction = itinerary.slice(itinerary.indexOf("export function getTripDayFromDate"));
assert.doesNotMatch(dayFunction, /new Date\(`\$\{startDate\}T00:00:00`\)/);
assert.match(tripActivation, /getTripDayFromDate\([^\n]*timezoneFromTripMetadata/);
assert.match(push, /roamly-activity-\$\{securedPayload\.tripId\}/);

// (Inline dayInZone reimplementation removed with the stale regex:
// the same two boundary cases now run through the real module,
// tripDayNumberInZone, in the assertions above.)

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
