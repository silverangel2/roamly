// Description-boilerplate fix checks (2026-11-07).
//
// The staged lane's grounding writers used to stamp ONE canned
// caution paragraph ("Search-backed result. Confirm current
// hours, route, availability, and price before relying on it.")
// as the description of every market-grounded stop, so a whole
// itinerary repeated the same warning stop after stop. These
// checks pin the replacement behaviour end to end:
//   1. the composer (marketStopDescription) — honest one-liners
//      built only from facts a market candidate actually carries;
//   2. the stamping path (stagedItineraryGeneration) — grounded
//      stops get the one-liner, confirmed bookings keep theirs,
//      the sanitize/repair pass composes the same lines;
//   3. the display flattening (activityDescription + the home-row
//      builder) — stored legacy stamps heal on screen, pack-lane
//      text renders byte-identical to before.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      process,
      URL,
      URLSearchParams,
      Date,
      setTimeout,
      clearTimeout,
      require(id) {
        // "server-only" is a Next virtual module; stub it like
        // scripts/roamly-test-server-only-hooks.mjs does.
        if (id === "server-only") return {};
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const local = path.join(path.dirname(file), id);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        return require(id);
      }
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const BOILERPLATE =
  "Search-backed result. Confirm current hours, route, availability, and price before relying on it.";
const VERIFIED_BOILERPLATE =
  "Verified source result. Confirm current hours, route, and price before relying on it.";

/* ------------------------------------------------------------------ */
/* 1. The composer                                                     */
/* ------------------------------------------------------------------ */
const composer = loadTsModule("lib/roamly/marketStopDescription.ts");
const {
  marketStopOneLiner,
  isGenericStayTitle,
  legacyMarketBoilerplateProvenance,
  stripLegacyMarketStamp,
  marketProvenanceForStoredItem,
  SEARCH_RESULT_CAUTION
} = composer;

assert.equal(
  marketStopOneLiner({ category: "tour", city: "Montreal", provenance: "search" }),
  "Tour · Montreal — a live search result, not a confirmed place."
);
assert.equal(
  marketStopOneLiner({ category: "restaurant", city: "Montreal", provenance: "search" }),
  "Restaurant · Montreal — found by live search, hours and price not confirmed."
);
assert.equal(
  marketStopOneLiner({ category: "hotel", city: "Montreal", provenance: "search" }),
  "Hotel · Montreal — a live search result, not a booked stay."
);
assert.equal(
  marketStopOneLiner({ category: "hotel", city: "Montreal", provenance: "search", genericStay: true }),
  "Hotel — not chosen yet · Montreal."
);
assert.equal(
  marketStopOneLiner({ category: "flight", city: "Montreal", origin: "Saint John", provenance: "search" }),
  "Flight · Saint John to Montreal — a live search result, times and price not confirmed."
);
assert.equal(
  marketStopOneLiner({ category: "attraction", city: "Montreal", provenance: "verified" }),
  "Attraction · Montreal — from a verified source."
);
assert.equal(
  marketStopOneLiner({ category: "hotel", city: "Montreal", provenance: "verified" }),
  "Hotel · Montreal — from a verified source, not a booked stay."
);
assert.equal(
  marketStopOneLiner({ category: "attraction", city: "Montreal", provenance: "pack" }),
  "Attraction · Montreal — from Roamly's destination pack."
);
assert.equal(
  marketStopOneLiner({ category: "tour", city: "", provenance: "search" }),
  "Tour — a live search result, not a confirmed place."
);
// No composed line ever carries the old caution paragraph.
for (const provenance of ["search", "verified", "pack"]) {
  for (const category of ["tour", "restaurant", "hotel", "attraction", "flight", "transport"]) {
    const line = marketStopOneLiner({ category, city: "Montreal", origin: "Saint John", provenance });
    assert.ok(!line.includes("Confirm current hours"), `one-liner must not contain the caution: ${line}`);
  }
}

assert.equal(isGenericStayTitle("Stay in Montreal city center hotel"), true);
assert.equal(isGenericStayTitle("Montreal hotel search"), true);
assert.equal(isGenericStayTitle("Hotels in Montreal"), true);
assert.equal(isGenericStayTitle("Hôtel Place d'Armes"), false);
assert.equal(isGenericStayTitle("Hotel Bonaventure Montreal"), false);

assert.equal(legacyMarketBoilerplateProvenance(BOILERPLATE), "search");
assert.equal(legacyMarketBoilerplateProvenance(VERIFIED_BOILERPLATE), "verified");
assert.equal(legacyMarketBoilerplateProvenance("A real description."), null);

assert.equal(stripLegacyMarketStamp(BOILERPLATE), "");
assert.equal(stripLegacyMarketStamp(VERIFIED_BOILERPLATE), "");
assert.equal(
  stripLegacyMarketStamp("Search-backed result. A cozy spot the locals love."),
  "A cozy spot the locals love."
);
assert.equal(
  stripLegacyMarketStamp("Search-backed result. Confirm current hours, route, and price before going."),
  ""
);
assert.equal(stripLegacyMarketStamp("A real description."), "A real description.");

assert.equal(marketProvenanceForStoredItem("travelpayouts", "search_ready"), "search");
assert.equal(marketProvenanceForStoredItem("public_web", "unknown"), "search");
assert.equal(marketProvenanceForStoredItem("klook", "verified"), "verified");
assert.equal(marketProvenanceForStoredItem("roamly_internal", "search_ready"), "pack");
// Engine/pack-lane rows are NOT market bindings: no chip, no caution.
assert.equal(marketProvenanceForStoredItem("openstreetmap", "search_ready"), null);
assert.equal(marketProvenanceForStoredItem(undefined, "verified"), null);
assert.equal(marketProvenanceForStoredItem("", "DISCOVERY_SUGGESTION"), null);
assert.ok(SEARCH_RESULT_CAUTION.includes("Confirm current hours"), "itinerary-level caution keeps the full warning");

/* ------------------------------------------------------------------ */
/* 2. The stamping path                                                */
/* ------------------------------------------------------------------ */
const { enforceGroundedTimelineCandidates, sanitizeSearchBoundTimelineItems } =
  loadTsModule("lib/roamly/stagedItineraryGeneration.ts");

const baseResult = {
  provider: "Test provider",
  currency: "CAD",
  confidence: "medium",
  searched_at: "2026-09-24T12:00:00.000Z",
  expires_at: "2026-10-11T12:00:00.000Z",
  metadata: {}
};
const payload = {
  destination: "Montreal, Canada",
  destinationCity: "Montreal",
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  daysCount: 3,
  travelersCount: 1,
  budgetCurrency: "CAD",
  priceDiscovery: {
    marketResults: [
      { ...baseResult, id: "tour-1", category: "tour", title: "Old Montreal Walking Tour", source: "public_web", city: "Montreal", price_type: "search_ready" },
      { ...baseResult, id: "resto-1", category: "restaurant", title: "Resto Végo", source: "public_web", city: "Montreal", price_type: "search_ready" },
      { ...baseResult, id: "hotel-named", category: "hotel", title: "Hotel Bonaventure Montreal", source: "stay22", city: "Montreal", price_type: "live_partner", price_amount: 210 },
      { ...baseResult, id: "hotel-generic", category: "hotel", title: "Stay in Montreal city center hotel", source: "travelpayouts", city: "Montreal", price_type: "search_ready" },
      { ...baseResult, id: "flight-1", category: "flight", title: "Air Canada flight to Montreal", source: "travelpayouts", city: "Montreal", origin: "Saint John", price_type: "search_ready" },
      { ...baseResult, id: "pack-1", category: "attraction", title: "Montreal Botanical Garden", source: "roamly_internal", city: "Montreal", price_type: "search_ready", metadata: { retrieval_provider: "native" } },
      { ...baseResult, id: "tour-query", category: "tour", title: "Montreal, Canada walking highlights tour", source: "public_web", city: "Montreal", price_type: "search_ready" }
    ]
  },
  confirmedBookings: [{ title: "Hotel Bonaventure", booking_type: "hotel", provider_name: "Owner confirmation" }]
};

const item = (overrides = {}) => ({
  item_type: "activity",
  title: "Model title",
  description: "Model description",
  location_name: "Montreal",
  map_query: "Montreal",
  time_label: "10:00",
  startTime: "10:00",
  endTime: "11:00",
  estimated_cost: 999,
  ...overrides
});

const grounded = (overrides) =>
  enforceGroundedTimelineCandidates({ live_timeline: [item(overrides)] }, payload).live_timeline[0];

const tourStop = grounded({ candidateId: "tour-1" });
assert.equal(tourStop.description, "Tour · Montreal — a live search result, not a confirmed place.");

const mealStop = grounded({ candidateId: "resto-1", item_type: "meal", title: "Lunch" });
assert.equal(mealStop.description, "Restaurant · Montreal — found by live search, hours and price not confirmed.");

const namedHotel = grounded({ candidateId: "hotel-named", item_type: "hotel", title: "Hotel" });
assert.equal(namedHotel.description, "Hotel · Montreal — from a verified source, not a booked stay.");

const genericHotel = grounded({ candidateId: "hotel-generic", item_type: "hotel", title: "Hotel" });
assert.equal(genericHotel.description, "Hotel — not chosen yet · Montreal.");

const flightLeg = grounded({ candidateId: "flight-1", item_type: "travel", title: "Travel" });
assert.equal(flightLeg.description, "Flight · Saint John to Montreal — a live search result, times and price not confirmed.");

const packStop = grounded({ candidateId: "pack-1" });
assert.equal(packStop.description, "Attraction · Montreal — from Roamly's destination pack.");

const descriptions = [tourStop, mealStop, namedHotel, genericHotel, flightLeg, packStop].map((s) => s.description);
assert.equal(new Set(descriptions).size, descriptions.length, "every grounded stop reads differently");
for (const d of descriptions) {
  assert.ok(!d.includes(BOILERPLATE) && !d.includes("Confirm current hours"), `no boilerplate survives grounding: ${d}`);
}

// Confirmed bookings keep their own writer's text, untouched.
const confirmed = grounded({ item_type: "booking", plan_role: "protected_anchor", title: "Hotel Bonaventure", estimated_cost: 300 });
assert.equal(
  confirmed.description,
  "Owner confirmation. Keep this booking fixed; other plans must adapt around it."
);

// The sanitize/repair pass rebinds a search-query binding to an
// admissible candidate and composes the same one-liner — it must
// never re-stamp the paragraph onto an old itinerary.
const sanitized = sanitizeSearchBoundTimelineItems(
  {
    daily_itinerary: [
      {
        day_number: 1,
        live_timeline: [item({ candidateId: "tour-query", title: "Montreal, Canada walking highlights tour", description: BOILERPLATE })]
      }
    ]
  },
  payload
);
const rebound = sanitized.daily_itinerary[0].live_timeline[0];
// The pool is rank-ordered (itineraryMarketResults): the native
// pack candidate outranks the public-web tour, so the repair pass
// binds the garden — and composes the PACK line, not a search one.
assert.equal(rebound.title, "Montreal Botanical Garden");
assert.equal(rebound.description, "Attraction · Montreal — from Roamly's destination pack.");

/* ------------------------------------------------------------------ */
/* 3. Display flattening — old trips heal on screen                    */
/* ------------------------------------------------------------------ */
const { displayActivityDescription } = loadTsModule("lib/roamly/activityDescription.ts");

assert.equal(
  displayActivityDescription("Montreal, Canada walking highlights tour", BOILERPLATE, {
    category: "tour", itemType: "activity", city: "Montreal", provenance: "search"
  }),
  "Tour · Montreal — a live search result, not a confirmed place."
);
assert.equal(
  displayActivityDescription("Stay in Montreal city center hotel", BOILERPLATE, {
    category: "hotel", itemType: "hotel", city: "Montreal", provenance: "search", genericStay: true
  }),
  "Hotel — not chosen yet · Montreal."
);
// Generic-stay is also recognised from the row's own title.
assert.equal(
  displayActivityDescription("Stay in Montreal city center hotel", BOILERPLATE, {
    category: "hotel", itemType: "hotel", city: "Montreal", provenance: "search"
  }),
  "Hotel — not chosen yet · Montreal."
);
assert.equal(
  displayActivityDescription("Travel from Saint John to Montreal", BOILERPLATE, {
    category: "travel", itemType: "travel", city: "Montreal", origin: "Saint John", provenance: "search"
  }),
  "Travel · Saint John to Montreal — a live search result, times and price not confirmed."
);
assert.equal(
  displayActivityDescription("Hotel Bonaventure Montreal", VERIFIED_BOILERPLATE, {
    category: "hotel", itemType: "hotel", city: "Montreal", provenance: "verified"
  }),
  "Hotel · Montreal — from a verified source, not a booked stay."
);
// A pack row stamped with the search paragraph still heals as pack:
// the stored source outranks the stamp's wording.
assert.equal(
  displayActivityDescription("Montreal Botanical Garden", BOILERPLATE, {
    category: "attraction", itemType: "activity", city: "Montreal", provenance: "pack"
  }),
  "Attraction · Montreal — from Roamly's destination pack."
);
// Prefix-stamped real text renders unstamped; prefix + fallback
// tail (the stamp standing in for a missing description) composes.
assert.equal(
  displayActivityDescription("Resto Végo", "Search-backed result. A cozy spot the locals love."),
  "A cozy spot the locals love."
);
assert.equal(
  displayActivityDescription("Resto Végo", "Search-backed result. Confirm current hours, route, and price before going.", {
    category: "restaurant", itemType: "meal", city: "Montreal", provenance: "search"
  }),
  "Restaurant · Montreal — found by live search, hours and price not confirmed."
);
// No context at all: the stamp's own provenance still composes an
// honest generic line — never the paragraph.
assert.equal(
  displayActivityDescription("Some stop", BOILERPLATE),
  "Place — a live search result, not a confirmed place."
);
// Idempotent: a composed one-liner passes back through unchanged.
const oneLiner = "Tour · Montreal — a live search result, not a confirmed place.";
assert.equal(displayActivityDescription("Old Montreal Walking Tour", oneLiner), oneLiner);

/* Pack-lane (Quebec City proof shape) renders byte-identical:
 * engine text is never a stamp, so it passes through verbatim. */
assert.equal(
  displayActivityDescription("Jean Castor", "Jean Castor — planned for day 1 of this trip."),
  "Jean Castor — planned for day 1 of this trip."
);
assert.equal(
  displayActivityDescription("Hôtel La Maison Ste-Ursule", "Check in at Hôtel La Maison Ste-Ursule — your base for this trip."),
  "Check in at Hôtel La Maison Ste-Ursule — your base for this trip."
);
assert.equal(
  displayActivityDescription("Old Town Walk", "Walk from X to Y — about 4 min."),
  "Walk from X to Y — about 4 min."
);

/* Home-row builder: a raw stored stamp flattens here too (the
 * builder's defence path), QC rows keep provenance null, and the
 * day view flags search rows for the itinerary-level caution. */
const { toHomeRow, buildHomeDayView } = loadTsModule("lib/roamly/itineraryHome.ts");
const rowInput = (overrides = {}) => ({
  time: "2:00 PM",
  title: "Montreal, Canada walking highlights tour",
  description: BOILERPLATE,
  location: "Montreal",
  category: "tour",
  itemType: "activity",
  durationLabel: "120 min",
  travelLabel: "",
  mapQuery: "Montreal walking highlights tour",
  authority: "supporting",
  timeFromBooking: false,
  provenance: "search",
  ...overrides
});
const homeRow = toHomeRow(rowInput(), 0, 1);
assert.equal(
  homeRow.subtitle,
  "2h (est.) · Tour · Montreal — a live search result, not a confirmed place."
);
assert.equal(homeRow.provenance, "search");
const dayView = buildHomeDayView({ day_number: 1, date: "2026-10-30", rows: [rowInput()] }, "en");
assert.equal(dayView.hasSearchRows, true);

const qcRow = toHomeRow(
  rowInput({
    time: "9:00 AM",
    title: "Jean Castor",
    description: "Jean Castor — planned for day 1 of this trip.",
    location: "Old Québec",
    category: "attraction",
    durationLabel: "",
    mapQuery: "Jean Castor",
    provenance: undefined
  }),
  0,
  1
);
assert.equal(qcRow.provenance, null);
assert.ok(!qcRow.subtitle.includes("Search-backed"), "QC row carries no stamp");
const qcDay = buildHomeDayView(
  {
    day_number: 1,
    date: "2026-11-06",
    rows: [
      rowInput({
        title: "Jean Castor",
        description: "Jean Castor — planned for day 1 of this trip.",
        location: "Old Québec",
        category: "attraction",
        durationLabel: "",
        mapQuery: "Jean Castor",
        provenance: undefined
      })
    ]
  },
  "en"
);
assert.equal(qcDay.hasSearchRows, false);

/* ------------------------------------------------------------------ */
/* 4. Source discipline — the stamp is gone from the writers, and   */
/*    the render layer routes provenance through.                   */
/* ------------------------------------------------------------------ */
const stagedSource = fs.readFileSync(path.join(root, "lib/roamly/stagedItineraryGeneration.ts"), "utf8");
assert.ok(!stagedSource.includes(BOILERPLATE), "staged writer no longer stamps the search paragraph");
assert.ok(!stagedSource.includes(VERIFIED_BOILERPLATE), "staged writer no longer stamps the verified paragraph");
const intelligenceSource = fs.readFileSync(path.join(root, "lib/roamly/itineraryIntelligence.ts"), "utf8");
assert.ok(!intelligenceSource.includes("Search-backed result. "), "repair writer no longer prefixes the stamp");
assert.ok(!intelligenceSource.includes("Verified source result. "), "repair writer no longer prefixes the stamp");
const cardSource = fs.readFileSync(path.join(root, "components/trip/ItineraryDayPlan.tsx"), "utf8");
assert.match(cardSource, /displayActivityDescription\(title, strippedDescription, \{/);
assert.match(cardSource, /marketProvenanceForStoredItem\(/);
const panelSource = fs.readFileSync(path.join(root, "components/trip/ItineraryHomePanel.tsx"), "utf8");
assert.match(panelSource, /SEARCH_RESULT_CAUTION/);
assert.match(panelSource, /hasSearchBackedStops/);

console.log("Description boilerplate checks passed.");
