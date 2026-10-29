// roamly-ux-repair-selected-trip-checks.mjs — not-approved repair
// round, Priority 2: SELECTED-TRIP CONSISTENCY. The old divergence
// (Alerts rule-selected Montreal while Live/Itinerary URL-selected
// Toronto on Toronto pages) is closed by ONE resolution:
// resolveSelectedTrip — the URL trip wins when it names an open trip
// of the user, otherwise the established rule
// (active, companion-unlocked, latest start; cancelled/archived
// excluded). The shell badge, the Alerts tab href, and the Alerts
// page all follow it; trip screens were already URL-selected.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-repair-selected-trip-checks.mjs [root]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isOpenNotificationTrip,
  resolveSelectedTrip,
  selectNotificationTrip
} from "@/lib/roamly/notificationTrip.ts";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Fixture clock: 2026-10-26T15:00:00Z — Montreal (Oct 26–30) is the
// active companion-unlocked trip; Toronto (Nov 10–14) is future/gate.
const NOW = new Date("2026-10-26T15:00:00Z");
const MONTREAL = {
  id: "4e5ac222-4ba9-4cb9-ba4b-ce618a03059f", status: "active",
  itinerary_status: "completed", start_date: "2026-10-26", end_date: "2026-10-30",
  tracking_unlocked: true, live_companion_unlocked: true, metadata: null
};
const TORONTO = {
  id: "fd7ed132-3a67-43d5-9cab-754141c14324", status: "active",
  itinerary_status: "completed", start_date: "2026-11-10", end_date: "2026-11-14",
  tracking_unlocked: false, live_companion_unlocked: false, metadata: null
};
const CANCELLED = {
  id: "trip-cancelled", status: "cancelled",
  start_date: "2026-10-26", end_date: "2026-10-30",
  tracking_unlocked: true, live_companion_unlocked: true, metadata: null
};
const ARCHIVED = {
  id: "trip-archived", status: "archived",
  start_date: "2026-10-26", end_date: "2026-10-30",
  tracking_unlocked: true, live_companion_unlocked: true, metadata: null
};
const TRIPS = [TORONTO, MONTREAL, CANCELLED, ARCHIVED];

// ---- Rule unchanged (no URL trip) ----
check("rule: no URL trip → active unlocked Montreal (not future Toronto)",
  resolveSelectedTrip({ trips: TRIPS, now: NOW })?.id === MONTREAL.id);
check("rule: selectNotificationTrip still picks Montreal on its own",
  selectNotificationTrip(TRIPS, NOW)?.id === MONTREAL.id);

// ---- URL trip wins ----
check("url-wins: Toronto URL on a Toronto page selects Toronto (the old divergence, closed)",
  resolveSelectedTrip({ trips: TRIPS, urlTripId: TORONTO.id, now: NOW })?.id === TORONTO.id);
check("url-wins: Montreal URL selects Montreal",
  resolveSelectedTrip({ trips: TRIPS, urlTripId: MONTREAL.id, now: NOW })?.id === MONTREAL.id);

// ---- URL trip that must NOT win ----
check("url-fallback: unknown id falls back to the rule trip, never nothing, never a stranger",
  resolveSelectedTrip({ trips: TRIPS, urlTripId: "no-such-trip", now: NOW })?.id === MONTREAL.id);
check("url-fallback: cancelled URL trip falls back to the rule trip",
  resolveSelectedTrip({ trips: TRIPS, urlTripId: CANCELLED.id, now: NOW })?.id === MONTREAL.id);
check("url-fallback: archived URL trip falls back to the rule trip",
  resolveSelectedTrip({ trips: TRIPS, urlTripId: ARCHIVED.id, now: NOW })?.id === MONTREAL.id);
check("url-fallback: empty URL trip means the rule trip",
  resolveSelectedTrip({ trips: TRIPS, urlTripId: "", now: NOW })?.id === MONTREAL.id);
check("openness: cancelled/archived are never open, active trips are",
  isOpenNotificationTrip(CANCELLED) === false &&
  isOpenNotificationTrip(ARCHIVED) === false &&
  isOpenNotificationTrip(MONTREAL) === true &&
  isOpenNotificationTrip(null) === false);

// ---- Wiring: one resolution in shell + Alerts page, URL selection on trip screens ----
const shell = read("components/AppShellClient.tsx");
const alertsPage = read("app/notifications/page.tsx");
const livePage = read("app/trip/[id]/live/page.tsx");
const tripPage = read("app/trip/[id]/page.tsx");
const countryPage = read("app/trip/[id]/country-info/page.tsx");
const placePage = read("app/trip/[id]/place/[placeId]/page.tsx");
const directionsPage = read("app/trip/[id]/directions/[placeId]/page.tsx");
check("wiring: shell badge resolves via resolveSelectedTrip with the viewed trip's id",
  shell.includes("resolveSelectedTrip({ trips, urlTripId: appSurfaceTripId(pathname) })"));
check("wiring: shell no longer badge-selects by the rule alone (no bare selectNotificationTrip call)",
  !shell.includes("selectNotificationTrip("));
check("wiring: Alerts tab carries ?trip= from the viewed trip (or the Alerts page's own trip)",
  shell.includes("alertsTripId") &&
  shell.includes("`/notifications?trip=${encodeURIComponent(alertsTripId)}`") &&
  shell.includes('pathname === "/notifications" ? activeTripId : ""'));
check("wiring: Alerts page reads ?trip=, checks the open row directly, falls back to the rule",
  alertsPage.includes("searchParams") &&
  alertsPage.includes('requestedTripId') &&
  alertsPage.includes('.eq("id", requestedTripId)') &&
  alertsPage.includes("isOpenNotificationTrip(requestedTrip)") &&
  alertsPage.includes("selectNotificationTrip((tripRows.data || [])"));
check("wiring: Alerts page keeps its own trip on the shell bridge (badge follows the page)",
  alertsPage.includes("NotificationShellStateBridge activeTripId={trip.id}"));
check("wiring: trip screens stay URL-selected (params id, never the rule)",
  livePage.includes("const { id } = await params") &&
  tripPage.includes("const { id } = await params") &&
  countryPage.includes("const { id } = await params") &&
  placePage.includes("const { id, placeId } = await params") &&
  directionsPage.includes("const { id, placeId } = await params") &&
  !livePage.includes("selectNotificationTrip(") &&
  !countryPage.includes("selectNotificationTrip(") &&
  !placePage.includes("selectNotificationTrip(") &&
  !directionsPage.includes("selectNotificationTrip("));

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} repair-selected-trip checks passed.`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
