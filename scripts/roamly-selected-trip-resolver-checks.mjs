// roamly-selected-trip-resolver-checks.mjs — Lane N, release-
// candidate round 2: ONE selected-trip resolver (F4 / audit N5).
// Before this round three "current trip" rules coexisted — the
// route-param rule (trip/Live pages), the companion-active rule
// (/api/roamly/trips/active, which alone drove the tab bar's hrefs),
// and the notification selected-trip rule (Alerts page + badge) —
// and the round-1 render captured the result: Alerts showed a
// Halifax trip while the bar's Itinerary/Live fell back to
// /dashboard. lib/roamly/selectedTrip.ts now resolves ONE trip for
// the bar, the Alerts page, and (via its route param) the itinerary
// and Live surfaces. These checks pin the priority order and the
// bar/Alerts agreement across representative account states.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-selected-trip-resolver-checks.mjs [root]
// TZ-safety: every window-sensitive fixture carries an explicit UTC
// trip timezone in metadata, and `now` is injected — no assertion
// depends on the process timezone.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectActiveTrip } from "@/lib/roamly/liveCompanion.ts";
import {
  resolveRoamlySelectedTrip,
  selectedTripBarHrefs
} from "@/lib/roamly/selectedTrip.ts";

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

// Fixture clock: 2026-10-30T15:00:00Z.
const NOW = new Date("2026-10-30T15:00:00Z");
const TZ = { planning: { timezone: "UTC" } };
const trip = (patch) => ({
  status: "active",
  itinerary_status: "completed",
  tracking_unlocked: false,
  live_companion_unlocked: false,
  itinerary_locked: false,
  itinerary_generated_at: null,
  metadata: TZ,
  ...patch
});

// --- Scenario A: multiple trips, one live (in its window, locked,
// companion-unlocked) — the F4 shape. Halifax is live Oct 29–Nov 1;
// Montreal is a future trip; Toronto is a completed trip.
const HALIFAX = trip({
  id: "trip-halifax", start_date: "2026-10-29", end_date: "2026-11-01",
  tracking_unlocked: true, live_companion_unlocked: true, itinerary_locked: true
});
const MONTREAL = trip({ id: "trip-montreal", start_date: "2026-11-10", end_date: "2026-11-14" });
const TORONTO_DONE = trip({
  id: "trip-toronto-done", start_date: "2026-10-01", end_date: "2026-10-05",
  tracking_unlocked: true, itinerary_locked: true
});
const CANCELLED = trip({ id: "trip-cancelled", status: "cancelled", start_date: "2026-10-29", end_date: "2026-11-01", tracking_unlocked: true, itinerary_locked: true });
const TRIPS_A = [MONTREAL, TORONTO_DONE, HALIFAX, CANCELLED];
// The companion id exactly as both real consumers obtain it: the
// shell from /api/roamly/trips/active, the Alerts page from
// getActiveOrUpcomingTrip — both are selectActiveTrip over the
// locked+unlocked set.
const companionIdA = selectActiveTrip(TRIPS_A.filter((t) => t.itinerary_locked && (t.tracking_unlocked || t.live_companion_unlocked)), NOW)?.id;

check("A setup: companion rule alone sees only the live Halifax trip", companionIdA === HALIFAX.id);

const shellA = resolveRoamlySelectedTrip({ trips: TRIPS_A, companionTripId: companionIdA, now: NOW });
const alertsA = resolveRoamlySelectedTrip({ trips: TRIPS_A, routeTripId: null, companionTripId: companionIdA, now: NOW });
check("A: bar resolves the live trip (no /dashboard fallback while a trip is live)",
  shellA.tripId === HALIFAX.id && shellA.source === "companion");
check("A: Alerts resolves the SAME trip as the bar from the same inputs",
  alertsA.tripId === shellA.tripId);
check("A: companion computed from the list (id omitted) agrees with the server companion id",
  resolveRoamlySelectedTrip({ trips: TRIPS_A, now: NOW }).tripId === HALIFAX.id);
check("A: bar hrefs point Itinerary/Live at the resolved trip",
  selectedTripBarHrefs(shellA).itineraryHref === `/trip/${HALIFAX.id}` &&
  selectedTripBarHrefs(shellA).liveHref === `/trip/${HALIFAX.id}/live`);
check("A: on /notifications the page's own trip (bridge input) keeps the bar on that trip",
  resolveRoamlySelectedTrip({ trips: TRIPS_A, companionTripId: companionIdA, pageTripId: alertsA.tripId, now: NOW }).tripId === alertsA.tripId);

// Route param beats everything, on both derivations.
const routeMontrealShell = resolveRoamlySelectedTrip({ trips: TRIPS_A, routeTripId: MONTREAL.id, companionTripId: companionIdA, now: NOW });
const routeMontrealAlerts = resolveRoamlySelectedTrip({ trips: TRIPS_A, routeTripId: MONTREAL.id, companionTripId: companionIdA, now: NOW });
check("A: route param wins over the companion trip (bar and Alerts agree)",
  routeMontrealShell.tripId === MONTREAL.id && routeMontrealShell.source === "route" && routeMontrealAlerts.tripId === MONTREAL.id);
check("A: cancelled route param never wins — falls to the companion trip",
  resolveRoamlySelectedTrip({ trips: TRIPS_A, routeTripId: CANCELLED.id, companionTripId: companionIdA, now: NOW }).tripId === HALIFAX.id);
check("A: unknown route param never wins — falls to the companion trip",
  resolveRoamlySelectedTrip({ trips: TRIPS_A, routeTripId: "no-such-trip", companionTripId: companionIdA, now: NOW }).tripId === HALIFAX.id);
check("A: open route trip outside the list window wins via its direct row (Alerts server path)",
  resolveRoamlySelectedTrip({ trips: [MONTREAL], routeTripId: HALIFAX.id, routeTrip: HALIFAX, companionTripId: companionIdA, now: NOW }).tripId === HALIFAX.id);
check("A: cancelled direct row does NOT win via the route step",
  resolveRoamlySelectedTrip({ trips: TRIPS_A, routeTripId: CANCELLED.id, routeTrip: CANCELLED, companionTripId: companionIdA, now: NOW }).tripId === HALIFAX.id);

// --- Scenario B: multiple trips, none live. The rule step picks
// the soonest upcoming open trip, identically for bar and Alerts.
const FUTURE_SOON = trip({ id: "trip-future-soon", status: "planned", start_date: "2026-11-05", end_date: "2026-11-09" });
const FUTURE_LATE = trip({ id: "trip-future-late", status: "planned", start_date: "2026-11-20", end_date: "2026-11-24" });
const PAST = trip({ id: "trip-past", start_date: "2026-09-01", end_date: "2026-09-05" });
const TRIPS_B = [FUTURE_LATE, PAST, FUTURE_SOON];
const shellB = resolveRoamlySelectedTrip({ trips: TRIPS_B, companionTripId: null, now: NOW });
const alertsB = resolveRoamlySelectedTrip({ trips: TRIPS_B, routeTripId: null, companionTripId: null, now: NOW });
check("B: no live trip → rule step picks the soonest upcoming trip",
  shellB.tripId === FUTURE_SOON.id && shellB.source === "rule");
check("B: Alerts and bar agree with no live trip", alertsB.tripId === shellB.tripId);
check("B: a stale page/bridge id not in the list cannot resurrect a trip",
  resolveRoamlySelectedTrip({ trips: TRIPS_B, companionTripId: null, pageTripId: "trip-vanished", now: NOW }).tripId === FUTURE_SOON.id);
check("B: page step yields the page's open trip when no route/companion trip exists",
  resolveRoamlySelectedTrip({ trips: TRIPS_B, companionTripId: null, pageTripId: PAST.id, now: NOW }).tripId === PAST.id);

// --- Scenario C: single trip.
const SOLO = trip({ id: "trip-solo", start_date: "2026-12-01", end_date: "2026-12-04" });
check("C: single future trip resolves to that trip for both surfaces",
  resolveRoamlySelectedTrip({ trips: [SOLO], companionTripId: null, now: NOW }).tripId === SOLO.id &&
  resolveRoamlySelectedTrip({ trips: [SOLO], routeTripId: null, companionTripId: null, now: NOW }).tripId === SOLO.id);
const SOLO_LIVE = trip({
  id: "trip-solo-live", start_date: "2026-10-29", end_date: "2026-11-02",
  tracking_unlocked: true, itinerary_locked: true
});
check("C: single live trip resolves via the companion step",
  resolveRoamlySelectedTrip({ trips: [SOLO_LIVE], now: NOW }).tripId === SOLO_LIVE.id);

// --- Scenario D: no trips (and no OPEN trips) → "none"; /dashboard
// is the bar's fallback ONLY here.
const noneEmpty = resolveRoamlySelectedTrip({ trips: [], companionTripId: null, now: NOW });
const noneCancelled = resolveRoamlySelectedTrip({ trips: [CANCELLED], companionTripId: null, now: NOW });
check("D: no trips → null trip, source none",
  noneEmpty.trip === null && noneEmpty.tripId === "" && noneEmpty.source === "none");
check("D: only cancelled trips → none (cancelled is never selected)",
  noneCancelled.trip === null && noneCancelled.source === "none");
check("D: /dashboard bar fallback ONLY when the resolution is none",
  selectedTripBarHrefs(noneEmpty).itineraryHref === "/dashboard" &&
  selectedTripBarHrefs(noneEmpty).liveHref === "/dashboard" &&
  selectedTripBarHrefs(shellB).itineraryHref !== "/dashboard");

// --- Determinism: same inputs, same id, regardless of list order.
check("determinism: list order does not change the resolved trip",
  resolveRoamlySelectedTrip({ trips: [...TRIPS_A].reverse(), companionTripId: companionIdA, now: NOW }).tripId === HALIFAX.id &&
  resolveRoamlySelectedTrip({ trips: [...TRIPS_B].reverse(), companionTripId: null, now: NOW }).tripId === FUTURE_SOON.id);

// --- Wiring: the consumers actually use the ONE resolver.
const shell = read("components/AppShellClient.tsx");
const alertsPage = read("app/notifications/page.tsx");
const tripPage = read("app/trip/[id]/page.tsx");
const livePage = read("app/trip/[id]/live/page.tsx");
const pkg = read("package.json");
check("wiring: shell imports and calls the shared resolver with the route param",
  shell.includes('import { resolveRoamlySelectedTrip } from "@/lib/roamly/selectedTrip"') &&
  shell.includes("resolveRoamlySelectedTrip({") &&
  shell.includes("routeTripId: appSurfaceTripId(pathname)"));
check("wiring: shell badge still resolves via the pinned resolveSelectedTrip call",
  shell.includes("resolveSelectedTrip({ trips, urlTripId: appSurfaceTripId(pathname) })"));
check("wiring: shell loads the trip list on /notifications too (fresh-load bridge race closed)",
  shell.includes('pathname === "/notifications") void loadBarTrips()') &&
  shell.includes("pageTripBridgeSeen"));
check("wiring: Alerts page resolves via the shared resolver with the same companion source as the shell",
  alertsPage.includes("resolveRoamlySelectedTrip({") &&
  alertsPage.includes("getActiveOrUpcomingTrip") &&
  alertsPage.includes("companionTripId: companionTripResult.trip?.id ?? null") &&
  alertsPage.includes("NotificationShellStateBridge activeTripId={trip.id}"));
check("wiring: trip and Live pages stay the route-param source (params id, no rule selection)",
  tripPage.includes("const { id } = await params") &&
  livePage.includes("const { id } = await params") &&
  !tripPage.includes("selectNotificationTrip(") &&
  !livePage.includes("selectNotificationTrip("));
check("wiring F1: /finds renders the app tab bar for signed-in travelers (same gate shape as /plan)",
  shell.includes("function isFindsSurface(pathname: string)") &&
  shell.includes('(authenticated && pathname === "/plan") || (authenticated && isFindsSurface(pathname))') &&
  shell.includes('aria-label="Mobile navigation"'));
check("wiring F2: bookings surfaces mark the owning trip's Itinerary tab active",
  shell.includes("bookings(\\/|$)"));
check("wiring: package.json wires this suite as test:trip-resolver",
  pkg.includes('"test:trip-resolver"'));

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} selected-trip resolver checks passed.`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
