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
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260916_roamly_planning_repairs.sql"), "utf8");
assert.ok(migration.includes("add column if not exists repair_revision"));
assert.ok(migration.includes("expected_content_hash") && migration.includes("before_snapshot"));
assert.ok(migration.includes("operation = 'REMOVE_OPTIONAL_ACTIVITY'"));
assert.ok(migration.includes("for update"));
assert.ok(migration.includes("STALE_ITINERARY_STATE"));
assert.ok(migration.includes("itinerary_locked = true or itinerary_generated_at is not null"));
assert.ok(migration.includes("status = 'applied'"));
assert.ok(migration.includes("grant execute on function public.roamly_apply_planning_repair"));
assert.ok(!migration.includes("drop policy if exists \"Roamly users update own itineraries\""), "existing generation update RLS must remain unchanged");
assert.ok(migration.includes("item->>'must_do'") && migration.includes("REPAIR_TARGET_PROTECTED_OR_NOT_INFEASIBLE"));
assert.ok(migration.includes("coalesce(item->>'conflict_id', '') <> proposal.conflict_id::text"));
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"];
let idIndex = 0;
const base = {
  trip_title: "Test trip",
  destination_summary: "Test destination",
  best_for: [], route_reasoning: "", budget_fit_summary: "", booking_status_summary: "",
  free_or_low_cost_notes: [], estimated_budget_breakdown: {}, hotel_area_suggestions: [], transport_overview: "",
  packing_checklist: [], local_tips: [], safety_notes: [], emergency_notes: [], booking_suggestions: [], pre_trip_essentials: [], regenerate_suggestions: [],
  daily_itinerary: [{
    day_number: 1, title: "Day 1", morning: "", afternoon: "", evening: "", food: [], estimated_cost: null,
    map_queries: [], plan_status: "conflict", flexible_items: ["Optional stop"], live_timeline: [
      { title: "Protected anchor", description: "", location_name: "", time_label: "", estimated_cost: null, category: "Travel", map_query: "", item_type: "travel", plan_role: "protected_anchor", routing_status: "FEASIBLE" },
      { title: "Optional stop", description: "", location_name: "", time_label: "", estimated_cost: null, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", routing_status: "INFEASIBLE" }
    ]
  }]
};

const identified = repair.assignStableItineraryIdentities(base, () => ids[idIndex++]);
const day = identified.daily_itinerary[0];
assert.ok(day.day_id && day.conflict_id, "days with proven conflicts receive stable identities");
assert.equal(day.live_timeline[0].item_id, ids[2], "each item receives an identity");
const target = repair.findRepairTarget(identified, day.live_timeline[1].conflict_id, day.live_timeline[1].item_id);
assert.equal(target.repairability, "REPAIRABLE");
const repaired = repair.removeOptionalActivity(identified, target.target);
assert.equal(repaired.daily_itinerary[0].live_timeline.length, 1, "only the approved optional item is removed");
assert.equal(repaired.daily_itinerary[0].live_timeline[0].title, "Protected anchor");
assert.equal(repair.verifyAppliedRepair({ itinerary: repaired, dayId: day.day_id, conflictId: day.live_timeline[1].conflict_id, targetItemId: day.live_timeline[1].item_id, validationOk: true }), "APPLIED_STILL_INFEASIBLE", "a persisted conflict remains unresolved until canonical status changes");
const resolved = { ...repaired, daily_itinerary: [{ ...repaired.daily_itinerary[0], plan_status: "coherent" }] };
assert.equal(repair.verifyAppliedRepair({ itinerary: resolved, dayId: day.day_id, conflictId: day.live_timeline[1].conflict_id, targetItemId: day.live_timeline[1].item_id, validationOk: true }), "APPLIED_RESOLVED");
assert.equal(repair.verifyAppliedRepair({ itinerary: resolved, dayId: day.day_id, conflictId: day.live_timeline[1].conflict_id, targetItemId: day.live_timeline[1].item_id, validationOk: false }), "APPLIED_UNCERTAIN");

const protectedTarget = repair.findRepairTarget(identified, day.live_timeline[1].conflict_id, day.live_timeline[0].item_id);
assert.equal(protectedTarget.repairability, "NOT_REPAIRABLE", "protected items cannot be repair targets");
const uncertain = repair.findRepairTarget({ ...identified, daily_itinerary: [{ ...day, plan_status: "uncertain" }] }, day.live_timeline[1].conflict_id, day.live_timeline[1].item_id);
assert.equal(uncertain.repairability, "NOT_REPAIRABLE", "uncertain days are not proven repair targets");
const legacy = repair.findRepairTarget({ ...identified, daily_itinerary: [{ ...day, day_id: undefined }] }, day.live_timeline[1].conflict_id, day.live_timeline[1].item_id);
assert.equal(legacy.repairability, "NOT_REPAIRABLE", "legacy identity-less days remain non-repairable");
assert.throws(() => repair.removeOptionalActivity(identified, { dayId: day.day_id, conflictId: day.live_timeline[1].conflict_id, itemId: day.live_timeline[0].item_id }), /REPAIR_TARGET_NOT_ALLOWED/);
const duplicate = { ...identified, daily_itinerary: [{ ...day, live_timeline: [...day.live_timeline, { ...day.live_timeline[1] }] }] };
assert.throws(() => repair.removeOptionalActivity(duplicate, { dayId: day.day_id, conflictId: day.live_timeline[1].conflict_id, itemId: day.live_timeline[1].item_id }), /REPAIR_TARGET_ID_NOT_UNIQUE/);
assert.deepEqual(repair.assignStableItineraryIdentities(identified, () => { throw new Error("must preserve existing ids"); }), identified);
console.log("roamly planning repair checks passed");
