// Map-honesty fix checks (2026-11-07).
//
// The maps audit (MAPS-REPORT) found the one place a Roamly map
// could lie: a BOOKED stay that matched no scored candidate was
// pinned at the destination centre under the booking's own title
// with factualStatus "verified" — a city-level guess presented as
// the property. These checks pin the replacement behaviour end to
// end:
//
//   1. deriveSolveContext still identifies the four anchor cases
//      (the solver keeps planning from the centre internally —
//      only the PRESENTED pin changed);
//   2. engineDayToRoamlyDayPlan's stay seeds: a booked-unmatched
//      stay writes NO coordinates (the pin is dropped), stamped
//      area/destination_centre so the display can explain it; the
//      "{destination} centre (base anchor)" fallback keeps its
//      centre coordinates but stamped "area" so they render as
//      approximate; matched/booked and scored stays keep true
//      place coordinates stamped "place";
//   3. the display chain (buildDisplayTimelineItems -> home rows
//      -> day view) carries the stamps through untouched, drops
//      unknown stamp values to null, and flags bare-text-search
//      map links (mapLinkSearchOnly / mapStopDetails.searchOnly);
//   4. buildNavigationLinks labels unverified text searches as
//      searches ("Search in Google Maps — check it's the right
//      place"), while coordinate links keep the plain labels;
//   5. TripDayMap's exported helpers give an area pin a different
//      marker colour and an explicit approximate note, and the
//      panel wires the stamps + the no-pin explanation through
//      (source assertions, the house pattern for JSX wiring).
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

const { deriveSolveContext, engineDayToRoamlyDayPlan } = await import(
  "@/lib/roamly/engine/generate.ts"
);
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
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, label);
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CENTER = { lat: 43.6532, lon: -79.3832 };
const STAY_POS = { lat: 43.66, lon: -79.39 };
const pack = {
  destination: "Toronto",
  country: "Canada",
  center: CENTER,
  counts: { total: 1, sights: 0, foods: 0, stays: 1, transport: 0 },
  stays: [],
  sights: [],
  excursions: [],
  foods: [],
  transport: [],
  weather: []
};
const scoredStay = {
  key: "way/111",
  name: "Hotel Alpha",
  kind: "hotel",
  pos: STAY_POS,
  hoursRaw: null,
  tags: {},
  url: "https://www.openstreetmap.org/way/111",
  walkableSights: 3,
  walkableFood: 2,
  distCenterKm: 0.9,
  quietProxy: 8,
  anchorScore: 12.4
};
const basePayload = { destination: "Toronto", specialNotes: "", interests: [], confirmedBookings: [] };

/* ------------------------------------------------------------------ */
/* 1. Anchor identity                                                  */
/* ------------------------------------------------------------------ */

console.log("(1) deriveSolveContext — the four anchor cases");

{
  const ctx = deriveSolveContext({
    payload: {
      ...basePayload,
      confirmedBookings: [{ booking_type: "hotel", title: "Hotel Alpha" }]
    },
    pack,
    scoredStays: [scoredStay]
  });
  eq(ctx.anchorSource, "booked", "1a: matched booking is anchorSource booked");
  eq(ctx.anchorKey, "way/111", "1a: matched booking keeps the candidate key");
  deepEq(ctx.anchorPos, STAY_POS, "1a: matched booking anchors at the stay's own point");
}
{
  const ctx = deriveSolveContext({
    payload: {
      ...basePayload,
      confirmedBookings: [{ booking_type: "hotel", title: "Obscure Riverside Lodge" }]
    },
    pack,
    scoredStays: [scoredStay]
  });
  eq(ctx.anchorSource, "booked", "1b: unmatched booking is still anchorSource booked");
  eq(ctx.anchorKey, null, "1b: unmatched booking has NO candidate key");
  deepEq(ctx.anchorPos, CENTER, "1b: the solver still plans from the centre internally");
}
{
  const ctx = deriveSolveContext({ payload: basePayload, pack, scoredStays: [scoredStay] });
  eq(ctx.anchorSource, "scored-fallback", "1c: no booking + scored stay = scored-fallback");
  eq(ctx.anchorKey, "way/111", "1c: scored fallback anchors on the top stay");
}
{
  const ctx = deriveSolveContext({ payload: basePayload, pack, scoredStays: [] });
  eq(ctx.anchorSource, "destination-centre", "1d: no booking + no stays = destination-centre");
  eq(ctx.anchorName, "Toronto centre (base anchor)", "1d: the fallback names itself honestly");
  eq(ctx.anchorKey, null, "1d: destination-centre has no candidate key");
}

/* ------------------------------------------------------------------ */
/* 2. Stay seeds                                                       */
/* ------------------------------------------------------------------ */

console.log("(2) engineDayToRoamlyDayPlan — stay seed coordinates + stamps");

const engineDay = {
  dayNumber: 1,
  date: "2026-11-10",
  role: "full",
  items: [],
  legs: [],
  endMin: 1320,
  narrative: []
};
const conversionBase = {
  destination: "Toronto",
  totalDayCount: 1,
  mustSeeKeys: new Set(),
  originLabel: null
};
const staySeedsOf = (dayPlan) =>
  (dayPlan.live_timeline || []).filter((item) => item.item_type === "hotel");

{
  const dayPlan = engineDayToRoamlyDayPlan(engineDay, {
    ...conversionBase,
    anchorName: "Hotel Alpha",
    anchorKey: "way/111",
    anchorBooked: true,
    anchorSource: "booked",
    anchorPos: STAY_POS
  });
  const seeds = staySeedsOf(dayPlan);
  ok(seeds.length >= 1, "2a: matched booking writes stay seeds");
  const checkIn = seeds[0];
  deepEq(
    checkIn.coordinates,
    { latitude: STAY_POS.lat, longitude: STAY_POS.lon },
    "2a: matched booking pins at the stay's own coordinates"
  );
  eq(checkIn.coordinatePrecision, "place", "2a: matched booking is place precision");
  eq(checkIn.coordinateSource, "candidate", "2a: matched booking source is the candidate");
  eq(checkIn.candidateId, "way/111", "2a: matched booking keeps its candidate id");
}
{
  const dayPlan = engineDayToRoamlyDayPlan(engineDay, {
    ...conversionBase,
    anchorName: "Obscure Riverside Lodge",
    anchorKey: null,
    anchorBooked: true,
    anchorSource: "booked",
    anchorPos: CENTER
  });
  const seeds = staySeedsOf(dayPlan);
  ok(seeds.length >= 1, "2b: unmatched booking still writes its stay seeds (the plan needs the stay)");
  ok(
    seeds.every((seed) => !("coordinates" in seed) || seed.coordinates == null),
    "2b: NO stay seed carries coordinates — the centre pin is dropped, not relabelled"
  );
  ok(
    (dayPlan.live_timeline || []).every((item) => item.coordinates == null),
    "2b: no item on the day carries the destination centre as coordinates"
  );
  const checkIn = seeds[0];
  eq(checkIn.title, "Obscure Riverside Lodge", "2b: the booking's own title is kept");
  eq(checkIn.factualStatus, "verified", "2b: the booking itself stays verified — only the pin was the lie");
  eq(checkIn.coordinatePrecision, "area", "2b: the stay is stamped area precision");
  eq(checkIn.coordinateSource, "destination_centre", "2b: the stay is stamped destination_centre source");
}
{
  const dayPlan = engineDayToRoamlyDayPlan(engineDay, {
    ...conversionBase,
    anchorName: "Toronto centre (base anchor)",
    anchorKey: null,
    anchorBooked: false,
    anchorSource: "destination-centre",
    anchorPos: CENTER
  });
  const seeds = staySeedsOf(dayPlan);
  ok(seeds.length >= 1, "2c: the base-anchor fallback still writes its stay seed");
  const checkIn = seeds[0];
  deepEq(
    checkIn.coordinates,
    { latitude: CENTER.lat, longitude: CENTER.lon },
    "2c: the self-disclosing base anchor keeps its centre coordinates"
  );
  eq(checkIn.coordinatePrecision, "area", "2c: ...but stamped area, so the pin renders approximate");
  eq(checkIn.coordinateSource, "destination_centre", "2c: source is destination_centre");
  eq(checkIn.factualStatus, "search_ready", "2c: the fallback keeps its non-verified status — never dressed as a booking");
}
{
  const dayPlan = engineDayToRoamlyDayPlan(engineDay, {
    ...conversionBase,
    anchorName: "Hotel Alpha",
    anchorKey: "way/111",
    anchorBooked: false,
    anchorSource: "scored-fallback",
    anchorPos: STAY_POS
  });
  const checkIn = staySeedsOf(dayPlan)[0];
  deepEq(
    checkIn.coordinates,
    { latitude: STAY_POS.lat, longitude: STAY_POS.lon },
    "2d: scored fallback pins at the stay's own coordinates"
  );
  eq(checkIn.coordinatePrecision, "place", "2d: scored fallback is place precision");
  eq(checkIn.coordinateSource, "candidate", "2d: scored fallback source is the candidate");
}

/* ------------------------------------------------------------------ */
/* 3. Display chain — buildDisplayTimelineItems (vm, mocked chrome)    */
/* ------------------------------------------------------------------ */

console.log("(3) buildDisplayTimelineItems — stamps survive the stored record");

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
  "@/lib/roamly/planStayRow": await import("@/lib/roamly/planStayRow.ts"),
  // BoardUI day pass (2026-11-09): the day card now imports the
  // BoardUI accordion + chip primitives; the display-chain tests
  // never render, so inert stand-ins are the whole contract.
  "@/components/boardui/Accordion": { BuiAccordion: () => null },
  "@/components/boardui/Badge": { BuiChip: () => null, BuiBadge: () => null }
});
const { buildDisplayTimelineItems } = dayPlanModule;

{
  const day = {
    day_number: 1,
    date: "2026-11-10",
    live_timeline: [
      {
        item_type: "hotel",
        title: "Obscure Riverside Lodge",
        description: "Your booked stay — check in and settle in.",
        source: "zero-engine",
        factualStatus: "verified",
        coordinatePrecision: "area",
        coordinateSource: "destination_centre"
      },
      {
        item_type: "activity",
        title: "Casa Loma",
        description: "Historic house museum.",
        source: "zero-engine",
        coordinates: { latitude: 43.678, longitude: -79.409 },
        coordinatePrecision: "place",
        coordinateSource: "candidate"
      },
      {
        item_type: "activity",
        title: "Mystery Stop",
        description: "A stop with stamps from the future.",
        source: "zero-engine",
        coordinatePrecision: "exact",
        coordinateSource: "gps"
      }
    ]
  };
  const { items } = buildDisplayTimelineItems(day, []);
  const stay = items.find((item) => item.title === "Obscure Riverside Lodge");
  ok(stay, "3a: the unmatched-booking stay row renders");
  eq(stay.latitude, null, "3a: the stay row has no latitude — no pin");
  eq(stay.longitude, null, "3a: the stay row has no longitude — no pin");
  eq(stay.coordinatePrecision, "area", "3a: the area stamp survives to the display item");
  eq(stay.coordinateSource, "destination_centre", "3a: the source stamp survives to the display item");
  const venue = items.find((item) => item.title === "Casa Loma");
  eq(venue.latitude, 43.678, "3b: a real venue keeps its latitude");
  eq(venue.coordinatePrecision, "place", "3b: a real venue keeps place precision");
  eq(venue.coordinateSource, "candidate", "3b: a real venue keeps its candidate source");
  const junk = items.find((item) => item.title === "Mystery Stop");
  eq(junk.coordinatePrecision, null, "3c: an unknown precision value is dropped to null, never trusted");
  eq(junk.coordinateSource, null, "3c: an unknown source value is dropped to null, never trusted");
}
{
  // A booking synthesized from the booking record itself: its own
  // coordinates are a true place point, stamped booking_record.
  const booking = {
    id: "bk-1",
    booking_type: "hotel",
    title: "Harbourview Suites",
    booking_status: "booked",
    traveler_confirmed: true,
    // Provider-evidence fields: the day builder only synthesizes a
    // booking row for a booking with credible provider evidence
    // (bookingTruth), exactly like production.
    confirmation_number: "HBR-88412",
    provider_name: "Harbourview Direct",
    source_type: "email",
    start_at: "2026-11-10T19:00:00Z",
    end_at: "2026-11-12T15:00:00Z",
    coordinates: { latitude: 43.64, longitude: -79.37 },
    metadata: { timezone: "America/Toronto" }
  };
  const { items } = buildDisplayTimelineItems(
    { day_number: 1, date: "2026-11-10", live_timeline: [] },
    [booking]
  );
  const stay = items.find((item) => /Harbourview/.test(item.title || ""));
  ok(stay, "3d: the booking-record stay row renders");
  eq(stay.latitude, 43.64, "3d: booking-record coordinates are carried");
  eq(stay.coordinateSource, "booking_record", "3d: booking-record coordinates are stamped booking_record");
  eq(stay.coordinatePrecision, "place", "3d: booking-record coordinates are place precision");
}

/* ------------------------------------------------------------------ */
/* 4. Home rows + day view — search-only link flags                    */
/* ------------------------------------------------------------------ */

console.log("(4) itineraryHome — rows carry stamps; search-only links flagged");

{
  const view = buildHomeDayView({
    day_number: 1,
    date: "2026-11-10",
    rows: [
      {
        itemType: "activity",
        title: "Ramen-ya",
        description: "Counter ramen near the station.",
        provenance: "search"
      },
      {
        itemType: "hotel",
        title: "Obscure Riverside Lodge",
        authority: "confirmed",
        coordinatePrecision: "area",
        coordinateSource: "destination_centre"
      },
      {
        itemType: "hotel",
        title: "Stay in Toronto",
        authority: "planned"
      },
      {
        itemType: "activity",
        title: "Art Gallery of Ontario",
        description: "Major art museum.",
        provenance: "search",
        latitude: 43.6536,
        longitude: -79.3925
      },
      {
        // The codebase's own unverifiable case: a bare junk-acronym
        // title with no detail behind it (isUnverifiableStopTitle).
        itemType: "activity",
        title: "WIP",
        description: ""
      }
    ]
  });
  const byTitle = new Map(view.rows.map((row) => [row.title, row]));
  eq(byTitle.get("Ramen-ya")?.mapLinkSearchOnly, true, "4a: a live-search stop with no coordinates is a search-only link");
  const stay = byTitle.get("Obscure Riverside Lodge");
  eq(stay?.mapLinkSearchOnly, false, "4b: the booked stay keeps an ordinary link despite having no pin");
  eq(stay?.coordinatePrecision, "area", "4b: the home row carries the area stamp");
  eq(stay?.coordinateSource, "destination_centre", "4b: the home row carries the source stamp");
  eq(byTitle.get("Stay in Toronto")?.mapLinkSearchOnly, true, "4c: an unbooked generic stay placeholder is a search-only link");
  eq(byTitle.get("Art Gallery of Ontario")?.mapLinkSearchOnly, false, "4d: stored coordinates beat the search label — the link points at the place");
  const junkRow = view.rows.find((row) => row.unverified);
  ok(junkRow, "4e: the junk-acronym row is flagged unverified by the row builder");
  eq(junkRow?.mapLinkSearchOnly, true, "4e: an unverifiable stop is a search-only link");

  eq(view.mapStopDetails.length, view.mapStops.length, "4f: mapStopDetails parallels mapStops one-for-one");
  const detailFor = (query) => view.mapStopDetails.find((detail) => detail.query === query);
  eq(detailFor("Ramen-ya")?.searchOnly, true, "4f: the search stop's link detail is search-only");
  eq(detailFor("Ramen-ya")?.latitude, null, "4f: the search stop's link detail has no coordinates");
  eq(detailFor("Art Gallery of Ontario")?.latitude, 43.6536, "4f: the pinned venue's link detail carries its coordinates");
  eq(detailFor("Art Gallery of Ontario")?.searchOnly, false, "4f: the pinned venue's link is not search-only");
  eq(detailFor("Obscure Riverside Lodge")?.searchOnly, false, "4f: the booked stay's link detail is not search-only");
}

/* ------------------------------------------------------------------ */
/* 5. Navigation links — honest labels                                 */
/* ------------------------------------------------------------------ */

console.log("(5) buildNavigationLinks — search labels vs place labels");

{
  const plain = buildNavigationLinks({ destinationLabel: "Casa Loma", address: "Casa Loma" });
  deepEq(
    plain.map((link) => link.label),
    ["Open in Google Maps", "Open in Apple Maps", "Open in Citymapper"],
    "5a: an ordinary text link keeps the plain labels (unchanged behaviour)"
  );
  const search = buildNavigationLinks({
    destinationLabel: "Ramen-ya",
    address: "Ramen-ya",
    unverifiedSearch: true
  });
  deepEq(
    search.map((link) => link.label),
    [
      "Search in Google Maps — check it's the right place",
      "Search in Apple Maps — check it's the right place",
      "Search in Citymapper — check it's the right place"
    ],
    "5b: an unverified text search is labelled as a search on all three providers"
  );
  ok(
    search.every((link) => link.href.includes("Ramen-ya")),
    "5b: the search links still carry the query — only the label changed"
  );
  const pinned = buildNavigationLinks({
    destinationLabel: "Casa Loma",
    latitude: 43.678,
    longitude: -79.409,
    unverifiedSearch: true
  });
  deepEq(
    pinned.map((link) => link.label),
    ["Open in Google Maps", "Open in Apple Maps", "Open in Citymapper"],
    "5c: coordinates win over the search flag — an exact point needs no warning"
  );
  ok(
    pinned[0].href.includes("43.678") && pinned[0].href.includes("-79.409"),
    "5c: the coordinate link points at the point, not the words"
  );
}

/* ------------------------------------------------------------------ */
/* 6. TripDayMap helpers + wiring                                      */
/* ------------------------------------------------------------------ */

console.log("(6) TripDayMap — approximate pins can never look like real ones");

const tripDayMap = loadTsxWithMocks("components/roamly/TripDayMap.tsx", {
  react: require("react"),
  "react-dom/client": { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
  "maplibre-gl/dist/maplibre-gl.css": {},
  "@/lib/roamly/mapConfig": await import("@/lib/roamly/mapConfig.ts"),
  "@/components/roamly/GuardedImage": { GuardedImage: () => null }
});
eq(typeof tripDayMap.markerColorForStop, "function", "6a: markerColorForStop is exported for these checks");
eq(
  tripDayMap.markerColorForStop({ coordinatePrecision: "area" }),
  "#FFB84D",
  "6a: an area pin renders amber, never the real-pin blue"
);
eq(
  tripDayMap.markerColorForStop({ coordinatePrecision: "place" }),
  "#087BFF",
  "6a: a place pin keeps the brand blue"
);
eq(tripDayMap.markerColorForStop({}), "#087BFF", "6a: an unstamped legacy stop keeps the brand blue");
eq(
  tripDayMap.approximatePinNote({ coordinateSource: "destination_centre" }),
  "Approximate — destination centre, not the exact place",
  "6b: the destination-centre note names what the pin actually is"
);
eq(
  tripDayMap.approximatePinNote({ coordinateSource: "candidate" }),
  "Approximate — general area, not the exact place",
  "6b: any other area source gets the generic area note"
);

{
  const mapSource = fs.readFileSync(path.join(root, "components/roamly/TripDayMap.tsx"), "utf8");
  ok(mapSource.includes("markerColorForStop(stop)"), "6c: markers are created with the precision-aware colour");
  ok(mapSource.includes("stop.noPinNote"), "6c: the strip honours a caller-supplied no-pin explanation");
  const panelSource = fs.readFileSync(path.join(root, "components/trip/ItineraryHomePanel.tsx"), "utf8");
  ok(panelSource.includes("mapStopDetails"), "6d: the panel renders links from mapStopDetails");
  ok(panelSource.includes("unverifiedSearch: stopDetail.searchOnly"), "6d: the panel passes the search-only flag to the link builder");
  ok(panelSource.includes("link.label"), "6d: the panel renders the builder's label (search wording included)");
  ok(
    panelSource.includes("No property location saved — destination area only"),
    "6d: the panel explains the unmatched-booking stay's missing pin"
  );
  ok(panelSource.includes("coordinatePrecision: row.coordinatePrecision"), "6d: the panel passes row precision to the map stops");
  const generateSource = fs.readFileSync(path.join(root, "lib/roamly/engine/generate.ts"), "utf8");
  ok(generateSource.includes("anchorUnmatchedBooking"), "6e: the stay seed gates its coordinates on the unmatched-booking case");
}

console.log(`\nPASS: ${count} map-honesty checks — the centre pin lie is closed end to end.`);
