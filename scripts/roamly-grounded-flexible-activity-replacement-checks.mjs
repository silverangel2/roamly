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
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, require, console, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: file });
  return sandbox.module.exports;
}

const repair = load("lib/roamly/itineraryRepair.ts");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260920_roamly_customer_activity_replacements.sql"), "utf8");
const source = fs.readFileSync(path.join(root, "lib/roamly/customerActivityReplacement.ts"), "utf8");
const dayId = "00000000-0000-4000-8000-000000000001";
const oldId = "00000000-0000-4000-8000-000000000002";
const laterId = "00000000-0000-4000-8000-000000000003";
const base = {
  booking_suggestions: [
    { candidateId: "old", category: "attraction", booking_category: "attraction", title: "Old", description: "", booking_status: "needs_booking" },
    { candidateId: "unrelated", category: "attraction", booking_category: "attraction", title: "Other", description: "", booking_status: "needs_booking" }
  ],
  estimated_budget_breakdown: { total_estimate_amount: null, budget_status: "unknown" },
  daily_itinerary: [{ day_id: dayId, day_number: 1, date: "2026-10-01", plan_status: "feasible", live_timeline: [
    { item_id: oldId, candidateId: "old", title: "Old", description: "", time_label: "10:00", startTime: "10:00", endTime: "11:00", location_name: "", estimated_cost: null, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", routing_status: "FEASIBLE" },
    { item_id: laterId, title: "Later", description: "", time_label: "14:00", startTime: "14:00", endTime: "15:00", location_name: "", estimated_cost: null, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", routing_status: "FEASIBLE" }
  ] }]
};
const target = repair.findCustomerRemovalTarget(base, dayId, oldId);
assert.equal(target.ok, true);
const replacement = { candidateId: "new", item: { ...base.daily_itinerary[0].live_timeline[0], candidateId: "new", title: "New grounded activity", item_id: oldId }, bookingSuggestion: { ...base.booking_suggestions[0], candidateId: "new", title: "New grounded activity" }, evidence: {}, fitReason: "Fits the selected day." };
const replaced = repair.replaceCustomerOptionalActivity(base, { dayId, itemId: oldId }, replacement);
assert.equal(replaced.daily_itinerary[0].live_timeline.find((item) => item.item_id === oldId)?.candidateId, "new", "exact target is replaced");
assert.equal(replaced.daily_itinerary[0].live_timeline.some((item) => item.item_id === laterId), true, "unrelated item remains");
assert.equal(repair.removeCustomerOptionalActivity(base, { dayId, itemId: oldId }).daily_itinerary[0].live_timeline.some((item) => item.item_id === oldId), false, "removal primitive remains unchanged");
assert.equal(base.daily_itinerary[0].live_timeline.find((item) => item.item_id === laterId)?.time_label, "14:00", "later schedule remains unchanged");
assert.equal(base.estimated_budget_breakdown.total_estimate_amount, null, "unknown budget remains unknown");
assert.equal(base.booking_suggestions.some((item) => item.candidateId === "unrelated"), true, "unrelated suggestion remains");

assert.match(source, /result\.source === "public_web"/);
assert.match(source, /expires_at/);
assert.match(source, /klookActivityActionState/);
assert.match(source, /evaluateActivityFeasibility/);
assert.match(migration, /REPLACE_OPTIONAL_ACTIVITY/);
assert.match(migration, /roamly_apply_customer_itinerary_replacement/);
assert.match(migration, /referred.*clicked/s);
assert.match(migration, /suggested.*needs_booking/s);
assert.match(migration, /booking_id/);
assert.match(migration, /revoke all on function public\.roamly_apply_customer_itinerary_replacement\(uuid, uuid\) from public, anon/);
assert.doesNotMatch(migration, /roamly_apply_planning_repair/);
assert.doesNotMatch(migration, /conflict_id/);
console.log("grounded flexible activity replacement checks passed");
