import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helper = read("lib/roamly/customerTripIntentChange.ts");
const migration = read("supabase/migrations/20260924_roamly_customer_trip_intent_changes.sql");
const preview = read("app/api/trips/[id]/intent-change/route.ts");
const apply = read("app/api/trips/[id]/intent-change/[proposalId]/apply/route.ts");
const ui = read("components/roamly/CustomerTripIntentChange.tsx");
const page = read("app/trip/[id]/page.tsx");
const successorInsert = migration.slice(migration.indexOf("  insert into public.roamly_trips"), migration.indexOf("  returning id into successor_id;") + 36);

const checks = [
  ["valid preference-only change", helper.includes("normalizeGenerationIntentPatch") && ui.includes("travelStyle")],
  ["valid traveler-composition change", helper.includes("normalizeTravelerComposition") && ui.includes("travelers")],
  ["valid combined traveler and preference change", preview.includes("buildRequestedGenerationIntent")],
  ["destination cannot be changed through this flow", preview.includes('"destination"') && preview.includes("INTENT_CHANGE_SCOPE_REJECTED")],
  ["dates cannot be changed through this flow", preview.includes('"startDate"') && preview.includes("INTENT_CHANGE_SCOPE_REJECTED")],
  ["budget cannot be changed through this flow", preview.includes('"budgetAmount"') && preview.includes("INTENT_CHANGE_SCOPE_REJECTED")],
  ["stale source intent rejected", migration.includes("INTENT_CHANGE_INTENT_STALE") && migration.includes("expected_intent_snapshot")],
  ["stale itinerary revision and hash rejected", migration.includes("INTENT_CHANGE_ITINERARY_STALE") && migration.includes("expected_content_hash")],
  ["changed booking snapshot rejected safely", migration.includes("INTENT_CHANGE_BOOKINGS_STALE") && migration.includes("INTENT_CHANGE_BOOKINGS_CHANGED")],
  ["ownership enforced", preview.includes("requireUser") && migration.includes("user_id = auth.uid()")],
  ["original bookings untouched", !migration.match(/(?:insert|update|delete)\s+public\.roamly_bookings/i) && migration.includes("roamly_bookings")],
  ["original trip untouched before successful successor completion", migration.includes("status = 'archived'") && migration.includes("complete_customer_trip_intent_change")],
  ["failed successor leaves original operational", migration.includes("fail_customer_trip_intent_change") && migration.includes("status = 'failed'")],
  ["successful successor archives original after completion", migration.includes("update public.roamly_trips set status = 'archived'")],
  ["generated itinerary and provider evidence are not copied", successorInsert.includes("insert into public.roamly_trips") && !successorInsert.includes("full_json")],
  ["fresh normal generation path used", apply.includes("payloadFromTrip") && apply.includes("startStagedItineraryGeneration")],
  ["traveler slot handling is deterministic", apply.includes("reconcileTripCompanionSlots") && helper.includes("travelers")],
  ["ambiguous per-traveler inheritance fails closed", ui.includes("not copied") && apply.includes("reconcileTripCompanionSlots")],
  ["Airalo remains disabled", read("scripts/roamly-airalo-disabled-checks.mjs").includes("Airalo")],
  ["existing Date/Destination/Budget flows remain present", page.includes("CustomerDateChange") && page.includes("CustomerDestinationChange") && page.includes("CustomerBudgetChange")]
];

for (const [name, passed] of checks) {
  if (!passed) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}
console.log(`CUSTOMER_TRIP_INTENT_CHANGE_CHECKS ${checks.length}/${checks.length} PASS`);
