// roamly-ux-picture4-live-checks.mjs — Picture 4 (Live Companion) proof.
// Static source checks over components/trip/LiveTripClient.tsx +
// lib/roamly/liveDayTimeline.ts + the live page's wiring, plus a
// runtime fixture over buildDayTimelineRows. The picture is
// correct-4-pages.jpg, BOTTOM-RIGHT panel, read from an enlarged crop:
// back chevron · centered "Live Companion" · gear · trip hero card
// (photo, destination, dates · Day N of M, green trip-state pill) ·
// tabs Today / Full Itinerary / Map / Essentials · pre-trip banner
// (plane icon, "Trip hasn't started yet") · bold Day heading +
// subtitle · timeline rows (time · icon · title · detail · chevron,
// Planned pill under a travel title) · Directions + Open in Maps
// buttons, and the content ENDS there (closed state).
// Usage: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-picture4-live-checks.mjs [treeRoot]
// Exit 0 only when every check passes.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDayTimelineRows, coerceDayTimelineItem } from "@/lib/roamly/liveDayTimeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, ".."));
const client = readFileSync(join(root, "components/trip/LiveTripClient.tsx"), "utf8");
const timelineLib = readFileSync(join(root, "lib/roamly/liveDayTimeline.ts"), "utf8");
const page = readFileSync(join(root, "app/trip/[id]/live/page.tsx"), "utf8");
// Rendered code only for sample/JSX checks: header comments quote the
// picture's structure as documentation, never as rendered values.
const code = client.replace(/\/\*[\s\S]*?\*\//g, "");
const stripJsxComments = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const codeNoJsxComments = stripJsxComments(code);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const idx = (src, needle, from = 0) => src.indexOf(needle, from);
const ordered = (src, needles) => {
  let prev = -1;
  for (const needle of needles) {
    const at = src.indexOf(needle, prev + 1);
    if (at === -1 || at < prev) return false;
    prev = at;
  }
  return true;
};
// The pre-trip branch: from its opening to the tripCompleted branch.
const preStart = code.indexOf("{preTrip ? (");
const preEnd = code.indexOf(": tripCompleted ? (", preStart);
const preTrip = preStart !== -1 && preEnd !== -1 ? code.slice(preStart, preEnd) : "";
// The in-progress branch: from the tripCompleted branch to the
// field-test-only setup section (a code anchor, not a comment —
// comments are stripped from `code` above).
const inStart = code.indexOf(": tripCompleted ? (", preStart);
const inEnd = code.indexOf("fieldTestMode && showSetupCard", inStart);
const inProgress = inStart !== -1 && inEnd !== -1 ? code.slice(inStart, inEnd) : "";
// The Map tab slice.
const mapStart = code.indexOf('liveTab === "map"');
const mapEnd = code.indexOf('liveTab === "essentials"', mapStart);
const mapTab = mapStart !== -1 && mapEnd !== -1 ? code.slice(mapStart, mapEnd) : "";
// The Essentials tab slice.
const essStart = code.indexOf('liveTab === "essentials"');
const essTab = essStart !== -1 ? code.slice(essStart) : "";

// --- 1. Header: back chevron · centered title · gear, in order ---
check(
  "header-back-title-gear-order",
  ordered(code, [
    'aria-label="Back to trip"',
    ">Live Companion</h1>",
    'href="/account"',
    'aria-label="Settings"'
  ])
);
// --- 2. Hero card wiring: real destination/dates/day/badge/photo ---
check(
  "hero-real-data-wiring",
  code.includes("<TripHeroCard") &&
    code.includes("destination={activeDestinationLabel") &&
    code.includes("dateLine={formatTripDateRange(activeTripStartDate, activeTripEndDate)}") &&
    code.includes("Day ${eyebrowDay.idx} of ${eyebrowDay.total}") &&
    code.includes("tripClockState({") &&
    code.includes("photo={heroPhoto}")
);
// --- 3. Tabs in the picture's order, Today active blue underline ---
check(
  "tabs-order-today-first",
  ordered(code, ['["today", "Today"]', '["itinerary", "Full Itinerary"]', '["map", "Map"]', '["essentials", "Essentials"]']) &&
    code.includes('liveTab === key ? "border-cblue text-cblue"')
);
// --- 4. Pre-trip banner copy (dynamic day/date, never sample values) ---
check(
  "pretrip-banner-copy",
  preTrip.includes("Trip hasn") &&
    preTrip.includes("These are your planned activities for Day {eyebrowDay?.idx || 1}") &&
    preTrip.includes("You&apos;ll get real-time updates when the trip begins.")
);
// --- 5. Day heading is a bold h2 (picture), not the old small-caps label ---
check(
  "day-heading-bold-h2",
  preTrip.includes("<h2") &&
    preTrip.includes("Day {eyebrowDay?.idx || 1}") &&
    !preTrip.includes('text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">\n            Day {eyebrowDay') &&
    preTrip.includes("{dayPlanTitle ? (")
);
// --- 6. Pre-trip order: banner -> heading -> timeline -> buttons ---
check(
  "pretrip-order-banner-heading-timeline-buttons",
  ordered(preTrip, [
    "Trip hasn",
    "Day {eyebrowDay?.idx || 1}",
    "dayTimelineRows.map",
    "Directions",
    "Open in Maps"
  ])
);
// --- 7. Timeline rows: time · icon · title · Planned pill · detail · chevron ---
check(
  "pretrip-row-shape",
  // Conditional-acceptance item 1: the time column is now a stacked
  // time + provenance label (flex-col), not a bare time span — the
  // shape assertion follows the column, everything else unchanged.
  preTrip.includes('className="flex w-[88px] shrink-0 flex-col') &&
    preTrip.includes("TimeProvenanceLabel kind={provenanceForPreTripRow(row.planned)}") &&
    preTrip.includes("timelineIcon({ kind: row.kind") &&
    preTrip.includes("{row.title}") &&
    preTrip.includes(">Planned</span>") &&
    preTrip.includes("{row.detail}") &&
    preTrip.includes("{rowChevron}") &&
    preTrip.includes("border-dotted")
);
check(
  "pretrip-planned-pill-under-title-before-detail",
  // Owner-10 item 5: rows render through displayTitle/displayDetail
  // (unverified mapping + echo strip); the order asserted is the
  // same — title, then Planned pill, then detail.
  ordered(preTrip, ["{displayTitle}", ">Planned</span>", "{displayDetail}"])
);
check(
  "pretrip-timeline-uses-stored-rows-only",
  preTrip.includes("dayTimelineRows.length") && !preTrip.includes("buildDayTimelineRows(")
);
// --- 8. Pre-trip branch ends at the buttons: no actions, panel, or legacy block ---
check(
  "pretrip-ends-at-buttons",
  preTrip.length > 0 &&
    !preTrip.includes("runAction") &&
    !preTrip.includes("<DirectionsPanel") &&
    !preTrip.includes("showDirectionsPanel ? (") &&
    !preTrip.includes("LocationPermissionRecovery") &&
    !preTrip.includes("Pause Companion") &&
    !preTrip.includes("QRCodeSVG") &&
    !preTrip.includes("Continue on your phone")
);
// --- 9. Buttons: Directions toggles the picture-7 panel; Open in Maps is the real link ---
check(
  "buttons-directions-panel-open-in-maps",
  code.includes("hasDirectionLinks && directionsHref") &&
    code.includes('aria-label="Getting to your next stop"') &&
    code.includes("setShowDirectionsPanel((value) => !value)") &&
    code.includes("href={mapsHref}") &&
    code.includes("Open in Maps")
);
check(
  "panel-mount-next-stop-only",
  code.includes("DirectionsPanel") &&
    code.includes("location={usableLocation}") &&
    code.includes("liveRoute={model.route}") &&
    code.includes("steps={null}") &&
    code.includes("routeEvidence={null}") &&
    code.includes("showDirectionsPanel")
);
// --- 10. In-progress (owner-10 item 6): live banner + ONE featured card
// + compact upcoming list (walk legs excluded) + NOW / UP NEXT + actions
// behind the featured card + compact location recovery. The full
// walk-inserted timeline lives on the Full Itinerary tab, not here.
check(
  "inprogress-banner",
  // Repair round P1+P3: the banner states the corrected timing truth
  // (estimates unless labeled otherwise; Live-updated only with fresh
  // evidence; Confirmed only for a verified booking), and its old
  // "Trip in progress" title is gone — the hero badge above already
  // carries the trip state, so the banner keeps day context only.
  inProgress.includes("Live updates for Day") &&
    inProgress.includes("Times below are estimates unless labeled otherwise") &&
    inProgress.includes("Live-updated only with a fresh location fix or check-in") &&
    inProgress.includes("Confirmed only for a verified booking") &&
    inProgress.includes("Check in as you go.") &&
    !inProgress.includes(">Trip in progress<")
);
check(
  "single-live-header-hero-carries-state",
  code.includes("TripHeroCard") &&
    code.includes("tripClockState({") &&
    code.includes("badge")
);
check(
  "inprogress-featured-and-upcoming",
  inProgress.includes("featuredActivity") &&
    inProgress.includes("Next relevant activity") &&
    inProgress.includes("featuredPill") &&
    inProgress.includes("upcomingActivities.map") &&
    inProgress.includes("Up next") &&
    inProgress.includes("remainingToday[0]?.id") &&
    // The Now/Up-next ternaries live in the featuredPill const at
    // component scope (outside this branch slice), not in the JSX.
    code.includes('? "Now"') &&
    code.includes('? "Up next"') &&
    code.includes("todayActivities.filter(") &&
    code.includes("!isWalkLiveActivity(activity)")
);
check(
  "inprogress-actions-guarded",
  inProgress.includes("!tripCompleted ? <section") &&
    inProgress.includes("currentActivity && !tripCompleted") &&
    inProgress.includes("Stop actions") &&
    inProgress.includes("<details") &&
    inProgress.includes('t("ui.actions.checkIn")') &&
    inProgress.includes("Complete") &&
    inProgress.includes("Skip this activity") &&
    inProgress.includes('? "Review the plan and confirm anything still suggested."')
);
check(
  "inprogress-location-recovery-kept",
  inProgress.includes("LocationPermissionRecovery") &&
    inProgress.includes("recheckLocationPermission") &&
    inProgress.includes("Location is off") &&
    inProgress.includes("Location is off — fix it")
);
// --- 11. Removals from the customer screen ---
check(
  "removed-pause-companion",
  !codeNoJsxComments.includes("Pause Companion") && !codeNoJsxComments.includes("Resume Companion")
);
check(
  "removed-now-card-and-upnext-list",
  !code.includes("Get ready") && !code.includes(">Up Next<") && !code.includes("id=\"live-directions\"")
);
check(
  "removed-alerts-feed-from-today",
  !code.includes("feedAlerts")
);
check(
  "setup-qr-card-field-test-only",
  code.includes("fieldTestMode && showSetupCard ? (") &&
    code.includes("Continue on your phone") &&
    code.includes("<QRCodeSVG")
);
check(
  "footer-line-field-test-only",
  code.includes("{fieldTestMode ? (") && code.includes("Roamly is following along")
);
// --- 12. Map tab: honest unavailable state, never a fake map ---
// Correction phase (D6, 2026-10-28): Map-tab links now route through
// mapDirectionsHref/mapMapsHref (live links when present, else the
// itinerary fallback's first stop) — the old direct directionsHref /
// mapsHref names are gone from this tab (they still feed the Today
// tab's next-stop buttons). The honest-unavailable intent is
// unchanged: no in-app map, no static map images, links out only.
check(
  "map-tab-unavailable-state",
  mapTab.includes("An in-app map is not available for this trip yet") &&
    mapTab.includes("no map component exists in the app") &&
    !mapTab.includes("<img") &&
    !mapTab.includes("staticmap") &&
    !mapTab.includes("tile.openstreetmap") &&
    mapTab.includes("href={mapDirectionsHref}") &&
    mapTab.includes("href={mapMapsHref}")
);
// --- 13. Essentials tab: real checklist data ---
check(
  "essentials-tab-real-data",
  essTab.includes("Essentials · {essentialsDone} of {checklist.length}") &&
    essTab.includes("checklist.map") &&
    essTab.includes("No essentials for this trip yet.")
);
// --- 14. Full Itinerary tab: full stored plan, all days ---
check(
  "itinerary-tab-full-plan",
  code.includes("itineraryDays.map") &&
    code.includes("Day {day.dayNumber}") &&
    code.includes("See the full itinerary")
);
// --- 15. No picture sample values rendered by the client ---
check(
  "no-picture-sample-values",
  !/Musée du marché|Galerie Blanche|Resto Végo|Théâtre Jean-Duceppe|Travel from Saint John to Montreal|Get to hotel and drop luggage|Historic market and local shops|Contemporary art|Vegetarian restaurant|Evening show|Day 1 of 5|Trip in 3 days/.test(codeNoJsxComments)
);
// --- 16. Timeline lib carries the category for the row icon ---
check(
  "timeline-row-carries-category",
  timelineLib.includes("category: string | null") &&
    timelineLib.includes("category: cleanText(item.category)")
);
// --- 17. Page wiring: stored plan rows + itinerary days + day title + hero photo ---
check(
  "page-wiring-live-props",
  page.includes("dayTimelineRows={dayTimelineRows}") &&
    page.includes("itineraryDays={itineraryDays}") &&
    page.includes("dayPlanTitle={dayPlanTitle}") &&
    page.includes("heroPhoto={destinationPhoto")
);
// --- 18. Runtime fixture: stored seeds -> picture-shaped rows, verbatim times ---
{
  const seeds = [
    { time_label: "8:00 AM", title: "Flight to Montreal", item_type: "travel", travel_mode: "Flight", travelTimeMinutes: 105, origin: "Saint John", destination: "Montreal", timing_status: "PLANNED" },
    { time_label: "10:30 AM", title: "Arrive in Montreal", description: "Get to the hotel and drop luggage.", timing_status: "PLANNED" },
    { time_label: "1:00 PM", title: "Test Market Hall", category: "museum", durationMinutes: 120, description: "Historic market and local shops", timing_status: "FACTUAL" }
  ].map((seed) => coerceDayTimelineItem(seed));
  const rows = buildDayTimelineRows(seeds.filter(Boolean), "Saint John", "Montreal");
  check(
    "runtime-travel-row-shape",
    rows.length === 3 &&
      rows[0].kind === "travel" &&
      rows[0].title === "Travel from Saint John to Montreal" &&
      rows[0].time === "8:00 AM" &&
      rows[0].detail === "Flight · 1h 45m (est.)" &&
      rows[0].planned === true
  );
  check(
    "runtime-stop-row-verbatim-time-and-factual-duration",
    rows[2].kind === "stop" &&
      rows[2].time === "1:00 PM" &&
      rows[2].detail === "2h · Historic market and local shops" &&
      rows[2].durationLabel === "2h" &&
      rows[2].category === "museum"
  );
  check(
    "runtime-no-duration-means-no-duration",
    rows[1].detail === "Get to the hotel and drop luggage." && rows[1].durationLabel === null
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name}`);
  process.exit(1);
}
