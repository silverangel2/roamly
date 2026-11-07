// GAP-E WAVE 3b (2026-11-02, LOCAL ONLY) — companion repair-chain slim
// bundle (EGRESS-DIET-REPORT §3C chain follow-up) + admin generation-
// diagnostics projection (§3G future pass).
//
// Trace (see harness/GAP-E-CHANGELOG.md Item 2 for the full evidence):
// one processCompanionBookingChange run (companionOrchestrator.ts) for
// a flight-timing event reads the itinerary document up to 4x:
//   1. analyzeCompanionImpact      -> roamly_itineraries full_json
//   2. verifiedRepairContext       -> roamly_itineraries id,full_json,
//                                     repair_revision (repair engine)
//   3. buildShiftTimingContext     -> same read again, only when the
//                                     V1 context is not proven
//   4. verify (auto-apply path)    -> getTripBundle: FIVE select("*")
//                                     reads (trips, itineraries, days,
//                                     activities, checklists)
// Reads 1-3 are per-stage CAS evidence (each context embeds its own
// revision + content hash in the proposal) and verify MUST reload
// fresh post-apply state, so no snapshot is threaded. The slimming is
// at stage 4 only: getTripBundleSlim (lib/trips.ts) — two projected
// reads, no days/activities/checklists, no preview_json.
//
// This suite proves:
//   (a) the slim bundle returns every field the verify callers
//       consume (enumerated below), byte-identical where it matters:
//       itinerary.full_json deep-equal, payloadFromTrip(trip)
//       deep-equal, readiness inputs equal;
//   (b) repair decisions are identical: the REAL verify functions
//       (which now read slim) produce the same verification verdict
//       as the same pure decision logic fed the FULL bundle, for a
//       RESOLVED shift case, a STILL_AFFECTED V1 case, and the
//       canonical post-removal V1 case;
//   (c) read counts drop at the verify stage: full bundle = 5
//       select("*") table reads; slim bundle = 2 projected reads;
//       a real verify run touches exactly those 2 bundle tables;
//       slim response bytes are a fraction of full bytes;
//   (d) Item 3 source pins: the diagnostics route has no select("*")
//       left and its projected lists match the response contract.
//
// Runnable directly:  node scripts/roamly-gap-slimbundle-checks.mjs
// (self-boots the phase-5 register the house suites use), or via the
// coordinator-registered npm script once added.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.ROAMLY_GAP_SLIM_BOOTED) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/roamly-phase5-test-register.mjs",
      "scripts/roamly-gap-slimbundle-checks.mjs"
    ],
    { cwd: root, stdio: "inherit", env: { ...process.env, ROAMLY_GAP_SLIM_BOOTED: "1" } }
  );
  process.exit(result.status ?? 1);
}

import assert from "node:assert/strict";
import fs from "node:fs";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const {
  getTripBundle,
  getTripBundleSlim,
  TRIP_BUNDLE_SLIM_TRIP_COLUMNS,
  TRIP_BUNDLE_SLIM_ITINERARY_COLUMNS
} = await import("@/lib/trips.ts");
const { verifyAppliedVerifiedCompanionRepair, classifyVerifiedCompanionRepair } = await import(
  "@/lib/roamly/companionRepairEngine.ts"
);
const { verifyAppliedShiftTimingRepair } = await import("@/lib/roamly/companionShiftTiming.ts");
const { payloadFromTrip } = await import("@/lib/roamly/marketPriceRefresh.ts");
const { validateItineraryDeterministically } = await import("@/lib/roamly/itineraryValidation.ts");
const { FakeDb } = await import("./roamly-egress-diet-fake.mjs");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
  console.log(`  PASS ${label}`);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
  console.log(`  PASS ${label}`);
}
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, label);
  console.log(`  PASS ${label}`);
}
const clone = (v) => JSON.parse(JSON.stringify(v));

const USER = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";
const PROP_V1 = "55555555-5555-4555-8555-555555555555";
const PROP_SHIFT = "66666666-6666-4666-8666-666666666666";
const DAY_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_OTHER = "88888888-8888-4888-8888-888888888888";
const ITEM_TARGET = "99999999-9999-4999-8999-999999999999";
const CONFLICT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITIN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FINGERPRINT = "gap-e-shift-fingerprint";
const BOOKING_UPDATED = "2026-11-02T10:00:00.000Z";

/* The fields the verify callers consume — the contract slim must keep.
 * V1 verify (companionRepairEngine.verifyAppliedVerifiedCompanionRepair):
 *   itinerary.full_json; trip via payloadFromTrip (destination*,
 *   origin, start/end dates, days/travelers/budget/style fields,
 *   metadata.planning) + trip.start_date/end_date/itinerary_status.
 * Shift verify (companionShiftTiming.verifyAppliedShiftTimingRepair):
 *   itinerary.full_json only. Neither reads days/activities/checklist,
 *   itinerary.preview_json, or itinerary.ai_summary. */
const CONSUMED_TRIP_FIELDS = [
  "id", "user_id", "destination", "destination_name", "destination_country",
  "destination_region", "destination_city", "origin", "start_date", "end_date",
  "days_count", "travelers_count", "budget_amount", "budget_currency",
  "budget_includes_flights", "budget_includes_hotel", "travel_style",
  "interests", "accommodation_preference", "transportation_preference",
  "special_notes", "itinerary_status", "metadata"
];

function canonicalItinerary({ includeTarget = false } = {}) {
  const timeline = [
    {
      item_id: ITEM_OTHER,
      title: "Old Port stroll",
      description: "Walk the old port.",
      location_name: "Old Port",
      category: "Sightseeing",
      startTime: "15:00",
      endTime: "16:00",
      routing_status: "FEASIBLE",
      retimed_by_event: FINGERPRINT,
      estimated_cost: 0
    }
  ];
  if (includeTarget) {
    timeline.push({
      item_id: ITEM_TARGET,
      day_id: DAY_ID,
      conflict_id: CONFLICT_ID,
      title: "Optional museum visit",
      description: "Optional stop.",
      location_name: "Museum",
      category: "Museum",
      startTime: "17:00",
      endTime: "18:00",
      routing_status: "INFEASIBLE",
      estimated_cost: 0
    });
  }
  return {
    trip_title: "Montreal long weekend",
    destination_summary: "Montreal in November.",
    transport_overview: "Metro and walking.",
    hotel_area_suggestions: ["Old Montreal"],
    generation_note: "Generated through Roamly staged AI generation.",
    daily_itinerary: [
      {
        day_id: DAY_ID,
        day_number: 1,
        date: "2026-11-10",
        title: "Arrival day",
        morning: "Arrive.",
        afternoon: "Old Port.",
        evening: "Dinner.",
        food: ["Poutine"],
        map_queries: [],
        plan_status: includeTarget ? "conflict" : "ok",
        conflict_id: includeTarget ? CONFLICT_ID : null,
        live_timeline: timeline
      }
    ],
    packing_checklist: ["Passport"],
    pre_trip_essentials: [{ title: "Travel insurance" }],
    booking_suggestions: [],
    estimated_budget_breakdown: {}
  };
}

function makeDb({ includeTarget = false } = {}) {
  const fullJson = canonicalItinerary({ includeTarget });
  const trip = {
    id: TRIP,
    user_id: USER,
    title: "Montreal long weekend",
    destination: "Montreal",
    destination_name: "Montreal",
    destination_country: "Canada",
    destination_region: "Quebec",
    destination_city: "Montreal",
    origin: "Saint John",
    start_date: "2026-11-10",
    end_date: "2026-11-12",
    days_count: 3,
    travelers_count: 2,
    budget_amount: 1200,
    budget_currency: "CAD",
    budget_includes_flights: true,
    budget_includes_hotel: true,
    travel_style: "Balanced",
    interests: ["Food", "History"],
    accommodation_preference: "Hotel",
    transportation_preference: "Mixed",
    special_notes: "",
    status: "generated",
    itinerary_status: "generated",
    is_activated: true,
    itinerary_locked: true,
    stripe_checkout_session_id: "cs_test_gap_e",
    stripe_payment_intent_id: "pi_gap_e",
    tracking_unlocked: true,
    live_companion_unlocked: true,
    travel_country_info: { advisory: "x".repeat(600) },
    packing_checklist: ["Passport", "Coat"],
    document_checklist: ["Passport"],
    completion_email_status: "sent",
    completion_email_sent_at: "2026-11-01T10:00:00.000Z",
    created_at: "2026-11-01T09:00:00.000Z",
    updated_at: "2026-11-02T09:00:00.000Z",
    metadata: {
      planning: {
        destination: "Montreal",
        startDate: "2026-11-10",
        endDate: "2026-11-12",
        travelersCount: 2,
        budgetAmount: 1200,
        budgetCurrency: "CAD"
      }
    }
  };
  return new FakeDb({
    roamly_trips: [trip],
    roamly_itineraries: [
      {
        id: ITIN_ID,
        trip_id: TRIP,
        user_id: USER,
        ai_summary: "Montreal summary.",
        full_json: fullJson,
        preview_json: {
          trip_title: "Montreal long weekend",
          day_outline: [{ blob: "y".repeat(6000) }]
        },
        repair_revision: 3,
        source: "staged-ai",
        created_at: "2026-11-01T09:30:00.000Z",
        updated_at: "2026-11-02T09:30:00.000Z"
      }
    ],
    roamly_itinerary_days: [1, 2].map((n) => ({
      id: `day-row-${n}`,
      trip_id: TRIP,
      day_number: n,
      date: `2026-11-${9 + n}`,
      title: `Day ${n}`,
      summary: "z".repeat(900),
      morning_plan: "Morning.",
      afternoon_plan: "Afternoon.",
      evening_plan: "Evening.",
      food_suggestions: "Food.",
      transport_notes: "Transit.",
      estimated_cost: 100
    })),
    roamly_trip_activities: [1, 2].map((n) => ({
      id: `activity-row-${n}`,
      trip_id: TRIP,
      day_number: 1,
      time_label: "3:00 PM",
      title: `Activity ${n}`,
      description: "w".repeat(900),
      location_name: "Old Port",
      estimated_cost: 0,
      category: "Sightseeing",
      map_query: "Old Port",
      status: "planned",
      created_at: "2026-11-01T09:30:00.000Z"
    })),
    roamly_trip_checklists: [
      { id: "check-1", trip_id: TRIP, user_id: USER, item: "Passport", category: "Packing", is_done: false, created_at: "2026-11-01T09:30:00.000Z" }
    ],
    companion_events: [
      { id: EVENT_ID, trip_id: TRIP, user_id: USER, source_booking_id: BOOKING_ID, status: "proposed" }
    ],
    roamly_bookings: [
      {
        id: BOOKING_ID,
        trip_id: TRIP,
        user_id: USER,
        booking_type: "flight",
        booking_status: "booked",
        superseded_by_booking_id: null,
        updated_at: BOOKING_UPDATED
      }
    ],
    companion_repair_proposals: [
      {
        id: PROP_V1,
        companion_event_id: EVENT_ID,
        trip_id: TRIP,
        user_id: USER,
        operation: "REMOVE_OPTIONAL_ACTIVITY",
        status: "applied",
        verification_status: "pending",
        verified_at: null,
        target_item_id: ITEM_TARGET,
        conflict_id: CONFLICT_ID,
        expected_source_booking_updated_at: BOOKING_UPDATED
      },
      {
        id: PROP_SHIFT,
        companion_event_id: EVENT_ID,
        trip_id: TRIP,
        user_id: USER,
        operation: "SHIFT_ACTIVITY_TIMING",
        status: "applied",
        verification_status: "pending",
        verified_at: null,
        expected_event_fingerprint: FINGERPRINT,
        proposed_changes_json: [
          {
            action_type: "SHIFT_ACTIVITY_TIMING",
            before: { item_id: ITEM_OTHER, day_id: DAY_ID, start_key: "startTime", start: "14:00", end: "15:00" },
            after: { item_id: ITEM_OTHER, day_id: DAY_ID, new_start: "15:00", new_end: "16:00" }
          }
        ]
      }
    ]
  });
}

const BUNDLE_TABLES = ["roamly_trips", "roamly_itineraries", "roamly_itinerary_days", "roamly_trip_activities", "roamly_trip_checklists"];
function bundleSelects(db) {
  return db.log.filter((e) => e.kind === "select" && BUNDLE_TABLES.includes(e.table));
}

/* ------------------------------------------------------------------ */
/* (a)+(c) bundle A/B: fields, counts, bytes                          */
/* ------------------------------------------------------------------ */
console.log("(a/c) full vs slim bundle — consumed fields, read counts, bytes");
{
  const dbFull = makeDb();
  const full = await getTripBundle(dbFull, USER, TRIP);
  const dbSlim = makeDb();
  const slim = await getTripBundleSlim(dbSlim, USER, TRIP);

  ok(full.data && slim.data, "both bundles return data");
  deepEq(slim.data.itinerary.full_json, full.data.itinerary.full_json, "slim itinerary.full_json deep-equals full (the document verify decides on)");
  for (const field of CONSUMED_TRIP_FIELDS) {
    deepEq(slim.data.trip[field], full.data.trip[field], `slim trip.${field} matches full (consumed by verify)`);
  }
  deepEq(payloadFromTrip(slim.data.trip), payloadFromTrip(full.data.trip), "payloadFromTrip(slim trip) deep-equals payloadFromTrip(full trip)");
  eq(slim.data.trip.start_date, full.data.trip.start_date, "readiness input start_date preserved");
  eq(slim.data.trip.end_date, full.data.trip.end_date, "readiness input end_date preserved");
  eq(slim.data.trip.itinerary_status, full.data.trip.itinerary_status, "readiness input itinerary_status preserved");
  deepEq(slim.data.days, [], "slim days is [] (verify never reads bundle days — it derives days from full_json)");
  deepEq(slim.data.activities, [], "slim activities is [] (never consumed by verify)");
  deepEq(slim.data.checklist, [], "slim checklist is [] (never consumed by verify)");
  ok(slim.data.itinerary.preview_json && typeof slim.data.itinerary.preview_json === "object", "slim itinerary still carries a derived preview_json (TripBundle shape preserved)");

  const fullSelects = bundleSelects(dbFull);
  const slimSelects = bundleSelects(dbSlim);
  eq(fullSelects.length, 5, "BEFORE: full bundle = 5 table reads at the verify stage");
  ok(fullSelects.every((e) => e.select === "*"), 'BEFORE: every full-bundle read is select("*")');
  eq(slimSelects.length, 2, "AFTER: slim bundle = 2 table reads at the verify stage");
  deepEq(slimSelects.map((e) => e.table).sort(), ["roamly_itineraries", "roamly_trips"], "AFTER: slim reads only trips + itineraries (days/activities/checklists skipped)");
  ok(slimSelects.every((e) => e.select !== "*"), "AFTER: no slim read is select(\"*\")");
  const fullBytes = fullSelects.reduce((s, e) => s + (e.bytes || 0), 0);
  const slimBytes = slimSelects.reduce((s, e) => s + (e.bytes || 0), 0);
  console.log(`  INFO verify-stage bundle bytes: full=${fullBytes} slim=${slimBytes}`);
  ok(slimBytes < fullBytes * 0.5, `AFTER: slim verify-stage bytes (${slimBytes}) are under half of full (${fullBytes})`);
  ok(!TRIP_BUNDLE_SLIM_ITINERARY_COLUMNS.includes("preview_json"), "slim itinerary projection excludes preview_json (the fat duplicate)");
  ok(TRIP_BUNDLE_SLIM_TRIP_COLUMNS.includes("metadata"), "slim trip projection keeps metadata (metadata-itinerary fallback + planning payload)");
}

/* ------------------------------------------------------------------ */
/* (b) decision equivalence through the REAL verify functions         */
/* ------------------------------------------------------------------ */
console.log("(b) verify decisions — slim (real functions) vs full-fed decision logic");

function expectedV1Verdict(fullBundle, proposal, bookingUpdatedAt) {
  const itinerary = fullBundle.data.itinerary.full_json;
  const days = (Array.isArray(itinerary.daily_itinerary) ? itinerary.daily_itinerary : []).map((d) => d || {});
  const targetPresent = days.some((day) =>
    (Array.isArray(day.live_timeline) ? day.live_timeline : []).some((v) => (v || {}).item_id === proposal.target_item_id)
  );
  const originalConflictPresent = days.some(
    (day) =>
      day.conflict_id === proposal.conflict_id &&
      (Array.isArray(day.live_timeline) ? day.live_timeline : []).some((v) => (v || {}).conflict_id === proposal.conflict_id)
  );
  const validation = validateItineraryDeterministically({ itinerary, payload: payloadFromTrip(fullBundle.data.trip) });
  const canonicalRoutingKnown = days.every((day) =>
    (Array.isArray(day.live_timeline) ? day.live_timeline : []).every((v) => {
      const s = (v || {}).routing_status;
      return s !== "UNKNOWN" && s !== "UNCERTAIN";
    })
  );
  return classifyVerifiedCompanionRepair({
    targetPresent,
    originalConflictPresent,
    canonicalValidationOk: validation.ok,
    canonicalRoutingKnown,
    sourceBookingCurrent: bookingUpdatedAt === proposal.expected_source_booking_updated_at
  });
}

for (const [label, includeTarget] of [["canonical post-removal", false], ["target still present", true]]) {
  const dbFull = makeDb({ includeTarget });
  const full = await getTripBundle(dbFull, USER, TRIP);
  const proposalRow = dbFull.tables.companion_repair_proposals.find((p) => p.id === PROP_V1);
  const expected = expectedV1Verdict(full, proposalRow, BOOKING_UPDATED);

  const dbSlim = makeDb({ includeTarget });
  const result = await verifyAppliedVerifiedCompanionRepair({
    supabase: dbSlim,
    userId: USER,
    tripId: TRIP,
    repairProposalId: PROP_V1
  });
  ok(result.ok, `V1 verify (${label}) succeeds on the slim read`);
  eq(result.proposal.verification_status, expected.toLowerCase(), `V1 verify (${label}) verdict identical slim vs full: ${expected}`);
  const verifyBundleSelects = bundleSelects(dbSlim);
  eq(verifyBundleSelects.length, 2, `V1 verify (${label}) run touched exactly 2 bundle tables (was 5 via getTripBundle)`);
  if (includeTarget) eq(expected, "STILL_AFFECTED", "target-present fixture is deterministically STILL_AFFECTED in both arms");
}

{
  const dbSlim = makeDb();
  const result = await verifyAppliedShiftTimingRepair({
    supabase: dbSlim,
    userId: USER,
    tripId: TRIP,
    repairProposalId: PROP_SHIFT
  });
  ok(result.ok, "shift verify succeeds on the slim read");
  eq(result.verification, "resolved", "shift verify verdict is RESOLVED (retimed item matches the proposal fingerprint + new start)");
  const verifyBundleSelects = bundleSelects(dbSlim);
  eq(verifyBundleSelects.length, 2, "shift verify run touched exactly 2 bundle tables (was 5 via getTripBundle)");
  ok(verifyBundleSelects.every((e) => e.select !== "*"), "shift verify bundle reads are projected, never select(\"*\")");
}

/* ------------------------------------------------------------------ */
/* source pins — Item 2 wiring + Item 3 diagnostics projection        */
/* ------------------------------------------------------------------ */
console.log("(pins) source wiring");
{
  const tripsSrc = fs.readFileSync("lib/trips.ts", "utf8");
  const slimStart = tripsSrc.indexOf("export async function getTripBundleSlim");
  const slimBody = tripsSrc.slice(slimStart, tripsSrc.indexOf("export async function syncGeneratedItinerary", slimStart));
  ok(slimStart > 0, "lib/trips.ts exports getTripBundleSlim");
  ok(!slimBody.includes('select("*")'), "getTripBundleSlim body contains no select(\"*\")");
  ok(slimBody.includes("TRIP_BUNDLE_SLIM_TRIP_COLUMNS") && slimBody.includes("TRIP_BUNDLE_SLIM_ITINERARY_COLUMNS"), "getTripBundleSlim reads through the pinned projection constants");
  ok(!slimBody.includes("roamly_itinerary_days") && !slimBody.includes("roamly_trip_activities") && !slimBody.includes("roamly_trip_checklists"), "getTripBundleSlim never queries days/activities/checklists tables");

  const engineSrc = fs.readFileSync("lib/roamly/companionRepairEngine.ts", "utf8");
  ok(engineSrc.includes("getTripBundleSlim("), "companionRepairEngine verify uses getTripBundleSlim");
  ok(!/[^S]getTripBundle\(/.test(engineSrc.replaceAll("getTripBundleSlim(", "")), "companionRepairEngine no longer calls the full getTripBundle anywhere");
  const shiftSrc = fs.readFileSync("lib/roamly/companionShiftTiming.ts", "utf8");
  ok(shiftSrc.includes("getTripBundleSlim("), "companionShiftTiming verify uses getTripBundleSlim");
  ok(!/getTripBundle\(/.test(shiftSrc.replaceAll("getTripBundleSlim(", "")), "companionShiftTiming no longer calls the full getTripBundle anywhere");

  const diagSrc = fs.readFileSync("app/api/admin/roamly/generation-diagnostics/route.ts", "utf8");
  ok(!diagSrc.includes('select("*")'), "ITEM 3: diagnostics route has no select(\"*\") left");
  ok(diagSrc.includes('.select("id,trip_id,user_id,ai_summary,full_json,created_at,updated_at,repair_revision,source")'), "ITEM 3: itineraries projected to returned+consumed fields (preview_json dropped)");
  const jobsSelect = diagSrc.match(/roamly_trip_generation_jobs"\)\s*\n\s*\.select\("([^"]+)"\)/)?.[1] || "";
  ok(jobsSelect.length > 0 && !jobsSelect.includes("idempotency_key") && !jobsSelect.includes("duplicate_request_key"), "ITEM 3: jobs projection excludes the two cleanRecord-stripped *key columns");
  ok(diagSrc.includes('.select("id,title,destination,status,itinerary_status,user_id,created_at,updated_at,metadata,completion_email_status,completion_email_sent_at,completion_email_last_error,completion_email_attempt_count,completion_email_next_retry_at")'), "ITEM 3: trips read was already projected and is unchanged");
  ok(diagSrc.includes("finalStoredItinerary") && diagSrc.includes("hasFullJson"), "ITEM 3: response construction still derives hasFullJson + finalStoredItinerary from full_json (kept in the projection)");
}

console.log(`\nroamly-gap-slimbundle checks passed — ${count} assertions`);
