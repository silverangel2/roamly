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

const { enforceGroundedTimelineCandidates } = loadTsModule("lib/roamly/stagedItineraryGeneration.ts");

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
      {
        id: "klook-museum",
        category: "attraction",
        title: "Montreal Museum of Fine Arts",
        provider: "Klook",
        source: "klook",
        city: "Montreal",
        currency: "CAD",
        price_amount: 42,
        price_type: "live_partner",
        confidence: "high",
        searched_at: "2026-09-24T12:00:00.000Z",
        expires_at: "2026-10-11T12:00:00.000Z",
        metadata: {}
      },
      {
        id: "public-event-1",
        category: "attraction",
        title: "Montreal Jazz Festival",
        provider: "Public event source",
        source: "public_web",
        city: "Montreal",
        start_date: "2026-10-11",
        currency: "CAD",
        price_type: "search_ready",
        confidence: "medium",
        searched_at: "2026-09-24T12:00:00.000Z",
        expires_at: "2026-10-11T12:00:00.000Z",
        metadata: {}
      }
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

const valid = enforceGroundedTimelineCandidates({ live_timeline: [item({
  candidateId: "klook-museum",
  title: "Invented museum name",
  source: "invented-provider",
  booking: { provider: "invented-provider", url: "https://evil.example/book", ctaLabel: "Book" },
  coordinates: { latitude: 1, longitude: 2 }
})] }, payload).live_timeline[0];
assert.equal(valid.title, "Montreal Museum of Fine Arts", "canonical candidate title wins");
assert.equal(valid.source, "klook", "canonical source wins");
assert.equal(valid.estimated_cost, 42, "canonical price wins");
assert.equal(valid.cost_status, "LIVE_SEARCH", "canonical price status is preserved");
assert.equal(valid.booking, undefined, "model booking URL is not persisted");
assert.equal(valid.coordinates, null, "model coordinates are not persisted");
assert.equal(valid.timing_status, "PLANNED", "model placement is not factual schedule evidence");

assert.equal(enforceGroundedTimelineCandidates({ live_timeline: [item({ candidateId: "invented-id" })] }, payload).live_timeline.length, 0, "invented candidate IDs are rejected");
assert.equal(enforceGroundedTimelineCandidates({ live_timeline: [item({ candidateId: "klook-museum", item_type: "hotel" })] }, payload).live_timeline.length, 0, "candidate category mismatch is rejected");
assert.equal(enforceGroundedTimelineCandidates({ live_timeline: [item({ source: "klook", title: "Unlisted venue" })] }, payload).live_timeline.length, 0, "specific ungrounded venue is rejected");
assert.equal(enforceGroundedTimelineCandidates({ live_timeline: [item({ title: "Free time in Old Montreal", description: "Explore at your own pace.", location_name: "Old Montreal" })] }, payload).live_timeline.length, 1, "generic free time survives");
assert.equal(enforceGroundedTimelineCandidates({ live_timeline: [item({ item_type: "meal", title: "Lunch nearby", location_name: "" })] }, payload).live_timeline.length, 1, "generic meal survives");

const unresolvedMustDo = enforceGroundedTimelineCandidates({ live_timeline: [item({ must_do: true, plan_role: "must_do", title: "Louvre Museum" })] }, payload).live_timeline[0];
assert.equal(unresolvedMustDo.factualStatus, "DISCOVERY_SUGGESTION", "unresolved must-do remains non-factual");
assert.equal(unresolvedMustDo.estimated_cost, null, "unresolved must-do has no invented price");

const confirmed = enforceGroundedTimelineCandidates({ live_timeline: [item({ item_type: "booking", plan_role: "protected_anchor", title: "Hotel Bonaventure", estimated_cost: 300 })] }, payload).live_timeline[0];
assert.equal(confirmed.title, "Hotel Bonaventure", "confirmed booking anchor survives");
assert.equal(confirmed.estimated_cost, null, "untrusted booking cost is removed before canonical repair");

const event = enforceGroundedTimelineCandidates({ live_timeline: [item({ candidateId: "public-event-1", title: "Wrong event" })] }, payload).live_timeline[0];
assert.equal(event.title, "Montreal Jazz Festival", "grounded public event is rehydrated");
assert.equal(event.source, "public_web", "public event provenance survives canonically");
assert.equal(enforceGroundedTimelineCandidates({ live_timeline: [item({ candidateId: "unknown-event", title: "Invented festival", category: "activity" })] }, payload).live_timeline.length, 0, "ungrounded public event is rejected");

const mixed = enforceGroundedTimelineCandidates({ live_timeline: [
  item({ candidateId: "klook-museum" }),
  item({ title: "Free time in Old Montreal", description: "Explore at your own pace.", location_name: "Old Montreal" }),
  item({ title: "Example Museum — $27", source: "Klook", location_name: "Montreal" })
] }, payload).live_timeline;
assert.equal(mixed.length, 2, "mixed output keeps grounded and generic items only");
assert.equal(mixed.some((entry) => entry.title.includes("Example Museum")), false, "invented specific venue is absent");

console.log("Grounded itinerary candidate checks passed.");
