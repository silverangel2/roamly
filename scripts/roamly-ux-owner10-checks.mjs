// roamly-ux-owner10-checks.mjs — owner-10 repair proofs (Roamly
// 8-screen overhaul, owner rejection round). Self-contained node +
// fixture imports from the tree's own modules (strip-types register
// handles TS + @/ aliases). No live Wikidata calls: photo matching
// is proven by STATIC source patterns + the gate constants, never by
// a network fetch inside a test.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-owner10-checks.mjs [root]

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTitleEcho, isUnverifiableStopTitle, buildHomeDayView } from "@/lib/roamly/itineraryHome.ts";
import { stripTimelineTitleEcho, isUnverifiableTimelineTitle, buildDayTimelineRows } from "@/lib/roamly/liveDayTimeline.ts";
import { stripPlaceTitleEcho, buildPlaceDetail } from "@/lib/roamly/placeDetail.ts";
import { buildCountryInfoPanelModel } from "@/lib/roamly/countryInfoPanel.ts";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, kind, ok, detail = "") {
  results.push({ name, kind, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${kind}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- Files under test ----
const appShell = read("components/AppShellClient.tsx");
const destinationPhoto = read("lib/roamly/destinationPhoto.ts");
const dayPlan = read("components/trip/ItineraryDayPlan.tsx");
const tripPage = read("app/trip/[id]/page.tsx");
const homePanel = read("components/trip/ItineraryHomePanel.tsx");
const liveClient = read("components/trip/LiveTripClient.tsx");
const placePanel = read("components/roamly/PlaceDetailPanel.tsx");
const countryPanel = read("components/roamly/CountryInfoPanel.tsx");
const alertsCard = read("components/roamly/AlertsSectionCard.tsx");
const alertsPage = read("app/notifications/page.tsx");
const directionsPanel = read("components/trip/DirectionsPanel.tsx");

// ---- Item 1: bottom padding rule (64px bar + 2.5rem + safe area) ----
check(
  "item1-shell-padding-rule",
  "STATIC",
  appShell.includes("pb-[calc(64px+2.5rem+env(safe-area-inset-bottom))]") &&
    appShell.includes("env(safe-area-inset-bottom)")
);

// ---- Item 3: photo pipeline — mechanical variants + strict gates ----
check(
  "item3-title-variants",
  "STATIC",
  destinationPhoto.includes("et\\s+du\\s+") &&
    destinationPhoto.includes("musée\\s+du\\s+") &&
    destinationPhoto.includes("labelVariants")
);
check(
  "item3-gates-kept",
  "STATIC",
  destinationPhoto.includes("MAX_COORD_DISTANCE_KM = 150") &&
    destinationPhoto.includes("shared >= 2") &&
    destinationPhoto.includes("shared < 2") &&
    destinationPhoto.includes("destination_photo:v2:")
);

// ---- Item 4: home chronological order, no cap, travel/arrival/return ----
const row = (over) => ({
  time: "",
  title: "",
  description: "",
  location: "",
  category: "",
  itemType: "",
  durationLabel: "",
  travelLabel: "",
  mapQuery: "",
  authority: "flexible",
  timeFromBooking: false,
  ...over
});
const homeView = buildHomeDayView({
  day_number: 1,
  date: "2026-10-26",
  rows: [
    row({ time: "Arrival", title: "Travel from Saint John to Montreal", description: "Arrival travel from Saint John to Montreal.", itemType: "travel", category: "Travel", authority: "supporting" }),
    row({ time: "Check-in", title: "Hôtel Place d'Armes", description: "Check in at Hôtel Place d'Armes.", itemType: "hotel", category: "Hotel", authority: "supporting" }),
    row({ time: "2:54 PM", title: "Théâtre Jean-Duceppe", description: "Théâtre Jean-Duceppe — planned for day 1 of this trip.", category: "Attraction" }),
    row({ time: "9:37 AM", title: "Musée du marché Sainte-Anne", description: "Musée du marché Sainte-Anne — planned for day 1 of this trip.", category: "Museum" }),
    row({ time: "1:45 PM", title: "WIP", description: "WIP — planned for day 1 of this trip.", category: "Gallery" }),
    row({ time: "Return to your stay", title: "Hôtel Place d'Armes", description: "Return to Hôtel Place d'Armes for the night.", itemType: "hotel", category: "Hotel", authority: "supporting" })
  ]
});
const homeKinds = homeView.rows.map((r) => r.kind);
const homeTitles = homeView.rows.map((r) => r.title);
check(
  "item4-home-chronological-all-rows",
  "FIXTURE",
  homeView.rows.length === 6 &&
    homeKinds[0] === "travel" &&
    homeKinds[1] === "arrival" &&
    homeTitles[2] === "Musée du marché Sainte-Anne" &&
    homeKinds[4] === "return-to-stay" &&
    homeTitles[5] === "Théâtre Jean-Duceppe",
  `kinds=${homeKinds.join(",")}`
);
check(
  "item4-home-travel-planned-pill",
  "FIXTURE",
  homeView.rows[0].planned === true
);
check(
  "item4-home-no-cap-in-page",
  "STATIC",
  tripPage.includes("maxRows: null") &&
    tripPage.includes("keepTravelRows: true") &&
    tripPage.includes("keepStoredOrder: true")
);
check(
  "item4-dayplan-options-exist",
  "STATIC",
  dayPlan.includes("maxRows") && dayPlan.includes("keepTravelRows") && dayPlan.includes("keepStoredOrder")
);

// ---- Item 5: echo strip + unverified rule (home, live, place) ----
check(
  "item5-home-echo-strip",
  "FIXTURE",
  stripTitleEcho("Musée du marché Sainte-Anne", "Musée du marché Sainte-Anne — planned for day 1 of this trip.") === "" &&
    stripTitleEcho("Galerie Blanche", "Galerie Blanche") === "" &&
    stripTitleEcho("Galerie Blanche", "Small white-walled gallery with rotating shows.") ===
      "Small white-walled gallery with rotating shows."
);
check(
  "item5-home-unverified-rule",
  "FIXTURE",
  isUnverifiableStopTitle("WIP", "") === true &&
    isUnverifiableStopTitle("WIP", "Real description.") === false &&
    isUnverifiableStopTitle("Galerie Blanche", "") === false
);
check(
  "item5-home-wip-row-flagged",
  "FIXTURE",
  homeView.rows.find((r) => r.title === "WIP")?.unverified === true &&
    homeView.rows.find((r) => r.title === "WIP")?.planTitle === "WIP" &&
    !homeView.rows.find((r) => r.title === "Musée du marché Sainte-Anne")?.subtitle.includes("planned for day 1")
);
check(
  "item5-live-echo-strip",
  "FIXTURE",
  stripTimelineTitleEcho("WIP", "WIP — planned for day 1 of this trip.") === "" &&
    stripTimelineTitleEcho("Musée X", "Musée X") === "" &&
    isUnverifiableTimelineTitle("WIP", "") === true &&
    isUnverifiableTimelineTitle("WIP", "Real note.") === false
);
const liveRows = buildDayTimelineRows(
  [
    { title: "Musée du marché Sainte-Anne", description: "Musée du marché Sainte-Anne — planned for day 1 of this trip.", category: "Museum", durationMinutes: 90 },
    { title: "WIP", description: "WIP — planned for day 1 of this trip.", category: "Gallery", durationMinutes: 60 }
  ],
  "Saint John",
  "Montreal"
);
check(
  "item5-live-rows-strip-and-flag",
  "FIXTURE",
  liveRows.length === 2 &&
    !liveRows[0].detail.includes("planned for day 1") &&
    liveRows[1].unverified === true &&
    liveRows[1].planTitle === "WIP",
  `details=${liveRows.map((r) => r.detail).join(" | ")}`
);
check(
  "item5-place-echo-strip",
  "FIXTURE",
  stripPlaceTitleEcho("Musée X", "Musée X — planned for day 1 of this trip.") === null &&
    stripPlaceTitleEcho("Musée X", "Musée X") === null &&
    stripPlaceTitleEcho("Musée X", "A real description.") === "A real description."
);
const wipItem = { title: "WIP", description: "WIP — planned for day 1 of this trip.", category: "Gallery" };
const placeDetail = buildPlaceDetail({
  item: wipItem,
  day: { day_number: 1, date: "2026-10-26", live_timeline: [wipItem] },
  siblings: [],
  trip: { destination: "Montreal", origin: "Saint John", start_date: "2026-10-26", end_date: "2026-10-30" },
  tripTips: [],
  confirmedBookings: [],
  photo: null
});
check(
  "item5-place-wip-unverified",
  "FIXTURE",
  placeDetail?.unverified === true &&
    placeDetail?.planTitle === "WIP" &&
    placeDetail?.description === null
);
check(
  "item5-panels-render-unverified-stop",
  "STATIC",
  homePanel.includes("Unverified stop") &&
    liveClient.includes("Unverified stop") &&
    placePanel.includes("Unverified stop") &&
    homePanel.includes("Plan title:") &&
    placePanel.includes("Plan title:")
);
check(
  "item5-daycard-strip-and-flag",
  "STATIC",
  dayPlan.includes("stripTitleEcho(title, description)") &&
    dayPlan.includes('item.unverified ? "Unverified stop" : item.title') &&
    dayPlan.includes("Plan title: {item.planTitle}")
);

// ---- Item 6: Live restructure (featured card + compact list + details) ----
check(
  "item6-live-restructure",
  "STATIC",
  liveClient.includes("featuredActivity") &&
    liveClient.includes("Next relevant activity") &&
    liveClient.includes("upcomingActivities.map") &&
    liveClient.includes("Stop actions") &&
    liveClient.includes("Location is off — fix it") &&
    liveClient.includes("!isWalkLiveActivity(activity)")
);

// ---- Item 2/10: country city fallback + wrapping classes ----
const countryModel = buildCountryInfoPanelModel(
  {
    id: "trip-1",
    destination_name: "Montreal",
    destination_country: "Canada",
    start_date: "2026-10-26",
    end_date: "2026-10-30",
    metadata: {}
  },
  null
);
const countryCity = countryModel.grid.find((c) => c.key === "city");
const countryTz = countryModel.grid.find((c) => c.key === "timezone");
check(
  "item2-country-city-fallback",
  "FIXTURE",
  // Timezone round (2026-10-26) — stale expectation updated with
  // justification: the old pin asserted tz === null because no IANA
  // zone was stored in the record. The timezone fix resolves the
  // zone from the VERIFIED destination registry when metadata has
  // none (Montreal → America/Toronto), and Country info must display
  // it from that same source — so a Montreal trip now correctly
  // shows Eastern Daylight Time (UTC-04:00) instead of "Not
  // available". The city-fallback intent (city === Montreal) is
  // unchanged, and the country-only trip below still pins null.
  countryCity?.value === "Montreal" && countryTz?.value === "Eastern Daylight Time (UTC-04:00)",
  `city=${countryCity?.value} tz=${countryTz?.value}`
);
const countryModelCountryOnly = buildCountryInfoPanelModel(
  {
    id: "trip-2",
    destination_name: "Canada",
    destination_country: "Canada",
    start_date: "2026-10-26",
    end_date: "2026-10-30",
    metadata: {}
  },
  null
);
check(
  "item2-country-name-not-city",
  "FIXTURE",
  countryModelCountryOnly.grid.find((c) => c.key === "city")?.value === null
);
check(
  "item10-wrapping-classes",
  "STATIC",
  countryPanel.includes("min-w-0") &&
    countryPanel.includes("break-words") &&
    placePanel.includes("break-words") &&
    homePanel.includes("break-words") &&
    liveClient.includes("break-words") &&
    alertsCard.includes("break-words")
);

// ---- Item 9: Alerts totals + honest Travel-updates empty state ----
check(
  "item9-alerts-totals-and-empty",
  "STATIC",
  alertsCard.includes("in total") &&
    alertsCard.includes("See all ${rows.length}") &&
    alertsCard.includes("emptyText") &&
    alertsPage.includes('emptyText="No travel updates for this trip yet"')
);

// ---- Item 7: Directions estimate note ----
check(
  "item7-directions-estimate-note",
  "STATIC",
  // Repair round P3 supersedes the conditional wording: the estimate
  // is now marked on the values themselves ("(est.)" on duration +
  // distance, gated on fallbackEstimateUsed) instead of a repeated
  // routing sentence — the summary Route row is the screen's only
  // routing explanation, and estimates never pose as routed walks.
  directionsPanel.includes("fallbackEstimateUsed") &&
    directionsPanel.includes("(est.)") &&
    !directionsPanel.includes("live routing opens in your maps app below.")
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
