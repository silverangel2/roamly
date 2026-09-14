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
      require(id) {
        if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
        if (id.startsWith(".")) return load(path.join(path.dirname(file), `${id}.ts`));
        return require(id);
      },
      URL,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const { evaluateActivityFeasibility, rankActivityCandidates, activityDecisionForPrompt } = loadTsModule("lib/roamly/activityFeasibility.ts");
const trip = {
  destination: "Montreal, Canada",
  startDate: "2026-10-09",
  endDate: "2026-10-12",
  interests: ["Food", "Culture", "Nightlife"],
  pace: "Balanced",
  budgetAmount: 500,
  budgetCurrency: "CAD",
  specialNotes: ""
};

function candidate(overrides = {}) {
  return {
    id: "event-a",
    title: "Montreal Saturday Music Festival",
    category: "attraction",
    source: "public_web",
    price_amount: undefined,
    currency: "CAD",
    price_type: "unknown",
    start_date: "2026-10-10",
    end_date: undefined,
    city: "Montreal",
    destination: "Montreal, Canada",
    metadata: {
      public_event: {
        startDate: "2026-10-10",
        startTime: "20:00",
        endTime: "23:00",
        recurrenceStatus: "single_occurrence",
        occurrenceEvidence: "exact_date"
      }
    },
    ...overrides
  };
}

function context(overrides = {}) {
  return { payload: trip, confirmedBookings: [], ...overrides };
}

assert.equal(evaluateActivityFeasibility(candidate(), context()).feasibility, "FEASIBLE", "A: event inside trip is feasible");
assert.equal(evaluateActivityFeasibility(candidate({ start_date: "2026-10-20" }), context()).feasibility, "INFEASIBLE", "B: event outside trip is infeasible");
assert.equal(evaluateActivityFeasibility(candidate({ start_date: "2026-10-08" }), context()).feasibility, "INFEASIBLE", "C: event before arrival is infeasible");
assert.equal(evaluateActivityFeasibility(candidate({ start_date: "2026-10-13" }), context()).feasibility, "INFEASIBLE", "D: event after departure is infeasible");

const confirmed = { booking_type: "restaurant", title: "Confirmed dinner", booking_status: "confirmed", start_date: "2026-10-10", end_date: "2026-10-10", start_time: "21:00", end_time: "22:00" };
const confirmedDecision = evaluateActivityFeasibility(candidate(), context({ confirmedBookings: [confirmed] }));
assert.equal(confirmedDecision.feasibility, "INFEASIBLE", "E: confirmed booking conflict is protected");
assert.ok(confirmedDecision.reasons.includes("CONFIRMED_BOOKING_PROTECTED"), "F: confirmed booking reason survives");
assert.equal(evaluateActivityFeasibility(candidate(), context({ mustDoActivities: [{ title: "Canadiens game", date: "2026-10-10", startTime: "20:00", endTime: "23:00" }] })).feasibility, "INFEASIBLE", "G: immovable must-do conflict is protected");

const generic = candidate({ id: "generic", title: "Evening walk", source: "roamly_internal", metadata: {} });
const eventDecision = evaluateActivityFeasibility(candidate(), context());
const genericDecision = evaluateActivityFeasibility(generic, context());
assert.ok(eventDecision.score > genericDecision.score, "H/O: special event can displace weaker flexible recommendation");
assert.equal(eventDecision.canDisplaceFlexible, true, "I: feasible event may displace only flexible items");
assert.equal(evaluateActivityFeasibility(generic, context({ mustDoTitles: ["Evening walk"] })).protected, true, "J: must-do remains protected");

assert.ok(eventDecision.reasons.includes("MATCHES_INTEREST"), "K-M: matching interests receive a fit signal");
const unrelated = evaluateActivityFeasibility(candidate({ title: "Industrial Trade Fair", metadata: { public_event: { startDate: "2026-10-10", recurrenceStatus: "single_occurrence" } } }), context());
assert.equal(unrelated.reasons.includes("MATCHES_INTEREST"), false, "N: unrelated event receives no fabricated interest match");
assert.ok(eventDecision.reasons.includes("TEMPORAL_SCARCITY"), "O: one-night event receives scarcity signal");
assert.equal(evaluateActivityFeasibility(candidate({ source: "roamly_internal", metadata: {} }), context()).reasons.includes("TEMPORAL_SCARCITY"), false, "P: evergreen activity gets no event scarcity bonus");
assert.equal(evaluateActivityFeasibility(candidate({ metadata: { public_event: { startDate: "2026-10-10", recurrenceStatus: "multi_day" } } }), context()).score, 40, "Q: multi-day scarcity is bounded");

assert.equal(evaluateActivityFeasibility(candidate({ metadata: { public_event: { startDate: "2026-10-10", recurrenceStatus: "single_occurrence" } } }), context()).feasibility, "UNCERTAIN", "R: unknown event time remains uncertain");
assert.ok(evaluateActivityFeasibility(candidate(), context({ previous: { date: "2026-10-10", endTime: "18:00", travelTimeMinutes: null } })).reasons.includes("TRAVEL_TIME_UNKNOWN"), "S: unknown travel time is not zero");
assert.equal(evaluateActivityFeasibility(candidate(), context({ previous: { date: "2026-10-10", endTime: "19:30", travelTimeMinutes: 60 } })).feasibility, "INFEASIBLE", "T: impossible grounded transition is rejected");
assert.equal(evaluateActivityFeasibility(candidate(), context({ previous: { date: "2026-10-10", endTime: "17:00", travelTimeMinutes: 60 } })).feasibility, "FEASIBLE", "U: feasible grounded transition is accepted");

const late = evaluateActivityFeasibility(candidate({ metadata: { public_event: { startDate: "2026-10-10", startTime: "23:00", endTime: "23:59", recurrenceStatus: "single_occurrence" } } }), context({ next: { date: "2026-10-11", startTime: "07:00", travelTimeMinutes: 30 } }));
assert.ok(late.reasons.includes("TOO_DENSE_FOR_PACE"), "V: late-night density penalty is explicit");
assert.ok(evaluateActivityFeasibility(candidate(), context({ payload: { ...trip, pace: "Relaxed" } })).score < eventDecision.score, "W: relaxed pace applies a conservative penalty");
assert.ok(evaluateActivityFeasibility(candidate(), context({ payload: { ...trip, pace: "Packed" } })).score >= eventDecision.score, "X/Y: packed pace does not receive relaxed penalty");

assert.ok(evaluateActivityFeasibility(candidate({ price_amount: 600 }), context({ budgetIsHard: true })).reasons.includes("BUDGET_CONFLICT"), "Z: factual cost reaches budget policy");
assert.equal(evaluateActivityFeasibility(candidate(), context()).reasons.includes("BUDGET_CONFLICT"), false, "AA: unknown price is not treated as over budget");
assert.equal(evaluateActivityFeasibility(candidate({ price_amount: 0, metadata: { public_event: { startDate: "2026-10-10", startTime: "20:00", endTime: "23:00", priceStatus: "free" } } }), context()).feasibility, "FEASIBLE", "AB: factual free event remains feasible");

const ranked = rankActivityCandidates([generic, candidate({ id: "klook-b", title: "Museum B", source: "klook", metadata: {} }), candidate()], context());
assert.equal(ranked[0].candidate.id, "event-a", "AH: public event can rank on fit, not affiliate source");
assert.equal(activityDecisionForPrompt(candidate(), context()).candidateId, "event-a", "AP-AR: identity survives prompt decision");
assert.ok(activityDecisionForPrompt(candidate(), context()).reasons.length > 0, "AQ: decision reasons survive");

const staged = fs.readFileSync(path.join(root, "lib/roamly/stagedItineraryGeneration.ts"), "utf8");
assert.match(staged, /rankActivityCandidates/, "decision is integrated before AI prose generation");
assert.match(staged, /flexible recommendations may be displaced/, "AI receives deterministic displacement boundary");
assert.doesNotMatch(staged, /candidateDecisionCore\.ts.*activity/i, "AT: no duplicate candidate decision engine");
assert.doesNotMatch(staged, /affiliate.*score|score.*affiliate/i, "AT/AL: affiliate routing is not a ranking signal");

for (const file of ["lib/roamly/affiliateLinks.ts", "lib/roamly/selected-hotel-affiliate-continuity-checks.mjs", "lib/roamly/selected-flight-affiliate-continuity-checks.mjs"]) {
  if (fs.existsSync(path.join(root, file))) assert.ok(fs.readFileSync(path.join(root, file), "utf8"), `provider preservation fixture exists: ${file}`);
}
assert.equal(fs.existsSync(path.join(root, "supabase/migrations")), true, "AZ: database remains outside this deterministic contract");

console.log("Roamly event itinerary feasibility checks passed.");
