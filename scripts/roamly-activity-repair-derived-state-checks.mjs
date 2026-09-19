import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function load(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, require, console, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: file });
  return sandbox.module.exports;
}

const repair = load("lib/roamly/itineraryRepair.ts");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260919_roamly_planning_repair_derived_state.sql"), "utf8");
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004"
];

const base = {
  trip_title: "Repair test",
  destination_summary: "Test destination",
  best_for: [], route_reasoning: "", budget_fit_summary: "", booking_status_summary: "",
  free_or_low_cost_notes: [], estimated_budget_breakdown: {
    activities: "CAD 200", tickets_tours_estimate_amount: 200, total_estimate_amount: 400, budget_status: "within_budget"
  }, hotel_area_suggestions: [], transport_overview: "", packing_checklist: [], local_tips: [],
  safety_notes: [], emergency_notes: [], pre_trip_essentials: [], regenerate_suggestions: [],
  booking_suggestions: [
    { candidateId: "activity-1", category: "attraction", booking_category: "attraction", title: "Museum", description: "", booking_status: "needs_booking", booking_label: "Book activity", normal_search_url: "https://www.google.com/search?q=museum", estimated_cost_min: 100, estimated_cost_max: 100, currency: "CAD", price_confidence: "estimated" },
    { candidateId: "unrelated", category: "attraction", booking_category: "attraction", title: "Other museum", description: "", booking_status: "needs_booking", booking_label: "Book activity", normal_search_url: "https://www.google.com/search?q=other", estimated_cost_min: 100, estimated_cost_max: 100, currency: "CAD", price_confidence: "estimated" },
    { candidateId: "activity-1", category: "attraction", booking_category: "attraction", title: "Museum", description: "", booking_status: "REFERRED", booking_label: "Book activity", normal_search_url: "https://www.google.com/search?q=museum", estimated_cost_min: 100, estimated_cost_max: 100, currency: "CAD", price_confidence: "estimated" }
  ],
  daily_itinerary: [{
    day_number: 1, title: "Day 1", morning: "", afternoon: "", evening: "", food: [], estimated_cost: null,
    map_queries: [], plan_status: "conflict", flexible_items: ["Museum"], live_timeline: [
      { item_id: ids[0], conflict_id: ids[1], title: "Museum", candidateId: "activity-1", description: "", location_name: "", time_label: "10:00 AM", estimated_cost: 100, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", routing_status: "INFEASIBLE" },
      { item_id: ids[2], conflict_id: ids[1], title: "Free park", description: "", location_name: "", time_label: "2:00 PM", estimated_cost: 0, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", routing_status: "FEASIBLE" }
    ]
  }]
};

const identified = repair.assignStableItineraryIdentities(base, () => ids[3]);
const target = identified.daily_itinerary[0].live_timeline[0];
const repaired = repair.removeOptionalActivity(identified, { dayId: identified.daily_itinerary[0].day_id, conflictId: target.conflict_id, itemId: target.item_id });
assert.equal(repaired.daily_itinerary[0].live_timeline.some((item) => item.item_id === target.item_id), false, "exact timeline target is removed");
assert.equal(repaired.booking_suggestions.some((item) => item.candidateId === "activity-1" && item.booking_status === "needs_booking"), false, "exact unbooked linked suggestion is removed");
assert.equal(repaired.booking_suggestions.some((item) => item.candidateId === "activity-1" && item.booking_status === "REFERRED"), true, "referral evidence is preserved");
assert.equal(repaired.booking_suggestions.some((item) => item.candidateId === "unrelated"), true, "unrelated suggestion is preserved");
assert.equal(repaired.estimated_budget_breakdown.tickets_tours_estimate_amount, 200, "unlinked aggregate expense is not guessed away");
const repeatedDerivedState = repair.reconcileRemovedOptionalActivityDerivedState(repaired, target);
assert.deepEqual(repeatedDerivedState.itinerary, repaired, "repeated derived-state reconciliation is idempotent");
assert.equal(repeatedDerivedState.removedSuggestionCount, 0, "repeated reconciliation removes nothing twice");

const sameTitle = { ...identified, booking_suggestions: identified.booking_suggestions.map((item) => item.candidateId === "activity-1" ? { ...item, candidateId: "different" } : item) };
const sameTitleRemoved = repair.removeOptionalActivity(sameTitle, { dayId: sameTitle.daily_itinerary[0].day_id, conflictId: target.conflict_id, itemId: target.item_id });
assert.equal(sameTitleRemoved.booking_suggestions.length, sameTitle.booking_suggestions.length, "identity mismatch preserves suggestions");

const confirmed = { ...identified, booking_suggestions: identified.booking_suggestions.map((item) => item.candidateId === "activity-1" ? { ...item, booking_status: "confirmed" } : item) };
assert.equal(repair.findRepairTarget(confirmed, target.conflict_id, target.item_id).repairability, "NOT_REPAIRABLE", "confirmed linked activity is protected");

assert.match(migration, /create or replace function public\.roamly_apply_planning_repair/);
assert.match(migration, /target_candidate_id/);
assert.match(migration, /REPAIR_TARGET_HAS_BOOKING_EVIDENCE/);
assert.match(migration, /lower\(coalesce\(suggestion->>'booking_status'/);
assert.match(migration, /grant execute on function public\.roamly_apply_planning_repair\(uuid, uuid\) to authenticated/);
assert.doesNotMatch(migration, /title|description|estimated_cost_min.*=.*target/i, "migration does not use fuzzy or price matching");
console.log("activity repair derived-state checks passed");
