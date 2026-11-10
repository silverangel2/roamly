// BoardUI day/map checks (2026-11-09).
//
// Owner walk defect, from his own screenshots of his Montreal trip
// on the live site (2026-11-09): the itinerary DAY LIST still wore
// the pre-BoardUI look — grey "Planned" under every row, "Price not
// available" as a repeated grey paragraph, raw <details> accordions
// with CAPS summaries, and a wordy machine paragraph at the top of
// the day card ("Still to confirm: Only evidence-backed items are
// shown; missing timing, price, availability, or routing remains
// unknown. · Timeline placement is planned… · This is a planning
// suggestion, not verified inventory..") — internal evidence-tier
// language on a customer surface. And the MAP view rendered
// label/area rows as place cards titled by raw stored queries —
// "Getting there", "Montreal, Canada", "Events in Montreal to
// Montreal" — each a stack of raw blue text links.
//
// This suite pins the BoardUI pass end to end over the REAL chain
// (stored records -> buildDisplayTimelineItems (home options) ->
// buildHomeDayView), plus the dayUncertaintyNotes filter unit, plus
// source checks on the two components:
//   (1) no label/area/listing row becomes a Map place card;
//   (2) a Map card is titled by the PLACE NAME, never the raw
//       stored query (a composed search string is not a name);
//   (3) a genuinely located stop keeps its card with coordinates;
//   (4) the machine stamps never survive dayUncertaintyNotes,
//       while a SPECIFIC note passes untouched;
//   (5) the day card has no raw <details> left, carries the one
//       calm estimates line, and neither surface renders the
//       evidence-tier sentences.
//   (6) REDESIGN (2026-11-09, later the same day): the owner
//       rejected the batch-1 day-list face above ("it does not
//       have the jakob's law") — section (5) now pins the
//       familiarity face (quiet header, timeline, one sub-line,
//       photo slot, Booked-only status) and section (6) pins its
//       new derivations behaviourally.
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
const { buildHomeDayView, isNonPlaceMapLabel } = itineraryHome;
const { dayUncertaintyNotes } = await import("@/lib/roamly/daySummary.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, label);
}

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
  "@/components/boardui/Accordion": { BuiAccordion: () => null },
  "@/components/boardui/Badge": { BuiChip: () => null, BuiBadge: () => null }
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

/* ------------------------------------------------------------------ */
/* (0) The label guard, unit level                                     */
/* ------------------------------------------------------------------ */

console.log("(0) non-place labels: bare segment labels and listing phrases");

eq(isNonPlaceMapLabel("Getting there"), true, "0a: 'Getting there' is a segment label, not a place");
eq(isNonPlaceMapLabel("Events in Montreal city center"), true, "0b: an 'Events in …' listing phrase names no venue");
eq(isNonPlaceMapLabel("Check-in"), true, "0c: 'Check-in' is a label, not a place");
eq(isNonPlaceMapLabel("Notre-Dame Basilica of Montreal"), false, "0d: a real venue name is not a label");
eq(isNonPlaceMapLabel("Travelodge Montreal"), false, "0e: a venue merely containing a label word is not a label");
eq(isNonPlaceMapLabel("Montreal, Canada"), false, "0f: an area string is not a LABEL — area cards fall to the segment/venue rules, not this guard");

/* ------------------------------------------------------------------ */
/* (1)–(3) The owner's Montreal day shape, through the real chain      */
/* ------------------------------------------------------------------ */

console.log("(1-3) screenshot-shaped day: labels/areas never become cards; cards carry place names");

const montrealDay = {
  day_number: 3,
  date: "2026-11-01",
  live_timeline: [
    {
      // The screenshot's "Getting there" card source: a transport
      // segment with a provider-search title and no place fields.
      item_type: "travel",
      category: "transport",
      title: "Flights from Saint John to Montreal",
      description: "Getting there: about 95 min by air.",
      travel_mode: "",
      source: "public_web",
      factualStatus: "search_ready"
    },
    {
      // A genuinely located stop (stored coordinates).
      item_type: "activity",
      category: "attraction",
      title: "Notre-Dame Basilica Admission Ticket",
      location_name: "Old Montreal",
      map_query: "Notre-Dame Basilica of Montreal",
      time_label: "9:00 AM",
      source: "public_web",
      factualStatus: "search_ready",
      coordinates: { latitude: 45.5048, longitude: -73.5562 },
      coordinatePrecision: "place",
      coordinateSource: "candidate"
    },
    {
      // The screenshot's composed-query card: the stored map query
      // appends the city to the tour's own name.
      item_type: "tour",
      category: "tour",
      title: "Montreal, Canada walking highlights tour",
      location_name: "Montreal",
      map_query: "Montreal, Canada walking highlights tour Montreal",
      time_label: "2:00 PM",
      source: "public_web",
      factualStatus: "search_ready"
    },
    {
      // The screenshot's "Events in Montreal to Montreal" card: a
      // listing phrase for a title, a composed string for a query.
      item_type: "activity",
      category: "event",
      title: "Events in Montreal city center",
      location_name: "Montreal",
      map_query: "Events in Montreal to Montreal",
      time_label: "7:00 PM",
      source: "public_web",
      factualStatus: "search_ready"
    },
    {
      // The screenshot's "Montreal, Canada" card: a stay whose
      // stored map query is the bare destination area. The card
      // must be titled by the PROPERTY, never the area.
      item_type: "hotel",
      category: "Hotel",
      title: "Roamly QA Test Stay",
      location_name: "Montreal, Canada",
      map_query: "Montreal, Canada",
      time_label: "3:00 PM",
      source: "zero-engine",
      factualStatus: "verified"
    }
  ]
};

const view = homeViewFor(montrealDay);
const names = view.mapStopDetails.map((detail) => detail.name);
const queries = view.mapStopDetails.map((detail) => detail.query);

ok(
  view.rows.some((row) => row.title === "Getting there"),
  "1a: the segment still renders as a List row (the List view is not the defect)"
);
ok(!names.includes("Getting there") && !queries.includes("Getting there"), "1b: 'Getting there' is NOT a map card");
ok(!names.some((name) => /^events in\b/i.test(name)), "1c: no 'Events in …' listing card");
ok(!names.includes("Montreal, Canada"), "1d: no card is titled by the bare destination area");
ok(
  !names.includes("Montreal, Canada walking highlights tour Montreal"),
  "2a: no card is titled by the composed search string"
);
const tour = view.mapStopDetails.find((detail) => detail.name === "Montreal, Canada walking highlights tour");
ok(tour, "2b: the walking tour keeps its map card, titled by its own name");
const basilica = view.mapStopDetails.find((detail) => detail.name === "Notre-Dame Basilica Admission Ticket");
ok(basilica, "3a: the located stop keeps its map card");
eq(basilica?.latitude, 45.5048, "3b: its stored latitude rides along");
eq(basilica?.longitude, -73.5562, "3c: its stored longitude rides along");
eq(basilica?.searchOnly, false, "3d: a located stop's links are place links, not searches");
ok(basilica?.time, "3e: the card detail carries the stop's time for the card face");
const stay = view.mapStopDetails.find((detail) => detail.query === "Montreal, Canada");
ok(stay, "2c: the stay keeps its map card (its links target the area it only has)");
eq(stay?.name, "Roamly QA Test Stay", "2d: the stay's card is titled by the property, not the area");
eq(view.mapStopDetails.length, view.mapStops.length, "2e: mapStops and mapStopDetails stay parallel");

/* ------------------------------------------------------------------ */
/* (4) The wordy machine paragraph can no longer form                  */
/* ------------------------------------------------------------------ */

console.log("(4) dayUncertaintyNotes: machine stamps filtered, specifics kept");

const STAMPS = [
  "Only evidence-backed items are shown; missing timing, price, availability, or routing remains unknown.",
  "Timeline placement is planned; verify exact hours, availability, and route before relying on it.",
  "This is a planning suggestion, not verified inventory."
];
eq(
  dayUncertaintyNotes({ uncertainty: STAMPS, statusTexts: ["Price not available", "Route details to confirm"] }),
  [],
  "4a: the three generation stamps + generic status categories yield NO header line"
);
eq(
  dayUncertaintyNotes({
    uncertainty: [...STAMPS, "Hotel check-in time unconfirmed"],
    statusTexts: []
  }),
  ["Hotel check-in time unconfirmed"],
  "4b: a specific traveller fact passes untouched, stamps dropped around it"
);
eq(
  dayUncertaintyNotes({ headingKind: "uncertain", planStatus: "uncertain" }),
  [],
  "4c: the content-free generic pushes are gone"
);

/* ------------------------------------------------------------------ */
/* (5) Source shape: the familiarity face (redesign, 2026-11-09)       */
/*                                                                     */
/* The owner REJECTED the batch-1 day list the same day it was built:  */
/* three preamble paragraphs, the same three grey chips under every    */
/* stop ("Planned · Search result · Price not available"), the day's   */
/* city repeated as every sub-line, no photos, a Details accordion on  */
/* every stop — "it does not have the jakob's law". This section pins  */
/* the redesigned face: one quiet header line, a timeline of whole-    */
/* card tap targets, ONE sub-line per stop, a photo slot (own photo    */
/* or icon tile), "Booked" as the only status, day-level accordions    */
/* only, and the estimates line at the day FOOT.                       */
/* ------------------------------------------------------------------ */

console.log("(5) source: the familiarity face — quiet header, timeline rows, no per-stop chips");

const dayPlan = fs.readFileSync(path.join(root, "components/trip/ItineraryDayPlan.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "components/trip/ItineraryHomePanel.tsx"), "utf8");
const placePage = fs.readFileSync(path.join(root, "app/trip/[id]/place/[placeId]/page.tsx"), "utf8");

ok(dayPlan.includes("BuiAccordion"), "5a: the day card's disclosures are the BoardUI accordion");
ok(!dayPlan.includes("<details"), "5b: no raw <details> remains in the day card");
const rowRegion = dayPlan.slice(0, dayPlan.indexOf("export function DayTimelineCard"));
ok(
  !rowRegion.includes("<BuiAccordion") && (dayPlan.match(/<BuiAccordion/g) || []).length === 3,
  "5c: accordions live at DAY level only (exactly 3) — no per-stop Details accordion"
);
ok(
  dayPlan.includes("Times and prices marked planned are estimates — check before you go.") &&
    dayPlan.indexOf("Times and prices marked planned") > dayPlan.indexOf('title="Map details"'),
  "5d: the estimates line survives ONCE, at the day foot (after the day-level sections)"
);
ok(panel.includes("stopDetail.name"), "5e: the map card renders the stop's NAME");
ok(panel.includes("Search in Maps") && panel.includes("Open in Maps"), "5f: the map card's one tidy maps action is present");
for (const [label, source] of [["day card", dayPlan], ["home panel", panel]]) {
  ok(!source.includes("evidence-backed"), `5g: no 'evidence-backed' renders on the ${label}`);
  ok(!source.includes("not verified inventory"), `5h: no 'verified inventory' renders on the ${label}`);
  ok(!source.includes("routing remains unknown"), `5i: no 'routing remains unknown' renders on the ${label}`);
}
ok(
  !dayPlan.includes("Search result") &&
    !dayPlan.includes("Verified source") &&
    !dayPlan.includes(">Planned<") &&
    !dayPlan.includes(">Estimated<") &&
    !dayPlan.includes("Confirmed · booking time"),
  "5j: no per-stop provenance chips on the day face (evidence tiers never render)"
);
ok(
  dayPlan.includes('const isConfirmed = item.authority === "confirmed"') &&
    dayPlan.includes('{isConfirmed ? <BuiChip tone="navy">Booked</BuiChip> : null}') &&
    (dayPlan.match(/>Booked</g) || []).length === 1,
  "5k: 'Booked' is the face's only status, gated on confirmed authority, rendered once"
);
ok(!dayPlan.includes("Up next"), "5l: no header paragraph duplicates the first stop");
ok(
  dayPlan.includes("after:inset-0") && dayPlan.includes("/place/${item.itemId}") && !dayPlan.includes("Place details"),
  "5m: the WHOLE stop card is the tap target into the place detail (stretched link, no text link)"
);
ok(
  dayPlan.includes("item.photoUrl") && dayPlan.includes("<img") && dayPlan.includes("MapPin"),
  "5n: the photo slot renders the stop's own photo, else the quiet icon tile"
);
ok(
  !dayPlan.includes("CustomerActivityRemoval") &&
    !dayPlan.includes("CustomerActivityReplacement") &&
    placePage.includes("CustomerActivityRemoval") &&
    placePage.includes("CustomerActivityReplacement"),
  "5o: remove/replace controls live in the place detail now, not on the row"
);
ok(
  dayPlan.includes("countDayStops(summaryItems)") && dayPlan.includes("first at"),
  "5p: the header is the one quiet line — stop count (ONE count rule) + first stop's clock"
);
ok(
  panel.includes("Not located yet — opens by name search.") && !panel.includes("the map apps search by name"),
  "5q: the map card's not-located line is one short line"
);

/* ------------------------------------------------------------------ */
/* (6) The new derivations, behaviour level                            */
/* ------------------------------------------------------------------ */

console.log("(6) behaviour: photo slot, connector legs, the one sub-line, Booked derivation");

const { dayRowSubLine } = dayPlanModule;

const legDay = {
  day_number: 1,
  date: "2026-11-10",
  live_timeline: [
    {
      item_type: "activity",
      category: "attraction",
      title: "Alpha Museum",
      location_name: "Montreal, Canada",
      map_query: "Alpha Museum",
      startTime: "9:00 AM",
      endTime: "10:00 AM",
      timing_status: "PLANNED",
      photo_urls: ["https://example.com/alpha.jpg"],
      estimated_cost: 25
    },
    {
      item_type: "transfer",
      category: "transfer",
      title: "Walk to Beta Gallery",
      travel_mode: "walk",
      durationMinutes: 8
    },
    {
      item_type: "activity",
      category: "attraction",
      title: "Beta Gallery",
      location_name: "Old Montreal",
      map_query: "Beta Gallery",
      startTime: "10:30 AM",
      endTime: "11:30 AM",
      timing_status: "PLANNED"
    },
    {
      item_type: "activity",
      category: "attraction",
      title: "Gamma Park",
      location_name: "Montreal, Canada",
      map_query: "Gamma Park",
      startTime: "1:00 PM",
      endTime: "2:00 PM",
      timing_status: "PLANNED",
      travelTimeMinutes: 12,
      travel_mode: "walk"
    }
  ]
};
const legItems = buildDisplayTimelineItems(legDay, []).items;
eq(legItems.length, 3, "6a: the minor walk transfer folds (no row of its own)");
eq(legItems[0].photoUrl, "https://example.com/alpha.jpg", "6b: a record's own photo_urls[0] reaches the row");
eq(legItems[0].estimatedCost, 25, "6c: the record's stored estimated_cost reaches the row");
eq(legItems[1].photoUrl, null, "6d: no stored photo → null (the icon tile), never a stand-in");
eq(legItems[1].legLabel, "8 min walk", "6e: the folded transfer's stored minutes + mode become the next stop's connector leg");
eq(legItems[2].legLabel, "12 min walk", "6f: a stop's own stored travelTimeMinutes + mode become its leg");
eq(legItems[0].legLabel, "", "6g: no stored leg data → no leg label (never invented)");
eq(dayRowSubLine(legItems[0], "Montreal", "CAD 25"), "CAD 25", "6h: a city-repeat location is suppressed; the known price is the sub-line");
eq(dayRowSubLine(legItems[1], "Montreal", ""), "Old Montreal", "6i: an area that says more than the day's city is the sub-line");
eq(dayRowSubLine(legItems[2], "Montreal", ""), "", "6j: city repeat + no price → silence on the row");
eq(
  dayRowSubLine({ ...legItems[1], unverified: true, planTitle: "XYZ Building" }, "Montreal", ""),
  "Plan title: XYZ Building",
  "6k: an unverified stop names its plan title"
);
const bookedItems = buildDisplayTimelineItems(legDay, [
  {
    title: "Beta Gallery",
    booking_type: "activity",
    booking_status: "booked",
    traveler_confirmed: true,
    provider_name: "Booking.com",
    confirmation_number: "BK48291",
    source_type: "email",
    start_at: "2026-11-10T15:30:00Z",
    metadata: { timezone: "America/Toronto" }
  }
]).items;
eq(
  bookedItems.find((item) => item.title === "Beta Gallery")?.authority,
  "confirmed",
  "6l: a provider-evidenced booking promotes its stop to confirmed — the face's only status"
);

console.log(`\nPASS: ${count} BoardUI day/map checks — labels are not places, cards carry names, the machine paragraph is gone, and the day list reads like the day plans travellers already know.`);
