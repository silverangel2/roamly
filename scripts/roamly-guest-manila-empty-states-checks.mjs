// Stream 5 (Manila honest empty states) — local proof against the real
// lib/roamly/guestItineraryView.ts, on stored-JSON-shaped fixtures.
//
// (a) Fully empty days (legacy generic filler stored) -> honest empty
//     state in every window, zero legacy filler strings in the output,
//     honest day titles.
// (b) Partially empty day -> only the empty windows show the honest
//     state; real content and the stored title are untouched.
// (c) Empty flights array -> no cards, the caller-supplied Aviasales
//     search link is carried through, zero fabricated options; an
//     untrusted (non-Aviasales) link is dropped, never surfaced.
// (d) Populated flights -> cards render unchanged (regression case).
// (e) Generation layer (source check): the zero-engine no longer emits
//     any legacy generic filler string; it writes the shared honest
//     empty-window text instead.
// (f) Wiring (source checks): the guest component renders the honest
//     empty-flights section and the guest route builds the search link
//     via the standing Travelpayouts/Aviasales builder.
//
// Fixture place names are synthetic ("Test Stop 1") on purpose: this
// script proves rendering rules, it never claims a real place, flight,
// price, or time. The actual stored Manila trip is NOT read here (guest
// cookie-gated, RLS-scoped) and remains NOT VERIFIED until post-deploy
// or Junel opens it himself.

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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      process,
      URL,
      URLSearchParams,
      Buffer,
      Date,
      setTimeout,
      clearTimeout,
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const local = path.join(path.dirname(file), id);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith("node:")) return require(id.slice(5));
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

const {
  publicGuestItineraryView,
  GUEST_EMPTY_WINDOW_TEXT,
  GUEST_LEGACY_GENERIC_FILLER_TEXTS,
  GUEST_NO_FLIGHTS_TEXT
} = loadTsModule("lib/roamly/guestItineraryView.ts");

const LEGACY = [...GUEST_LEGACY_GENERIC_FILLER_TEXTS];
const AVIASEARCH = "https://www.aviasales.com/search/YSJ0106MNL01061";

function readyView(fullJson, extra = {}) {
  return publicGuestItineraryView({
    tripTitle: "Manila trip",
    destination: "Manila",
    itineraryStatus: "generated",
    fullJson,
    ...extra
  });
}

function legacyDay(dayNumber, title) {
  return {
    day_number: dayNumber,
    date: `2026-11-0${dayNumber}`,
    title,
    morning: LEGACY[0],
    afternoon: LEGACY[1],
    evening: LEGACY[2],
    food: [],
    live_timeline: []
  };
}

// (a) Fully empty days: Manila days 4-6 shape — legacy filler stored,
// no food, no timeline, stop-named stored titles.
const emptyDays = readyView(
  {
    trip_title: "Manila trip",
    destination_summary: "Six days in Manila.",
    generation_note: "Generated through Roamly staged AI generation.",
    booking_suggestions: [],
    daily_itinerary: [legacyDay(4, "Day 4: Test Stop 1"), legacyDay(5, "Day 5: Test Stop 2"), legacyDay(6, "Day 6: Test Stop 3")]
  },
  { flightSearchUrl: AVIASEARCH }
);
assert.equal(emptyDays.status, "ready");
assert.equal(emptyDays.days.length, 3);
for (const day of emptyDays.days) {
  assert.equal(day.morning, GUEST_EMPTY_WINDOW_TEXT);
  assert.equal(day.afternoon, GUEST_EMPTY_WINDOW_TEXT);
  assert.equal(day.evening, GUEST_EMPTY_WINDOW_TEXT);
  assert.equal(day.title, `Day ${day.dayNumber} in Manila`);
}
const emptyJson = JSON.stringify(emptyDays);
for (const filler of LEGACY) assert.doesNotMatch(emptyJson, new RegExp(filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(emptyJson, /Nothing planned here yet/);

// (b) Partially empty day: only the empty windows change.
const partial = readyView({
  trip_title: "Manila trip",
  destination_summary: "Six days in Manila.",
  generation_note: "Generated through Roamly staged AI generation.",
  booking_suggestions: [],
  daily_itinerary: [
    {
      day_number: 1,
      date: "2026-11-01",
      title: "Day 1: Test Stop 1",
      morning: "Test Stop 1 · Test Stop 2",
      afternoon: LEGACY[1],
      evening: "",
      food: ["Test Food 1"],
      live_timeline: [{ time_label: "09:00", title: "Test Stop 1" }]
    }
  ]
});
assert.equal(partial.days[0].morning, "Test Stop 1 · Test Stop 2");
assert.equal(partial.days[0].afternoon, GUEST_EMPTY_WINDOW_TEXT);
assert.equal(partial.days[0].evening, GUEST_EMPTY_WINDOW_TEXT);
assert.equal(partial.days[0].title, "Day 1: Test Stop 1");
assert.doesNotMatch(JSON.stringify(partial.days[0]), new RegExp(LEGACY[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

// Legacy filler via the metadata-days path renders honestly too.
const viaMetadata = publicGuestItineraryView({
  destination: "Manila",
  tripStatus: "generating",
  metadata: {
    generation: {
      status: "generating",
      generatedDays: { 4: legacyDay(4, "Day 4: Test Stop 1") }
    }
  }
});
assert.equal(viaMetadata.days[0].morning, GUEST_EMPTY_WINDOW_TEXT);
assert.equal(viaMetadata.days[0].title, "Day 4 in Manila");

// (c) Empty flights: honest section data + search link, zero options.
assert.equal(emptyDays.flights.length, 0);
assert.equal(emptyDays.flightSearchUrl, AVIASEARCH);
assert.equal(typeof GUEST_NO_FLIGHTS_TEXT, "string");
assert.match(GUEST_NO_FLIGHTS_TEXT, /No flight options found/);
// Untrusted links are dropped, never surfaced to a guest.
const untrusted = readyView(
  { trip_title: "Manila trip", destination_summary: "x", generation_note: "Generated through Roamly staged AI generation.", booking_suggestions: [], daily_itinerary: [legacyDay(1, "Day 1")] },
  { flightSearchUrl: "https://evil.example/flights" }
);
assert.equal(untrusted.flightSearchUrl, null);
// No supplied link: null (older API responses keep the old hidden-section behaviour).
const noLink = readyView({
  trip_title: "Manila trip",
  destination_summary: "x",
  generation_note: "Generated through Roamly staged AI generation.",
  booking_suggestions: [],
  daily_itinerary: [legacyDay(1, "Day 1")]
});
assert.equal(noLink.flightSearchUrl, null);

// (d) Populated flights: unchanged rendering with real cards.
const populated = readyView({
  trip_title: "Manila trip",
  destination_summary: "Six days in Manila.",
  generation_note: "Generated through Roamly staged AI generation.",
  booking_suggestions: [
    {
      title: "Test Flight Option",
      affiliate_url: "https://www.aviasales.com/search/YSJ0106MNL01061",
      booking_category: "flight",
      affiliate_provider: "Travelpayouts",
      why_recommended: "Test flight search result."
    },
    {
      title: "Test Stay Option",
      affiliate_url: "https://example.test/stay",
      booking_category: "hotel",
      estimated_nightly_cost_min: 100,
      estimated_nightly_cost_max: 120,
      currency: "CAD"
    }
  ],
  daily_itinerary: [
    {
      day_number: 1,
      date: "2026-11-01",
      title: "Day 1: Test Stop 1",
      morning: "Test Stop 1",
      afternoon: "Test Stop 2",
      evening: "Test Food 1",
      food: ["Test Food 1"],
      live_timeline: [{ time_label: "09:00", title: "Test Stop 1" }]
    }
  ]
});
assert.equal(populated.flights.length, 1);
assert.equal(populated.flights[0].title, "Test Flight Option");
assert.equal(populated.flights[0].url, "https://www.aviasales.com/search/YSJ0106MNL01061");
assert.equal(populated.stays.length, 1);
assert.equal(populated.stays[0].title, "Test Stay Option");

// (e) Generation layer: no legacy filler remains in the engine driver.
const generateSrc = fs.readFileSync(path.join(root, "lib/roamly/engine/generate.ts"), "utf8");
for (const filler of LEGACY) assert.doesNotMatch(generateSrc, new RegExp(filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(generateSrc, /GUEST_EMPTY_WINDOW_TEXT/);
assert.match(generateSrc, /import \{ GUEST_EMPTY_WINDOW_TEXT \} from "@\/lib\/roamly\/guestItineraryView"/);

// (f) Wiring: component renders the honest empty-flights section;
// route builds the search link with the standing Aviasales builder.
const componentSrc = fs.readFileSync(path.join(root, "components/plan/GuestFreeItinerary.tsx"), "utf8");
assert.match(componentSrc, /GUEST_NO_FLIGHTS_TEXT/);
assert.match(componentSrc, /itinerary\.flightSearchUrl/);
assert.match(componentSrc, /Flights & getting there/);
const routeSrc = fs.readFileSync(path.join(root, "app/api/trips/guest-itinerary/route.ts"), "utf8");
assert.match(routeSrc, /buildAviasalesDeepLink/);
assert.match(routeSrc, /flightSearchUrl/);
assert.match(routeSrc, /GUEST_AVIASALES_SEARCH_URL/);

console.log("manila-empty-states: OK");
console.log(`  empty day windows -> ${JSON.stringify(GUEST_EMPTY_WINDOW_TEXT)}`);
console.log("  legacy filler strings in empty-day output: 0");
console.log(`  empty flights -> flights=[] flightSearchUrl=${AVIASEARCH}`);
console.log("  populated flights -> 1 card unchanged (title + url preserved)");
console.log("  generation layer -> 0 legacy filler strings, honest text shared");
