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

const { buildGuestDayPreview } = loadTsModule("lib/roamly/guestPlanPreview.ts");

function preview(overrides = {}) {
  return buildGuestDayPreview({
    tripType: "single_destination",
    origin: "Ottawa",
    destination: "Montreal",
    destinationCity: "Montreal",
    startDate: "2026-10-10",
    endDate: "2026-10-12",
    daysCount: 3,
    travelersCount: 2,
    budgetAmount: 1500,
    budgetCurrency: "CAD",
    travelStyle: "Balanced",
    interests: ["Culture"],
    pace: "Balanced",
    accommodationPreference: "Mid-range",
    transportationPreference: "Mixed",
    specialNotes: "",
    ...overrides
  });
}

function assertNoFabricatedCommerce(sample) {
  const json = JSON.stringify(sample);
  assert.doesNotMatch(json, /https?:\/\//i, "guest preview must not include booking or payment links");
  assert.doesNotMatch(json, /confirmed|checkout|payment|reserved|\$\d/i, "guest preview must not fabricate payments or bookings");
  assert.equal(sample.disclaimer, "Sample of day 1. Nothing is booked or charged.");
  assert.equal(
    JSON.stringify(sample.continuesBehindAccount),
    JSON.stringify(["Save this plan", "Regenerate the itinerary", "Continue past day 1"])
  );
  assert.equal(sample.blocks.length, 3);
}

const montreal = preview();
assert.equal(montreal.source, "known_place");
assert.equal(montreal.blocks[1].title, "Notre-Dame Basilica of Montreal");
assert.match(montreal.blocks[0].title, /Arrive from Ottawa/);
assert.equal(montreal.dateLabel, "2026-10-10");
assertNoFabricatedCommerce(montreal);

const nature = preview({ interests: ["Nature"] });
assert.equal(nature.blocks[1].title, "Mount Royal lookout");
assertNoFabricatedCommerce(nature);

const lisbon = preview({
  origin: "Toronto",
  destination: "Lisbon",
  destinationCity: "Lisbon",
  interests: ["Food"],
  priceDiscovery: {
    marketResults: [
      {
        category: "attraction",
        title: "Lisbon top attraction ticket",
        source: "roamly_internal",
        city: "Lisbon"
      }
    ]
  }
});
assert.equal(lisbon.source, "trip_inputs");
assert.equal(lisbon.blocks[1].title, "Food time in Lisbon");
assert.match(lisbon.blocks[1].detail, /does not invent a venue/);
assertNoFabricatedCommerce(lisbon);

const searchTemplates = preview({
  priceDiscovery: {
    marketResults: [
      {
        category: "attraction",
        title: "Montreal, Canada events festivals concerts nightlife 2026-10-10 to 2026-10-12",
        source: "roamly_internal",
        city: "Montreal"
      },
      {
        category: "attraction",
        title: "Notre-Dame Basilica Admission Ticket",
        source: "roamly_internal",
        city: "Montreal"
      },
      {
        category: "tour",
        title: "Montreal, Canada walking highlights tour",
        source: "roamly_internal",
        city: "Montreal"
      },
      {
        category: "restaurant",
        title: "restaurant reservations Montreal, Canada",
        source: "roamly_internal",
        city: "Montreal"
      },
      {
        category: "restaurant",
        title: "Montreal, Canada restaurants official menu reservations",
        source: "roamly_internal",
        city: "Montreal"
      }
    ]
  }
});
assert.equal(searchTemplates.source, "market_result");
assert.equal(searchTemplates.blocks[1].title, "Notre-Dame Basilica Admission Ticket");
assert.equal(searchTemplates.blocks[2].title, "Old Montreal");
assertNoFabricatedCommerce(searchTemplates);

const searched = preview({
  interests: ["Nature"],
  priceDiscovery: {
    marketResults: [
      {
        category: "flight",
        title: "Ottawa to Montreal flight",
        source: "travelpayouts",
        city: "Montreal"
      },
      {
        category: "attraction",
        title: "Montreal Museum of Fine Arts",
        source: "klook",
        city: "Montreal"
      },
      {
        category: "restaurant",
        title: "Schwartz's Deli",
        source: "public_web",
        city: "Montreal"
      }
    ]
  }
});
assert.equal(searched.source, "market_result");
assert.equal(searched.blocks[1].title, "Montreal Museum of Fine Arts");
assert.equal(searched.blocks[2].title, "Schwartz's Deli");
assert.doesNotMatch(searched.blocks[0].detail, /flight/);
assertNoFabricatedCommerce(searched);

const multiCity = preview({
  tripType: "multi_city",
  destination: "Quebec City → Montreal",
  destinationCity: "Montreal",
  destinationStops: [
    { label: "Quebec City", value: "Quebec City", city: "Quebec City", source: "custom" },
    { label: "Montreal", value: "Montreal", city: "Montreal", source: "custom" }
  ]
});
assert.match(multiCity.title, /Quebec City/);
assert.equal(multiCity.source, "trip_inputs");
assertNoFabricatedCommerce(multiCity);

const planForm = fs.readFileSync(path.join(root, "components/plan/TripPlanForm.tsx"), "utf8");
const previewSource = fs.readFileSync(path.join(root, "lib/roamly/guestPlanPreview.ts"), "utf8");
assert.match(planForm, /buildGuestDayPreview/);
assert.match(planForm, /data-guest-day-preview/);
assert.match(planForm, /guestPreview\.disclaimer/);
assert.match(previewSource, /Sample of day 1\. Nothing is booked or charged\./);
assert.match(planForm, /Create an account to save this plan, regenerate it, or continue past day 1\./);
assert.match(planForm, /Sign up to save and continue/);
assert.match(planForm, /Log in to save and continue/);
assert.match(planForm, /const PLAN_RESUME_PATH = "\/plan\?resumePlan=1&continueGenerate=1"/);
assert.match(
  planForm,
  /if \(!sessionUser && !apiAuthToken\) return;[\s\S]*resumeGenerateAttempted\.current = true;[\s\S]*void submitPlanRef\.current\?\.\(\)/
);
assert.match(planForm, /submitPlan\(generationPayload\)/);

const generateHandler = planForm.slice(planForm.indexOf('fetchWithSupabaseAuth("/api/trips/generate"'));
const unauthenticatedGenerate = generateHandler.slice(
  generateHandler.indexOf("if (response.status === 401)"),
  generateHandler.indexOf("if (response.ok && data?.tripId)")
);
assert.match(unauthenticatedGenerate, /showGuestDayPreview\(generationPayload\)/);
assert.doesNotMatch(unauthenticatedGenerate, /redirectToLoginForGeneration\(\)/);
assert.match(planForm, /redirectToLoginForGeneration\(\)/, "paid checkout still sends an unauthenticated save to login");
assert.match(planForm, /function redirectToLoginForGeneration\(\)/);
assert.match(planForm, /router\.push\(planLoginUrl\(\)\)/);

console.log("PASS: guest day-1 preview is real, unpaid, and still resumes after login");
