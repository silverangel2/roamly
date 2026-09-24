import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    if (path.extname(absolute) === ".json") return JSON.parse(fs.readFileSync(absolute, "utf8"));
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const local = path.join(path.dirname(file), id);
          return load(local.match(/\.(ts|tsx|json)$/) ? local : `${local}.ts`);
        }
        return require(id);
      },
      URL,
      URLSearchParams,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const { buildGroundedDecisionCore, candidateDecisionForAi, normalizeMarketCandidate, optimizeGroundedDecision } =
  loadTsModule("lib/roamly/candidateDecisionCore.ts");

const payload = (overrides = {}) => ({
  origin: "YFC",
  destination: "Montreal",
  startDate: "2026-10-10",
  endDate: "2026-10-14",
  travelersCount: 1,
  rooms: 1,
  budgetAmount: 500,
  budgetCurrency: "CAD",
  budgetIncludesFlights: true,
  budgetIncludesHotel: true,
  budgetIncludesActivities: true,
  travelStyle: "Balanced",
  interests: ["Culture"],
  pace: "Balanced",
  accommodationPreference: "Mid-range",
  transportationPreference: "Mixed",
  specialNotes: "",
  ...overrides
});

const market = (id, category, title, extra = {}) => ({
  id,
  category,
  title,
  provider: category === "hotel" ? "Stay22" : category === "attraction" ? "Klook" : "Travelpayouts",
  source: category === "hotel" ? "stay22" : category === "attraction" ? "klook" : "travelpayouts",
  currency: "CAD",
  price_type: "live_partner",
  price_amount: 100,
  booking_url: `https://example.test/${id}`,
  searched_at: "2026-09-11T12:00:00.000Z",
  start_date: "2026-10-10",
  end_date: "2026-10-14",
  metadata: { providerPayload: {} },
  ...extra
});

const flights = [
  market("ac", "flight", "Air Canada YFC-YUL", { metadata: { providerPayload: { airline: "Air Canada", stops: 0, total_price: 180, flight_numbers: ["AC101"] } } }),
  market("ws", "flight", "WestJet YFC-YUL", { price_amount: 80, metadata: { providerPayload: { airline: "WestJet", stops: 1, total_price: 80 } } })
];

const hard = buildGroundedDecisionCore({
  payload: payload({ constraints: { flight: { requiredAirlines: ["Air Canada"], nonstopRequired: { value: true, priority: "hard" } } } }),
  marketResults: flights
});
assert.deepEqual(Array.from(hard.eligibleCandidateIds), ["ac"]);

const soft = buildGroundedDecisionCore({
  payload: payload({ constraints: { flight: { preferredAirlines: ["Air Canada"] } } }),
  marketResults: flights
});
assert.equal(soft.eligibleCandidateIds.length, 2);
assert.ok(soft.recommendations.flight.BEST_MATCH);
assert.equal(normalizeMarketCandidate(market("stay", "hotel", "Fairmont The Queen Elizabeth"))?.sourceType, "referral");
assert.equal(normalizeMarketCandidate(market("stay", "hotel", "Fairmont The Queen Elizabeth"))?.factualStatus, "search_ready");
assert.equal(normalizeMarketCandidate(market("stay", "hotel", "Fairmont The Queen Elizabeth"))?.totalStayPrice, null);

const exact = buildGroundedDecisionCore({
  payload: payload({ explicitRequirements: [{ type: "activity", request: "CN Tower", priority: "hard" }] }),
  marketResults: [market("cn", "attraction", "CN Tower", { metadata: { providerPayload: { activity_id: "cn-1" } } })]
});
assert.equal(exact.unresolvedExactRequests.length, 0);
assert.deepEqual(Array.from(exact.selectedActivityCandidateIds), ["cn"]);

const travelerRequirements = buildGroundedDecisionCore({
  payload: payload({ accessibilityNeeds: "wheelchair access", dietaryPreference: "vegetarian" }),
  marketResults: [
    market("accessible-food", "attraction", "Accessible food tour", {
      metadata: { providerPayload: { accessibility_notes: ["wheelchair access"], dietary_notes: ["vegetarian"] } }
    }),
    market("unknown-food", "attraction", "Food tour without suitability metadata")
  ]
});
assert.equal(travelerRequirements.constraints.activity.accessibilityRequirements?.priority, "hard");
assert.equal(travelerRequirements.constraints.activity.accessibilityRequirements?.value?.[0], "wheelchair access");
assert.equal(travelerRequirements.constraints.activity.dietaryPreferences?.[0], "vegetarian");
assert.equal(travelerRequirements.eligibleCandidateIds.includes("accessible-food"), true, "grounded accessibility metadata remains eligible");
assert.equal(travelerRequirements.eligibleCandidateIds.includes("unknown-food"), true, "missing accessibility metadata remains unknown, not false");
assert.ok(travelerRequirements.recommendations.activity.rationale["accessible-food"].some((reason) => reason.includes("dietary fit evidence")), "dietary evidence reaches activity ranking");
assert.ok(travelerRequirements.recommendations.activity.rationale["accessible-food"].some((reason) => reason.includes("accessibility evidence")), "accessibility evidence reaches activity ranking");
assert.equal(candidateDecisionForAi(travelerRequirements).constraints.activity.dietaryPreferences?.[0], "vegetarian", "requirements reach AI decision context");
const mergedTravelerRequirements = buildGroundedDecisionCore({
  payload: payload({
    accessibilityNeeds: "wheelchair access",
    dietaryPreference: "vegetarian",
    constraints: { activity: { preferredActivities: ["museum"] } }
  }),
  marketResults: []
});
assert.equal(mergedTravelerRequirements.constraints.activity.preferredActivities?.[0], "museum", "existing activity constraints are preserved");
assert.equal(mergedTravelerRequirements.constraints.activity.accessibilityRequirements?.value?.[0], "wheelchair access", "direct accessibility needs survive constraint merging");
assert.equal(mergedTravelerRequirements.constraints.activity.dietaryPreferences?.[0], "vegetarian", "direct dietary preferences survive constraint merging");
const hotelAccessibility = buildGroundedDecisionCore({
  payload: payload({ accessibilityNeeds: "wheelchair access" }),
  marketResults: [
    market("hotel-unknown-access", "hotel", "Hotel without accessibility metadata"),
    market("hotel-accessible", "hotel", "Accessible hotel", { metadata: { providerPayload: { accessibility_notes: ["wheelchair access"] } } }),
    market("hotel-incompatible-access", "hotel", "Hotel with conflicting accessibility metadata", { metadata: { providerPayload: { accessibility_notes: ["stairs only"] } } })
  ]
});
assert.equal(hotelAccessibility.eligibleCandidateIds.includes("hotel-unknown-access"), true, "missing hotel accessibility metadata remains unknown, not false");
assert.equal(hotelAccessibility.eligibleCandidateIds.includes("hotel-accessible"), true, "matching hotel accessibility evidence remains eligible");
assert.equal(hotelAccessibility.eligibleCandidateIds.includes("hotel-incompatible-access"), false, "conflicting hotel accessibility evidence is filtered deterministically");
const unresolved = buildGroundedDecisionCore({
  payload: payload({ explicitRequirements: [{ type: "activity", request: "Louvre", priority: "hard" }] }),
  marketResults: [market("other", "attraction", "Eiffel Tower")]
});
assert.equal(unresolved.unresolvedExactRequests[0].status, "UNRESOLVED_EXACT_REQUEST");

const priced = buildGroundedDecisionCore({ payload: payload({ budgetAmount: 300 }), marketResults: [market("f", "flight", "Air Canada", { price_amount: 120, metadata: { providerPayload: { airline: "Air Canada", total_price: 120 } } })] });
assert.equal(priced.budgetLedger.lines.find((line) => line.candidateId === "f")?.priceStatus, "live_search");

const confirmed = buildGroundedDecisionCore({
  payload: payload({ budgetAmount: 300 }),
  marketResults: [market("hotel-1", "hotel", "Hotel A", { price_amount: 240 })],
  confirmedBookings: [{ booking_type: "hotel", title: "Hotel B", amount_cents: 90, currency: "CAD", provider_name: "Gmail confirmation" }]
});
assert.equal(confirmed.selectedHotelCandidateId, null);
assert.equal(confirmed.budgetLedger.lines.filter((line) => line.category === "hotel").length, 1);
assert.equal(confirmed.budgetLedger.lines.find((line) => line.category === "hotel")?.priceStatus, "confirmed");

const unknownActivity = buildGroundedDecisionCore({
  payload: payload({ explicitRequirements: [{ type: "activity", request: "CN Tower", priority: "hard" }] }),
  marketResults: [{ ...market("cn-search", "attraction", "CN Tower"), price_type: "search_ready", price_amount: undefined, booking_url: undefined }]
});
assert.equal(unknownActivity.budgetLedger.status, "BUDGET_UNCERTAIN");

const optimizedResult = optimizeGroundedDecision({ decision: buildGroundedDecisionCore({ payload: payload({ budgetAmount: 250, constraints: { flight: { preferredAirlines: ["Air Canada"] } } }), marketResults: [
  market("flight-expensive", "flight", "Air Canada", { price_amount: 180, metadata: { providerPayload: { airline: "Air Canada", total_price: 180 } } }),
  market("flight-cheap", "flight", "WestJet", { price_amount: 80, metadata: { providerPayload: { airline: "WestJet", total_price: 80 } } }),
  market("hotel", "hotel", "Hotel", { price_amount: 120, source: "hotel_provider", provider: "Hotel Provider" })
] }), payload: payload({ budgetAmount: 250 }) });
assert.ok(optimizedResult.tradeoffOptions.length >= 1);
assert.equal(optimizedResult.selectedFlightCandidateId, "flight-cheap");

const failedProvider = buildGroundedDecisionCore({ payload: payload(), marketResults: [{ ...market("failed", "flight", "No result"), price_type: "unknown", price_amount: undefined, booking_url: undefined }] });
assert.deepEqual(failedProvider.candidates[0].factualStatus, "unknown");
const aiInput = candidateDecisionForAi(exact);
assert.equal(aiInput.selectedActivities[0].candidateId, "cn");
assert.match(aiInput.policy, /Only selected candidates/);

console.log("Roamly candidate decision checks passed.");
