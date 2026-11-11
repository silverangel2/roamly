// roamly-gazetteer-eviction-checks.mjs — GAZETTEER EVICTION pins
// (Stage 8, 2026-11-11): the geonames (3.69 MB) + IATA airports
// (1.12 MB) data chunks used to sit in the INITIAL load graph of
// /trip/[id], /plan, /finds and the two admin test pages, because
// client components imported — directly or through the
// stayOptions → priceDiscovery → transportOptions chain — modules
// that statically import lib/roamly/placeResolver.ts /
// airportResolver.ts. Stage 8 severed the client graph at the
// pure-math seam: the functions the client components actually
// call now live in three DATA-FREE modules (budgetStatus,
// transportOptionMath, discoverySelection), and the server-side
// originals re-export the very same functions.
//
// Pins:
//   - reference equality: priceDiscovery.calculateBudgetStatus IS
//     budgetStatus.calculateBudgetStatus (and likewise for the
//     other moved functions) — the move cannot drift, ever;
//   - behaviour spot-values for the moved math (budget status
//     classes, transport cost averaging, the budget-constraint
//     text the plan form feeds the engine);
//   - the source contract: the light modules import no resolver /
//     link-builder module in any form; stayOptions takes
//     calculateBudgetStatus from budgetStatus and only TYPES from
//     priceDiscovery; TripPlanForm takes the two selection
//     functions from discoverySelection; the admin consoles take
//     destination labels from server-passed props, never from
//     tripMetadata.
//
// The build-manifest half of the proof (the chunks actually left
// the routes' initial graphs) lives in the Stage 8 report's
// before/after chunk tables — a source suite cannot see bundles.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { calculateBudgetStatus } from "../lib/roamly/budgetStatus.ts";
import {
  applyTransportOptionSelection,
  buildBudgetConstraintForItinerary
} from "../lib/roamly/discoverySelection.ts";
import { transportOptionCostCents } from "../lib/roamly/transportOptionMath.ts";
import * as priceDiscovery from "../lib/roamly/priceDiscovery.ts";
import * as transportOptions from "../lib/roamly/transportOptions.ts";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

// ---- reference equality: one implementation, two homes ----
ok(priceDiscovery.calculateBudgetStatus === calculateBudgetStatus, "priceDiscovery.calculateBudgetStatus must BE budgetStatus.calculateBudgetStatus");
ok(priceDiscovery.applyTransportOptionSelection === applyTransportOptionSelection, "priceDiscovery.applyTransportOptionSelection must BE discoverySelection.applyTransportOptionSelection");
ok(priceDiscovery.buildBudgetConstraintForItinerary === buildBudgetConstraintForItinerary, "priceDiscovery.buildBudgetConstraintForItinerary must BE discoverySelection.buildBudgetConstraintForItinerary");
ok(transportOptions.transportOptionCostCents === transportOptionCostCents, "transportOptions.transportOptionCostCents must BE transportOptionMath.transportOptionCostCents");

// ---- behaviour spot-values ----
const base = { budgetAmount: 1000, budgetCurrency: "CAD" };
assert.deepEqual(calculateBudgetStatus({ ...base, totalEstimateCents: 50_000 }), { budgetStatus: "within_budget", remainingBudgetCents: 50_000 });
assert.deepEqual(calculateBudgetStatus({ ...base, totalEstimateCents: 90_000 }), { budgetStatus: "tight", remainingBudgetCents: 10_000 });
assert.deepEqual(calculateBudgetStatus({ ...base, totalEstimateCents: 110_000 }), { budgetStatus: "over_budget", remainingBudgetCents: -10_000 });
assert.deepEqual(calculateBudgetStatus({ budgetAmount: null, budgetCurrency: "CAD", totalEstimateCents: 1 }), { budgetStatus: "unknown", remainingBudgetCents: null });
assert.deepEqual(
  calculateBudgetStatus({ ...base, totalEstimateCents: 1, committedBudgetCents: 5, committedBookingStatus: "known_mismatch" }),
  { budgetStatus: "unknown", remainingBudgetCents: null }
);
checks += 5;

ok(transportOptionCostCents({ estimated_cost_min: 100, estimated_cost_max: 200 }) === 15_000, "transportOptionCostCents averages min/max into cents");
ok(transportOptionCostCents({ estimated_cost_min: 42, estimated_cost_max: null }) === 4_200, "transportOptionCostCents falls back to the single bound");
ok(transportOptionCostCents(null) === null, "transportOptionCostCents(null) is null");
ok(transportOptionCostCents({ estimated_cost_min: null, estimated_cost_max: null }) === null, "transportOptionCostCents with no bounds is null");

// ---- the selection + constraint behaviour on a minimal discovery ----
const option = {
  mode: "train", title: "Train", estimated_cost_min: 100, estimated_cost_max: 140,
  availability: "search_ready", realistic: true, price_confidence: "cached_recent",
  budget_fit: "okay", presentation: "available", presentation_label: null,
  logic_rule: null, source: "test", warning: "", why_recommended: "fast"
};
const discovery = {
  budgetAmount: 1000, budgetCurrency: "CAD", budgetIncludesFlights: true,
  transportOptions: [option], recommendedTransportOption: option,
  flightEstimateCents: 12_000, selectedTransportEstimateCents: 12_000,
  totalEstimateCents: 62_000, bufferEstimateCents: 6_000,
  committedBudgetCents: null, committedBookingCostStatus: "known_compatible",
  budgetCategoryConfidence: [{ category: "transport", label: "x", amountCents: 0, source: "s", note: "n" }],
  transportSelection: null, priceCoverage: "market", cross_border: false,
  crossBorderWarnings: [], budgetStatus: "within_budget"
};
const applied = applyTransportOptionSelection(discovery, option);
ok(applied !== discovery && applied.transportSelection?.selectedBy === "traveler", "applyTransportOptionSelection stamps the traveller pick");
ok(applied.selectedTransportEstimateCents === 12_000, "applyTransportOptionSelection re-tabulates from transportOptionCostCents");
ok(applyTransportOptionSelection(discovery, { ...option, availability: "not_available" }) === discovery, "an unavailable option can never be applied");
const constraint = buildBudgetConstraintForItinerary(applied);
ok(constraint.includes("Traveller-selected transport"), "budget constraint names the traveller-selected transport");
ok(constraint.includes("Transport options:"), "budget constraint lists the options");

// ---- the source contract ----
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
for (const mod of ["lib/roamly/budgetStatus.ts", "lib/roamly/transportOptionMath.ts", "lib/roamly/discoverySelection.ts"]) {
  const src = read(mod);
  for (const banned of ["placeResolver", "airportResolver", "bookingLinks", "affiliateResolver", "travelMarketSearch"]) {
    const importPattern = new RegExp(`(?:from\\s+["'][^"']*${banned}["'])|(?:import\\s+["'][^"']*${banned}["'])`);
    ok(!importPattern.test(src), `${mod} must not import ${banned} in any form`);
  }
}
const stayOptions = read("lib/roamly/stayOptions.ts");
ok(stayOptions.includes('calculateBudgetStatus } from "@/lib/roamly/budgetStatus"'), "stayOptions imports calculateBudgetStatus from budgetStatus");
const stayPdImport = stayOptions.match(/import \{([^}]*)\} from "@\/lib\/roamly\/priceDiscovery";/s);
ok(!!stayPdImport && !/calculateBudgetStatus/.test(stayPdImport[1]) && /type BudgetCategoryConfidenceLabel/.test(stayPdImport[1]), "stayOptions imports only types from priceDiscovery");
const planForm = read("components/plan/TripPlanForm.tsx");
ok(planForm.includes('buildBudgetConstraintForItinerary\n} from "@/lib/roamly/discoverySelection";') || planForm.includes('from "@/lib/roamly/discoverySelection"'), "TripPlanForm imports the selection functions from discoverySelection");
for (const consoleFile of ["components/admin/AdminLiveTestConsole.tsx", "components/admin/LiveCompanionQaConsole.tsx"]) {
  const src = read(consoleFile);
  ok(!src.includes("tripMetadata"), `${consoleFile} must not import tripMetadata`);
  ok(src.includes("destinationLabels"), `${consoleFile} takes destinationLabels as a prop`);
}
for (const pageFile of ["app/admin/live-test/page.tsx", "app/admin/roamly/live-companion-test/page.tsx"]) {
  const src = read(pageFile);
  ok(src.includes("destinationLabels={Object.fromEntries"), `${pageFile} computes destinationLabels server-side`);
  ok(src.includes("getTripDestinationLabel"), `${pageFile} resolves labels with getTripDestinationLabel on the server`);
}

console.log(`gazetteer-eviction checks: ${checks} PASS`);
