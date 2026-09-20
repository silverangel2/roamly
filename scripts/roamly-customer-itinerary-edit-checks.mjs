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
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260919_roamly_customer_itinerary_edits.sql"), "utf8");
const dayId = "00000000-0000-4000-8000-000000000001";
const activityId = "00000000-0000-4000-8000-000000000002";
const flightId = "00000000-0000-4000-8000-000000000003";

const base = {
  booking_suggestions: [
    { candidateId: "activity-1", category: "attraction", booking_category: "attraction", title: "Museum", description: "", booking_status: "needs_booking" },
    { candidateId: "other", category: "attraction", booking_category: "attraction", title: "Other", description: "", booking_status: "needs_booking" }
  ],
  estimated_budget_breakdown: { tickets_tours_estimate_amount: null, total_estimate_amount: null, budget_status: "unknown" },
  daily_itinerary: [{ day_id: dayId, day_number: 1, plan_status: "feasible", live_timeline: [
    { item_id: activityId, title: "Museum", description: "", time_label: "10:00 AM", location_name: "", estimated_cost: null, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", candidateId: "activity-1", routing_status: "FEASIBLE" },
    { item_id: flightId, title: "Flight", description: "", time_label: "18:00", location_name: "", estimated_cost: null, category: "Flight", map_query: "", item_type: "flight", plan_role: "protected_anchor", routing_status: "FEASIBLE" }
  ] }]
};

const target = repair.findCustomerRemovalTarget(base, dayId, activityId);
assert.equal(target.ok, true, "exact ordinary flexible activity is removable");
const removed = repair.removeCustomerOptionalActivity(base, { dayId, itemId: activityId });
assert.equal(removed.daily_itinerary[0].live_timeline.some((item) => item.item_id === activityId), false, "exact activity is removed");
assert.equal(removed.daily_itinerary[0].live_timeline.some((item) => item.item_id === flightId), true, "unrelated protected item remains");
assert.equal(removed.booking_suggestions.some((item) => item.candidateId === "activity-1"), false, "exact linked unbooked recommendation is reconciled");
assert.equal(removed.booking_suggestions.some((item) => item.candidateId === "other"), true, "unrelated recommendation remains");
assert.equal(removed.estimated_budget_breakdown.total_estimate_amount, null, "unknown budget remains unknown");

for (const item of [
  { id: flightId, item_type: "flight", plan_role: "protected_anchor" },
  { id: activityId, item_type: "activity", plan_role: "must_do", must_do: true },
  { id: activityId, item_type: "activity", plan_role: "primary" },
  { id: activityId, item_type: "activity", plan_role: "supporting", booking: { provider: "x", url: "https://example.com", ctaLabel: "Book" } }
]) {
  const candidate = { ...base, daily_itinerary: [{ ...base.daily_itinerary[0], live_timeline: [{ ...base.daily_itinerary[0].live_timeline[0], item_id: item.id, item_type: item.item_type, plan_role: item.plan_role, must_do: item.must_do, booking: item.booking }] }] };
  assert.equal(repair.findCustomerRemovalTarget(candidate, dayId, item.id).ok, false, `${item.plan_role} protected state is rejected`);
}

for (const status of ["confirmed", "needs_confirmation", "user_uploaded", "cancelled", "refunded"]) {
  const candidate = { ...base, booking_suggestions: [{ ...base.booking_suggestions[0], booking_status: status }] };
  assert.equal(repair.findCustomerRemovalTarget(candidate, dayId, activityId).ok, false, `${status} booking evidence is rejected`);
}

const referred = { ...base, booking_suggestions: [{ ...base.booking_suggestions[0], booking_status: "REFERRED" }] };
assert.equal(repair.findCustomerRemovalTarget(referred, dayId, activityId).ok, true, "referral evidence is not confirmation");
const referredRemoved = repair.removeCustomerOptionalActivity(referred, { dayId, itemId: activityId });
assert.equal(referredRemoved.booking_suggestions.some((item) => item.candidateId === "activity-1" && item.booking_status === "REFERRED"), true, "referral evidence is preserved");
const unknownBookingState = { ...base, booking_suggestions: [{ ...base.booking_suggestions[0], booking_status: "unrecognized" }] };
assert.equal(repair.findCustomerRemovalTarget(unknownBookingState, dayId, activityId).ok, false, "unknown booking state fails closed");
const mismatch = { ...base, booking_suggestions: [{ ...base.booking_suggestions[0], candidateId: "different" }] };
assert.equal(repair.removeCustomerOptionalActivity(mismatch, { dayId, itemId: activityId }).booking_suggestions.length, 1, "identity mismatch does not remove unrelated suggestion");
assert.throws(() => repair.removeCustomerOptionalActivity(base, { dayId, itemId: "00000000-0000-4000-8000-000000000004" }), /TARGET_NOT_FOUND/);

assert.match(migration, /create table if not exists public\.roamly_customer_itinerary_edits/);
assert.match(migration, /roamly_apply_customer_itinerary_edit/);
assert.match(migration, /target_item_id/);
assert.match(migration, /expected_content_hash/);
assert.match(migration, /CUSTOMER_EDIT_TARGET_PROTECTED/);
assert.match(migration, /CUSTOMER_EDIT_TARGET_BOOKING_PROTECTED/);
assert.match(migration, /grant execute on function public\.roamly_apply_customer_itinerary_edit\(uuid, uuid\) to authenticated, service_role/);
assert.doesNotMatch(migration, /roamly_apply_planning_repair/, "customer edit migration does not alter conflict repair RPC");
assert.doesNotMatch(migration, /conflict_id/, "customer edit migration does not fabricate conflict identity");
console.log("customer itinerary edit checks passed");
