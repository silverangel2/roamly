// roamly-ux-timezone-checks.mjs — TIMEZONE RELEASE-BLOCKER ROUND
// (2026-10-26, local only). The defect: neither tester trip's metadata
// records a timezone, so every day computation silently fell back to
// UTC and Live showed the NEXT day after 20:00 destination-local time.
// The fix: ONE resolver (lib/roamly/tripTimezone.ts — stored metadata
// first, then the verified destination registry already in this
// codebase) + a visible unknown label instead of a silent fallback.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-timezone-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNKNOWN_TZ_LABEL,
  isValidIanaZone,
  localDateInZone,
  metadataZoneFromMetadata,
  resolveTripTimezone,
  tripDayNumberInZone,
  tripWindowInZone,
  zoneForMath
} from "@/lib/roamly/tripTimezone.ts";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer.ts";
import { resolveSelectedTrip } from "@/lib/roamly/notificationTrip.ts";

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

// ---- 1. Resolution order: stored metadata wins over the registry ----
check("metadata zone wins over registry (stored Montreal trip keeps its own zone)",
  resolveTripTimezone({ metadata: { planning: { timezone: "America/Halifax" } }, destination_name: "Montreal" }).zone === "America/Halifax" &&
  resolveTripTimezone({ metadata: { planning: { timezone: "America/Halifax" } }, destination_name: "Montreal" }).source === "metadata");
check("invalid metadata zone falls through to the registry, never presented",
  resolveTripTimezone({ metadata: { planning: { timezone: "Not/AZone" } }, destination_name: "Montreal" }).zone === "America/Toronto");
check("metadata candidate keys all read (root + planning, both spellings)",
  metadataZoneFromMetadata({ destination_timezone: "Asia/Manila" }) === "Asia/Manila" &&
  metadataZoneFromMetadata({ tripPlanning: { destinationTimezone: "Europe/Paris" } }) === "Europe/Paris" &&
  metadataZoneFromMetadata({ planning: {} }) === null &&
  metadataZoneFromMetadata(null) === null);
check("isValidIanaZone accepts real zones, rejects garbage",
  isValidIanaZone("America/Toronto") && isValidIanaZone("Asia/Manila") && !isValidIanaZone("Not/AZone") && !isValidIanaZone(""));

// ---- 2. Registry: verified destinations, exact match only ----
const registryCases = [
  ["Montreal", "America/Toronto"],
  ["Montreal, Canada", "America/Toronto"],
  ["Toronto", "America/Toronto"],
  ["Toronto, Canada", "America/Toronto"],
  ["Halifax", "America/Halifax"],
  ["Quebec City", "America/Toronto"],
  ["Québec City", "America/Toronto"],
  ["Banff", "America/Edmonton"],
  ["Manila", "Asia/Manila"],
  ["Boracay", "Asia/Manila"],
  ["Paris", "Europe/Paris"]
];
for (const [destination, zone] of registryCases) {
  const resolved = resolveTripTimezoneServer({ metadata: {}, destination_name: destination });
  check(`registry resolves ${destination} → ${zone}`,
    resolved.zone === zone && resolved.source === "destination-registry",
    JSON.stringify(resolved));
}
check("country alone never implies a zone (Canada → unknown, not invented)",
  (() => {
    const r = resolveTripTimezoneServer({ metadata: {}, destination_name: "Canada" });
    return r.zone === null && r.source === "unknown" && !r.known;
  })());
check("unmatched destination stays unknown, never a near-name borrow",
  (() => {
    const r = resolveTripTimezoneServer({ metadata: {}, destination_name: "Montrealville" });
    return r.zone === null && r.source === "unknown";
  })());
check("unknown resolution: zoneForMath is UTC only as the labeled fallback",
  zoneForMath({ zone: null, source: "unknown", known: false }) === "UTC" &&
  UNKNOWN_TZ_LABEL === "Timezone unknown — days shown in UTC");

// ---- 3. The original bug: 20:00–24:00 destination-local must stay Day 1 ----
// Trip Oct 26–30, 2026. 22:30 ADT Oct 26 = 2026-10-27T02:30Z.
check("original bug: 22:30 ADT Oct 26 is Day 1 in America/Toronto",
  tripDayNumberInZone("2026-10-26", 5, "America/Toronto", new Date("2026-10-27T02:30:00Z")) === 1);
check("original bug, control: the same instant in UTC is Day 2 (the old silent fallback)",
  tripDayNumberInZone("2026-10-26", 5, "UTC", new Date("2026-10-27T02:30:00Z")) === 2);
check("evening edge: 23:59 EDT Oct 26 is Day 1; 00:01 EDT Oct 27 is Day 2",
  tripDayNumberInZone("2026-10-26", 5, "America/Toronto", new Date("2026-10-27T03:59:00Z")) === 1 &&
  tripDayNumberInZone("2026-10-26", 5, "America/Toronto", new Date("2026-10-27T04:01:00Z")) === 2);
check("before-midnight local + after-midnight local pair (Day 1 / Day 2)",
  tripDayNumberInZone("2026-10-26", 5, "America/Toronto", new Date("2026-10-27T03:30:00Z")) === 1 &&
  tripDayNumberInZone("2026-10-26", 5, "America/Toronto", new Date("2026-10-27T05:00:00Z")) === 2);
check("zone differing from viewer zone: Toronto day from a Moncton/UTC viewer instant",
  localDateInZone(new Date("2026-10-27T02:30:00Z"), "America/Toronto") === "2026-10-26" &&
  localDateInZone(new Date("2026-10-27T02:30:00Z"), "UTC") === "2026-10-27");
check("window in zone: 22:30 ADT Oct 26 is active, not completed/future",
  tripWindowInZone({ startDate: "2026-10-26", endDate: "2026-10-30", zone: "America/Toronto", now: new Date("2026-10-27T02:30:00Z") }) === "active");

// ---- 4. DST boundaries for America/Toronto: no shift, no duplicate day ----
// Spring forward Mar 8 2026 (02:00 EST → 03:00 EDT). Trip Mar 6–10.
check("DST spring forward: 01:30 EST and 03:30 EDT Mar 8 are both Day 3",
  tripDayNumberInZone("2026-03-06", 5, "America/Toronto", new Date("2026-03-08T06:30:00Z")) === 3 &&
  tripDayNumberInZone("2026-03-06", 5, "America/Toronto", new Date("2026-03-08T07:30:00Z")) === 3);
// Fall back Nov 1 2026 (02:00 EDT → 01:00 EST; 01:30 occurs twice). Trip Oct 30–Nov 3.
check("DST fall back: both 01:30 occurrences Nov 1 are Day 3 (no duplicate)",
  tripDayNumberInZone("2026-10-30", 5, "America/Toronto", new Date("2026-11-01T05:30:00Z")) === 3 &&
  tripDayNumberInZone("2026-10-30", 5, "America/Toronto", new Date("2026-11-01T06:30:00Z")) === 3);
check("DST fall back: 22:30 EST Nov 1 is Day 3, 00:30 EST Nov 2 is Day 4",
  tripDayNumberInZone("2026-10-30", 5, "America/Toronto", new Date("2026-11-02T03:30:00Z")) === 3 &&
  tripDayNumberInZone("2026-10-30", 5, "America/Toronto", new Date("2026-11-02T05:30:00Z")) === 4);

// ---- 5. Wiring: every day surface resolves through the ONE module ----
const livePage = read("app/trip/[id]/live/page.tsx");
const alertsPage = read("app/notifications/page.tsx");
const liveClient = read("components/trip/LiveTripClient.tsx");
const countryModel = read("lib/roamly/countryInfoPanel.ts");
const shell = read("components/AppShellClient.tsx");
check("Live page resolves via the server resolver and passes the unknown flag",
  livePage.includes("resolveTripTimezoneServer") &&
  livePage.includes("tripTimezoneForMath") &&
  livePage.includes("timezoneUnknown={!tripTimezoneResolution.known}") &&
  !livePage.includes("timezoneFromTripMetadata(bundle.data.trip.metadata)"));
check("Live client renders the visible unknown label under the hero",
  liveClient.includes("timezoneUnknown") && liveClient.includes("UNKNOWN_TZ_LABEL"));
check("Alerts page resolves via the server resolver and renders the unknown label",
  alertsPage.includes("resolveTripTimezoneServer") &&
  alertsPage.includes("tripTimezoneUnknown") &&
  alertsPage.includes("UNKNOWN_TZ_LABEL") &&
  !alertsPage.includes("timezoneFromTripMetadata"));
check("Country info reads the same server resolution (one source of truth)",
  countryModel.includes("resolveTripTimezoneServer") &&
  countryModel.includes("formatTripTimezone(countryTimezoneResolution.zone"));
check("notificationTrip window rank resolves via the ONE resolver",
  read("lib/roamly/notificationTrip.ts").includes("resolveTripTimezone"));

// ---- 6. Priority 2: badge beyond the 40-trip window ----
const badgeRoute = read("app/api/roamly/badge/route.ts");
check("badge endpoint exists and fetches the trip directly (no 40-row list)",
  badgeRoute.includes('eq("id", tripId)') &&
  badgeRoute.includes('eq("user_id", auth.user.id)') &&
  !badgeRoute.includes("limit(40)") &&
  badgeRoute.includes("countAlertsBadgeNotifications") &&
  badgeRoute.includes("resolveTripTimezoneServer"));
check("shell fetches the badge endpoint for a viewed trip and returns early",
  shell.includes("/api/roamly/badge?tripId=") &&
  shell.includes("surfaceTripId") &&
  shell.includes("setUnreadCount"));
check("trips list API now carries destination columns for the rule-path gate",
  read("app/api/roamly/trips/route.ts").includes("destination_name"));
check("40-trip edge: URL trip oldest of 41 still wins (fixture)",
  (() => {
    const now = new Date("2026-10-26T15:00:00Z");
    const trips = Array.from({ length: 41 }, (_, i) => ({
      id: `trip-${String(i).padStart(2, "0")}`,
      status: "planned",
      itinerary_status: "locked",
      start_date: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`,
      end_date: "2026-11-30",
      tracking_unlocked: false,
      live_companion_unlocked: false,
      metadata: {},
      destination_name: "Montreal"
    }));
    // Oldest trip (index 40) is the viewed trip; the rule alone would
    // never pick it out of 41 rows, and the old list fetch would never
    // even return it (40-row cap).
    const selected = resolveSelectedTrip({ trips, urlTripId: "trip-40", now });
    return selected?.id === "trip-40";
  })());
check("selected-trip consistency: URL wins Montreal ↔ Toronto both ways",
  (() => {
    const now = new Date("2026-10-26T15:00:00Z");
    const montreal = { id: "montreal", status: "active", itinerary_status: "locked", start_date: "2026-10-26", end_date: "2026-10-30", tracking_unlocked: true, live_companion_unlocked: true, metadata: {}, destination_name: "Montreal" };
    const toronto = { id: "toronto", status: "planned", itinerary_status: "locked", start_date: "2026-11-10", end_date: "2026-11-14", tracking_unlocked: true, live_companion_unlocked: true, metadata: {}, destination_name: "Toronto" };
    return resolveSelectedTrip({ trips: [montreal, toronto], urlTripId: "toronto", now })?.id === "toronto" &&
      resolveSelectedTrip({ trips: [montreal, toronto], urlTripId: "montreal", now })?.id === "montreal";
  })());

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
