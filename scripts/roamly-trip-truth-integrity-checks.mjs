import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

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
      Intl,
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          const existing = path.join(root, local);
          if (fs.existsSync(existing)) return JSON.parse(fs.readFileSync(existing, "utf8"));
          return load(`${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
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

const validation = loadTsModule("lib/roamly/travelResultValidation.ts");
assert.equal(validation.safeTravelIdentity("w3.org hotel"), "", "schema/domain contamination cannot become a place identity");
assert.equal(validation.safeTravelIdentity("schemas.live.com attraction"), "", "schema namespace contamination cannot become a place identity");
assert.equal(validation.safeTravelIdentity("https://example.com/place"), "", "URL metadata cannot become a place identity");
assert.equal(validation.safeTravelIdentity("Gothic Quarter"), "Gothic Quarter", "ordinary place names remain valid");

const itinerary = loadTsModule("lib/itinerary.ts");
const payload = {
  destination: "Halifax, Canada",
  destinationCity: "Halifax",
  destinationCountry: "Canada",
  origin: "Moncton, Canada",
  startDate: "2026-08-04",
  endDate: "2026-08-05",
  daysCount: 2,
  budgetAmount: 1200,
  budgetCurrency: "CAD",
  interests: [],
  travelStyle: "Balanced",
  pace: "Balanced",
  walkingTolerance: "Medium",
  accommodationPreference: "Not sure",
  transportationPreference: "Bus",
  travelersCount: 1
};
const normalized = itinerary.normalizeItinerary({
  estimated_budget_breakdown: { total_estimate: "CAD 37000" },
  daily_itinerary: [{
    day_number: 1,
    date: "2026-08-04",
    city: "Halifax",
    title: "Arrival",
    estimated_cost: 37000,
    live_timeline: [{
      title: "w3.org attraction",
      location_name: "schemas.live.com Halifax",
      map_query: "https://w3.org/TR/",
      startTime: "09:15",
      endTime: "11:15",
      estimated_cost: 7600,
      category: "attraction"
    }]
  }]
}, payload);
const first = normalized.daily_itinerary[0];
assert.equal(first.estimated_cost, null, "unsupported day cost remains unknown");
assert.equal(first.live_timeline[0].estimated_cost, null, "unsupported activity cost remains unknown");
assert.equal(first.live_timeline[0].title, "Unresolved place", "missing grounded identity remains unresolved");
assert.equal(first.live_timeline[0].location_name, "", "technical location metadata is removed");
assert.equal(first.live_timeline[0].timing_status, "PLANNED", "unsupported precision is labeled as planned");
assert.equal(itinerary.getItineraryTotalEstimateAmount(normalized), null, "unknown day costs do not become a total");

const live = loadTsModule("lib/roamly/liveCompanion.ts");
const completed = live.buildLiveCompanionState({
  trip: { id: "fixture", title: "Halifax", startDate: "2026-08-04", endDate: "2026-08-05", timezone: "America/Halifax", enabled: true },
  activities: [{ id: "activity", title: "A stop", startAt: "2026-08-04T10:00:00Z", endAt: "2026-08-04T11:00:00Z", status: "planned" }],
  permission: "granted",
  now: "2026-09-15T12:00:00Z"
});
assert.equal(completed.activationStatus, "completed_trip", "completed trips cannot activate Live");
const active = live.buildLiveCompanionState({
  trip: { id: "fixture", title: "Halifax", startDate: "2026-09-15", endDate: "2026-09-16", timezone: "America/Halifax", enabled: true },
  activities: [{ id: "activity", title: "A stop", startAt: "2026-09-15T10:00:00Z", endAt: "2026-09-15T11:00:00Z", status: "planned" }],
  permission: "granted",
  now: "2026-09-15T12:00:00Z"
});
assert.notEqual(active.activationStatus, "completed_trip", "active trips retain non-completed Live behavior");
assert.equal(live.fallbackRouteStatus(null).durationMinutes, null, "unavailable routing remains uncertain");

const liveClient = fs.readFileSync(path.join(root, "components/trip/LiveTripClient.tsx"), "utf8");
assert.ok(liveClient.includes("currentActivity && !tripCompleted"), "completed trips do not expose check-in/skip controls");
assert.ok(liveClient.includes("!tripCompleted ? <section"), "completed trips do not expose pause/resume controls");

console.log("Roamly trip truth integrity checks passed (identity quarantine, unknown pricing, planned timing, lifecycle boundaries, and unavailable routing).");
