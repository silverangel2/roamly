// Map segment-link checks (2026-11-08).
//
// Owner defect, reported with a screenshot of his own Montreal trip
// (Day 1): the Map tab's stop cards included one titled "Getting
// there" — a transport SEGMENT LABEL, not a place — whose three
// external links searched the literal words "Getting there". The
// unbooked stay placeholder card ("Stay in Montreal") carried the
// same shape of links to its label text.
//
// Root cause: buildHomeDayView built the Map tab's card list from
// EVERY timeline row's map query, with no test of whether the row
// names a place. A segment record with no origin/destination falls
// back through presentTravelerTitle to the bare label "Getting
// there" (itineraryPresentation), its stored map_query defaults to
// the title (stagedItineraryGeneration's seed normalisation), and
// the display chain (buildDisplayTimelineItems -> toHomeRow) keeps
// title-as-query — so the label became a place search.
//
// The fix (lib/roamly/itineraryHome.ts): a row joins the day's map
// list only when it names a place —
//   * it carries stored coordinates (the link targets the point), or
//   * it is an identified place row: not unverified, its query is
//     not a bare generic placeholder (isGenericStopText), it is not
//     an unbooked generic stay placeholder, and — for segment kinds
//     (travel / arrival) — its query carries a place its own label
//     does not (a stored map query / location distinct from the
//     title, e.g. the engine arrival leg's destination city), or it
//     is a hotel check-in whose title IS the property.
// Rows stay in the List view untouched; only the map list changes.
//
// These checks compose the REAL chain end to end: stored records ->
// buildDisplayTimelineItems (home options) -> buildHomeDayView ->
// buildNavigationLinks, over generic place names.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

const itineraryHome = await import("@/lib/roamly/itineraryHome.ts");
const { buildHomeDayView } = itineraryHome;
const { buildNavigationLinks } = await import("@/lib/roamly/navigationLinks.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}

/* ------------------------------------------------------------------ */
/* Display-chain loader (same vm pattern as the map-honesty checks)    */
/* ------------------------------------------------------------------ */

function loadTsxWithMocks(file, mocks) {
  const compiled = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInNewContext(output, {
    exports: compiled.exports,
    module: compiled,
    require(name) {
      if (name === "react/jsx-runtime" || name === "react") return require(name);
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      throw new Error(`Unexpected import in ${file}: ${name}`);
    },
    Date,
    Intl,
    console
  });
  return compiled.exports;
}

const dayPlanModule = loadTsxWithMocks("components/trip/ItineraryDayPlan.tsx", {
  "@/lib/roamly/bookingDisplayTiming": await import("@/lib/roamly/bookingDisplayTiming.ts"),
  "lucide-react": { ChevronRight: () => null },
  "@/lib/roamly/bookingTruth": await import("@/lib/roamly/bookingTruth.ts"),
  "@/components/roamly/PlanningConflictRepair": { default: () => null },
  "@/components/roamly/CustomerActivityRemoval": { default: () => null },
  "@/components/roamly/CustomerActivityReplacement": { default: () => null },
  "@/components/trip/HotelPartnerChoices": { HotelPartnerChoices: () => null },
  "@/lib/roamly/affiliateResolver": { resolveConfiguredHotelPartners: () => [] },
  "@/lib/roamly/navigationLinks": await import("@/lib/roamly/navigationLinks.ts"),
  "@/lib/roamly/placeDetail": await import("@/lib/roamly/placeDetail.ts"),
  "@/lib/roamly/itineraryRepair": { findRepairTarget: () => null },
  "@/lib/roamly/confirmedItineraryAnchor": await import("@/lib/roamly/confirmedItineraryAnchor.ts"),
  "@/lib/itinerary": { formatMoney: () => "" },
  "@/lib/roamly/itineraryPresentation": await import("@/lib/roamly/itineraryPresentation.ts"),
  "@/lib/roamly/itineraryHome": itineraryHome,
  "@/lib/roamly/daySummary": await import("@/lib/roamly/daySummary.ts"),
  "@/lib/roamly/activityDescription": await import("@/lib/roamly/activityDescription.ts"),
  "@/lib/roamly/marketStopDescription": await import("@/lib/roamly/marketStopDescription.ts"),
  "@/lib/roamly/planStayRow": await import("@/lib/roamly/planStayRow.ts")
});
const { buildDisplayTimelineItems } = dayPlanModule;

const homeViewFor = (day) =>
  buildHomeDayView({
    day_number: day.day_number,
    date: day.date,
    rows: buildDisplayTimelineItems(day, [], {
      suppressFlightFraming: true,
      maxRows: null,
      keepTravelRows: true,
      keepStoredOrder: true
    }).items
  });

const linksFor = (detail) =>
  buildNavigationLinks({
    destinationLabel: detail.query,
    address: detail.query,
    latitude: detail.latitude,
    longitude: detail.longitude,
    unverifiedSearch: detail.searchOnly
  });

/* ------------------------------------------------------------------ */
/* Day A — the owner's Day-1 shape: a label segment, an unbooked      */
/* stay placeholder, a free-time row, and two real stops.             */
/* ------------------------------------------------------------------ */

console.log("(A) segment labels and placeholders never become map stops");

const dayA = {
  day_number: 1,
  date: "2026-10-30",
  live_timeline: [
    {
      // A transport segment whose record carries a provider-search
      // title and NO origin, destination, location or map query:
      // the presenter falls back to the bare segment label.
      item_type: "travel",
      category: "transport",
      title: "Flights from Origin City to Destination City",
      description: "Getting there: about 95 min by air.",
      travel_mode: "",
      source: "fallback_estimate",
      factualStatus: "estimated"
    },
    {
      // The unbooked stay placeholder: no property chosen, its
      // stored map query is the placeholder label itself.
      item_type: "hotel",
      category: "Hotel",
      title: "Stay in Destination City",
      location_name: "",
      map_query: "Stay in Destination City",
      description: "",
      source: "stay22",
      factualStatus: "search_ready"
    },
    {
      item_type: "rest",
      category: "rest",
      title: "Free time",
      description: "",
      source: "roamly_internal"
    },
    {
      // A real stop with stored coordinates.
      item_type: "activity",
      category: "attraction",
      title: "Harborfront Wheel",
      description: "Observation wheel on the waterfront.",
      source: "roamly_internal",
      coordinates: { latitude: 45.5119, longitude: -73.5468 },
      coordinatePrecision: "place",
      coordinateSource: "candidate"
    },
    {
      // A real stop known only as a live-search result (the
      // PR #112 search-labelled case — must keep its links).
      item_type: "activity",
      category: "restaurant",
      title: "Noodle Counter",
      description: "Counter noodles near the station.",
      source: "public_web",
      factualStatus: "search_ready"
    }
  ]
};

const viewA = homeViewFor(dayA);
const queriesA = viewA.mapStopDetails.map((detail) => detail.query);

ok(
  viewA.rows.some((row) => row.title === "Getting there"),
  "A0: the segment still renders as a List row titled 'Getting there' (the List view is not the defect)"
);
ok(
  !queriesA.includes("Getting there"),
  "A1: the segment label 'Getting there' is NOT a map stop"
);
ok(
  !viewA.mapStopDetails.some((detail) =>
    linksFor(detail).some((link) => /Getting%20there/i.test(link.href))
  ),
  "A1: no map link searches the words 'Getting there'"
);
ok(
  !queriesA.includes("Stay in Destination City"),
  "A2: the unbooked stay placeholder is NOT a map stop"
);
ok(!queriesA.includes("Free time"), "A3: a bare 'Free time' row is NOT a map stop");
eq(
  viewA.mapStopDetails.length,
  viewA.mapStops.length,
  "A4: mapStops and mapStopDetails stay parallel"
);
const wheel = viewA.mapStopDetails.find((detail) => detail.query === "Harborfront Wheel");
ok(wheel, "A5: the coordinate-carrying venue keeps its map stop");
eq(wheel?.latitude, 45.5119, "A5: its coordinates ride along");
eq(wheel?.searchOnly, false, "A5: its links are place links, not searches");
const noodle = viewA.mapStopDetails.find((detail) => detail.query === "Noodle Counter");
ok(noodle, "A6: the live-search venue keeps its map stop");
eq(noodle?.searchOnly, true, "A6: its links stay search-labelled (PR #112 behaviour preserved)");
ok(
  linksFor(noodle).every((link) => link.label.startsWith("Search in ")),
  "A6: all three providers keep the search wording for a real search-backed place"
);

/* ------------------------------------------------------------------ */
/* Day B — survival: engine-shaped rows whose queries name places.    */
/* ------------------------------------------------------------------ */

console.log("(B) place-carrying segment and stay rows keep their map stops");

const dayB = {
  day_number: 2,
  date: "2026-10-31",
  live_timeline: [
    {
      // The engine's arrival leg: its stored map query IS the
      // destination city — a place the label itself does not carry.
      item_type: "travel",
      category: "Travel",
      title: "Travel from Origin City to Destination City",
      description: "Arrival travel — make your way in, then settle at your stay.",
      location_name: "Destination City",
      map_query: "Destination City",
      origin: "Origin City",
      destination: "Destination City",
      time_label: "Arrival",
      source: "zero-engine",
      timing_status: "PLANNED"
    },
    {
      // A booked stay's check-in with NO saved coordinates (the
      // PR #112 unmatched-booking shape): the title IS the
      // property, so its ordinary links stay.
      item_type: "hotel",
      category: "Hotel",
      title: "Harbor Hotel",
      description: "Check in at Harbor Hotel — your base for this trip.",
      location_name: "Harbor Hotel",
      map_query: "Harbor Hotel",
      time_label: "Check-in",
      source: "zero-engine",
      factualStatus: "verified",
      coordinatePrecision: "area",
      coordinateSource: "destination_centre"
    }
  ]
};

const viewB = homeViewFor(dayB);
const queriesB = viewB.mapStopDetails.map((detail) => detail.query);

ok(queriesB.includes("Destination City"), "B1: the engine arrival leg's city query keeps its map stop");
ok(queriesB.includes("Harbor Hotel"), "B2: the booked stay check-in keeps its map stop");
const harbor = viewB.mapStopDetails.find((detail) => detail.query === "Harbor Hotel");
eq(harbor?.searchOnly, false, "B2: the booked stay's links stay ordinary (PR #112 behaviour preserved)");
ok(
  linksFor(harbor).every((link) => link.label.startsWith("Open in ")),
  "B2: all three providers keep the plain labels for the named stay"
);
eq(
  viewB.mapStopDetails.length,
  viewB.mapStops.length,
  "B3: mapStops and mapStopDetails stay parallel"
);

console.log(`\nPASS: ${count} map segment-link checks — segment labels are not places, and places keep their links.`);
