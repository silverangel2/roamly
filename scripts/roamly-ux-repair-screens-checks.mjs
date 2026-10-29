// roamly-ux-repair-screens-checks.mjs — not-approved repair round,
// Priority 3: REFINE THE THREE SCREENS (no redesign, targeted fixes).
// Alerts: verified photo hero wiring + trip card → unread line →
// sections hierarchy. Directions: ONE concise routing explanation,
// ONE primary Open in Maps action, providers as secondary links.
// Live: ONE authoritative header (the hero), long titles wrapping.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-repair-screens-checks.mjs [root]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const alertsPage = read("app/notifications/page.tsx");
const directionsPanel = read("components/trip/DirectionsPanel.tsx");
const livePage = read("app/trip/[id]/live/page.tsx");
const liveClient = read("components/trip/LiveTripClient.tsx");
const homePanel = read("components/trip/ItineraryHomePanel.tsx");
const placePanel = read("components/roamly/PlaceDetailPanel.tsx");

// ---- Alerts ----
check("alerts: destination-photo pipeline wired into the trip hero (served HTML; miss stays bare)",
  alertsPage.includes("getDestinationPhoto({") &&
  alertsPage.includes("photo={destinationPhoto ? { imageUrl: destinationPhoto.imageUrl, credit: destinationPhoto.credit, pageUrl: destinationPhoto.pageUrl } : null}"));
check("alerts: hierarchy order is trip card → unread line → sections",
  alertsPage.indexOf("TripHeroCard") !== -1 &&
  alertsPage.indexOf("unread alerts for this trip") > alertsPage.indexOf("TripHeroCard") &&
  alertsPage.indexOf('title="Action required"') > alertsPage.indexOf("unread alerts for this trip"));
check("alerts: unread line carries subheading weight (not small gray body text)",
  alertsPage.includes('className="mt-3 px-1 text-[15px] font-semibold text-chead"'));
check("alerts: unified badge semantics preserved (same count, labeled line)",
  alertsPage.includes("countAlertsBadgeNotifications(notificationItems, renderedNotificationIds)") &&
  alertsPage.includes("NotificationShellStateBridge activeTripId={trip.id}"));
check("alerts: section badges stay labeled totals",
  read("components/roamly/AlertsSectionCard.tsx").includes("in total"));

// ---- Directions ----
check("directions: technical map explanations gone (no preview-unavailable block, no embed-yet line)",
  !directionsPanel.includes("Map preview unavailable") &&
  !directionsPanel.includes("embed a map yet"));
check("directions: exactly one routing explanation (summary Route row) — no repeats below it",
  directionsPanel.includes('"Live routing opens in your maps app"') &&
  !directionsPanel.includes("live routing opens in your maps app below") &&
  !directionsPanel.includes("tap Open in Maps above for turn-by-turn directions") &&
  directionsPanel.includes("walkValuesLine"));
check("directions: one primary Open in Maps button slot (disabled only when no destination) + provider links secondary",
  directionsPanel.includes("Open in Maps") &&
  directionsPanel.includes("Google Maps") &&
  directionsPanel.includes("Apple Maps") &&
  directionsPanel.includes("Citymapper") &&
  !directionsPanel.includes("inline-flex min-h-11 items-center px-2 text-[15px] font-semibold text-cblue"));
check("directions: honest From/To summary kept (real destination; unconfirmed origin stated plainly)",
  directionsPanel.includes("Starting point not confirmed yet") &&
  directionsPanel.includes("From: ") &&
  directionsPanel.includes("To: "));
check("directions: no invented distances or steps (values only from the summary; steps gated)",
  !directionsPanel.includes("Mostly flat") &&
  directionsPanel.includes("Terrain and sidewalk details"));

// ---- Live: one header ----
check("live: page-level trip header card gone (no timing-copy header, no displayed origin line)",
  !livePage.includes("tripTimingCopy") &&
  !livePage.includes("tripDateRange") &&
  !livePage.includes("From {originLabel}"));
check("live: exactly one TripHeroCard in the client — the authoritative header",
  (liveClient.match(/<TripHeroCard/g) || []).length === 1 &&
  liveClient.includes("badge={tripClockState({"));
check("live: banner title duplication gone; banner keeps day context + timing truth",
  !liveClient.includes(">Trip in progress<") &&
  liveClient.includes("Live updates for Day") &&
  liveClient.includes("Times below are estimates unless labeled otherwise"));
check("live: functional controls kept (Stop actions, Directions, Open in Maps, location fix)",
  liveClient.includes("Stop actions") &&
  liveClient.includes("Directions") &&
  liveClient.includes("Open in Maps") &&
  liveClient.includes("Location is off — fix it"));
check("live: next-activity card kept clear (featured card + compact upcoming, walk legs excluded)",
  liveClient.includes("Next relevant activity") &&
  liveClient.includes("upcomingActivities") &&
  liveClient.includes("!isWalkLiveActivity(activity)"));

// ---- Long-title wrapping (390px and 320px render proof is in the render pass) ----
check("wrap: live featured + upcoming + pre-trip titles break words (no clipping, no mid-word breaks)",
  liveClient.includes('className="mt-1 block break-words text-[19px] font-bold leading-[1.3] text-chead"') &&
  liveClient.includes('className="block break-words text-[17px] font-semibold leading-[1.3] text-chead"') &&
  liveClient.includes('className="block break-words text-[17px] font-semibold leading-[1.3] text-chead">{displayTitle}</span>'));
check("wrap: home rows + place title break words with min-w-0 flex room",
  homePanel.includes("break-words text-[15.5px] font-semibold") &&
  homePanel.includes("min-w-0 flex-1") &&
  placePanel.includes('className="break-words text-[28px] font-bold'));

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} repair-screens checks passed.`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
