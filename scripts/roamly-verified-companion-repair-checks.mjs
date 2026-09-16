import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file) {
  const source = read(file);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, require, console, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: file });
  return sandbox.module.exports;
}

const migration = read("supabase/migrations/20260916_roamly_verified_companion_repair.sql");
const engine = read("lib/roamly/companionRepairEngine.ts");
const impact = read("lib/roamly/companionImpactAnalysis.ts");
const trips = read("lib/trips.ts");
const overrides = read("lib/roamly/itineraryBookingOverrides.ts");
const orchestrator = read("lib/roamly/companionOrchestrator.ts");
const repair = load("lib/roamly/itineraryRepair.ts");

assert.match(migration, /operation text/);
assert.match(migration, /REMOVE_OPTIONAL_ACTIVITY/);
assert.match(migration, /expected_event_fingerprint/);
assert.match(migration, /expected_source_booking_updated_at/);
assert.match(migration, /companion_impact_results impact/);
assert.match(migration, /booking_change_events/);
assert.match(migration, /processed_at is not null/);
assert.match(migration, /COMPANION_REPAIR_EVENT_NOT_CURRENT/);
assert.match(migration, /COMPANION_REPAIR_EVENT_SUPERSEDED/);
assert.match(migration, /newer\.event_type in \('flight_delayed', 'flight_time_changed', 'flight_cancelled'\)/);
assert.match(migration, /newer\.detected_at > source_event\.detected_at/);
assert.match(migration, /create trigger booking_change_events_source_lock/);
assert.match(migration, /roamly_lock_booking_change_source/);
assert.match(migration, /grant execute on function public\.roamly_lock_booking_change_source\(\) to service_role/);
assert.match(migration, /affected->>'day_id'/);
assert.match(migration, /affected->>'item_id'/);
assert.match(migration, /affected->>'conflict_id'/);
assert.match(migration, /for share;/);
assert.match(migration, /for update;/);
assert.match(migration, /cross join lateral jsonb_array_elements\(impact\.affected_items_json\)/);
assert.match(migration, /impact_target_matches <> 1/);
assert.match(migration, /status = 'applied'/);
assert.match(migration, /verification_status = 'pending'/);
assert.match(migration, /verification_status in \('resolved', 'still_affected', 'uncertain'\)/);
assert.match(migration, /applied_revision is not null/);
assert.match(migration, /applied_content_hash is not null/);
assert.match(migration, /applied_at is not null/);
assert.match(migration, /verification_status is null\s+and verified_at is null/);
assert.match(migration, /revoke all on function public\.roamly_apply_verified_companion_repair/);
assert.match(migration, /grant execute on function public\.roamly_apply_verified_companion_repair.*authenticated/);
assert.doesNotMatch(migration, /grant execute on function public\.roamly_apply_verified_companion_repair.*public/i);

assert.match(impact, /day_id:/);
assert.match(engine, /verifiedRepairContext/);
assert.match(engine, /exactOptionalActivity/);
assert.match(engine, /candidates\.length !== 1/);
assert.match(engine, /operation: "REMOVE_OPTIONAL_ACTIVITY"/);
assert.match(engine, /expected_revision/);
assert.match(engine, /expected_content_hash/);
assert.match(engine, /expected_event_fingerprint/);
assert.match(engine, /expected_source_booking_updated_at/);
assert.match(engine, /roamly_apply_verified_companion_repair/);
assert.match(engine, /verifyAppliedVerifiedCompanionRepair/);
assert.match(engine, /getTripBundle\(params\.supabase/);
assert.match(engine, /validateItineraryDeterministically/);
assert.match(engine, /deriveTripReadiness/);
assert.match(engine, /classifyVerifiedCompanionRepair/);
assert.match(engine, /verification_status.*pending/);
assert.match(engine, /\.eq\("verification_status", "pending"\)/);
assert.match(engine, /expected_source_booking_updated_at/);
assert.ok(engine.indexOf('proposalResult.data.operation === "REMOVE_OPTIONAL_ACTIVITY"') < engine.indexOf("try {", engine.indexOf('proposalResult.data.operation === "REMOVE_OPTIONAL_ACTIVITY"')));

assert.match(read("app/api/trips/[id]/companion/repairs/[repairId]/approve/route.ts"), /approveCompanionRepairProposal/);
assert.match(read("components/roamly/CompanionRepairCenter.tsx"), /Approval removes this one conflicting optional activity/);
assert.match(read("components/roamly/CompanionRepairCenter.tsx"), /Applied — verifying current itinerary/);
assert.match(read("app/api/trips/[id]/adjust-live-day/route.ts"), /ITINERARY_LOCKED/);

assert.match(trips, /select\("id,repair_revision"\)/);
assert.match(trips, /\.eq\("repair_revision", safeExistingRepairRevision as number\)/);
assert.match(overrides, /select\("id,full_json,repair_revision"\)/);
assert.match(overrides, /repair_revision: repairRevision \+ 1/);
assert.match(overrides, /\.eq\("repair_revision", repairRevision\)/);
assert.match(orchestrator, /A timing disruption without an exact V1 repair target is not resolved/);
assert.match(orchestrator, /\["flight_delayed", "flight_time_changed"\]\.includes\(params\.eventType\)/);

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005"
];
let idIndex = 0;
const itinerary = {
  trip_title: "Disruption test",
  destination_summary: "Test",
  best_for: [], route_reasoning: "", budget_fit_summary: "", booking_status_summary: "",
  free_or_low_cost_notes: [], estimated_budget_breakdown: {}, hotel_area_suggestions: [], transport_overview: "",
  packing_checklist: [], local_tips: [], safety_notes: [], emergency_notes: [], booking_suggestions: [], pre_trip_essentials: [], regenerate_suggestions: [],
  daily_itinerary: [{
    day_number: 1, title: "Day 1", morning: "", afternoon: "", evening: "", food: [], estimated_cost: null,
    map_queries: [], plan_status: "conflict", live_timeline: [
      { title: "Flight", description: "", location_name: "", time_label: "", estimated_cost: null, category: "Travel", map_query: "", item_type: "travel", plan_role: "protected_anchor", routing_status: "FEASIBLE" },
      { title: "Optional activity", description: "", location_name: "", time_label: "", estimated_cost: null, category: "Activity", map_query: "", item_type: "activity", plan_role: "supporting", must_do: false, routing_status: "INFEASIBLE" }
    ]
  }]
};
const identified = repair.assignStableItineraryIdentities(itinerary, () => ids[idIndex++]);
const day = identified.daily_itinerary[0];
const target = day.live_timeline[1];
assert.ok(day.day_id && day.conflict_id && target.item_id && target.conflict_id);
assert.equal(repair.findRepairTarget(identified, target.conflict_id, target.item_id).repairability, "REPAIRABLE");
assert.equal(repair.removeOptionalActivity(identified, { dayId: day.day_id, conflictId: target.conflict_id, itemId: target.item_id }).daily_itinerary[0].live_timeline.length, 1);
assert.deepEqual(repair.assignStableItineraryIdentities(identified, () => { throw new Error("identity regenerated"); }), identified);

const relevantSuperseders = new Set(["flight_delayed", "flight_time_changed", "flight_cancelled"]);
function isSuperseded(original, candidates) {
  return candidates.some((candidate) =>
    candidate.bookingId === original.bookingId &&
    candidate.tripId === original.tripId &&
    candidate.userId === original.userId &&
    relevantSuperseders.has(candidate.eventType) &&
    (candidate.detectedAt > original.detectedAt ||
      (candidate.detectedAt === original.detectedAt && candidate.createdAt > original.createdAt) ||
      (candidate.detectedAt === original.detectedAt && candidate.createdAt === original.createdAt && candidate.id !== original.id))
  );
}
const eventA = { id: "a", bookingId: "booking-1", tripId: "trip-1", userId: "user-1", eventType: "flight_delayed", detectedAt: "2026-09-16T10:00:00.000Z", createdAt: "2026-09-16T10:00:00.000Z" };
assert.equal(isSuperseded(eventA, [{ ...eventA, id: "b", eventType: "flight_time_changed", detectedAt: "2026-09-16T10:01:00.000Z", createdAt: "2026-09-16T10:01:00.000Z" }]), true, "newer timing event supersedes Event A");
assert.equal(isSuperseded(eventA, [{ ...eventA, id: "c", eventType: "flight_cancelled", detectedAt: "2026-09-16T10:01:00.000Z", createdAt: "2026-09-16T10:01:00.000Z" }]), true, "newer cancellation supersedes Event A");
assert.equal(isSuperseded(eventA, [{ ...eventA, id: "d", eventType: "booking_updated", detectedAt: "2026-09-16T10:01:00.000Z", createdAt: "2026-09-16T10:01:00.000Z" }]), false, "unrelated booking update does not supersede Event A");
assert.equal(isSuperseded(eventA, [{ ...eventA, id: "e", bookingId: "booking-2", eventType: "flight_time_changed", detectedAt: "2026-09-16T10:01:00.000Z", createdAt: "2026-09-16T10:01:00.000Z" }]), false, "different booking does not supersede Event A");
assert.equal(isSuperseded(eventA, [{ ...eventA, id: "f", eventType: "flight_time_changed", detectedAt: "2026-09-16T10:01:00.000Z", createdAt: "2026-09-16T10:01:00.000Z", userId: "other" }]), false, "different user does not supersede Event A");

console.log("verified companion repair checks passed");
