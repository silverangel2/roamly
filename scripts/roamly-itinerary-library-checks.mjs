import assert from "node:assert/strict";
import fs from "node:fs";
import {
  aggregateSuccessfulTripExperiencePatterns,
  budgetBandForAmount,
  isPublishableSuccessfulTripPattern,
  selectRelevantSuccessfulTripPatterns
} from "../lib/roamly/successfulTripExperiencePatterns.ts";
import { readItineraryLibraryExperienceRecords } from "../lib/roamly/itineraryLibraryAggregation.ts";
import {
  isTripCompletedForLibrary,
  validateItinerarySubmissionInput
} from "../lib/roamly/itineraryLibrary.ts";

// ---------------------------------------------------------------------------
// budgetBandForAmount: CAD-anchored v1 heuristic bands
// ---------------------------------------------------------------------------
assert.equal(budgetBandForAmount(null), null);
assert.equal(budgetBandForAmount(undefined), null);
assert.equal(budgetBandForAmount(-5), null);
assert.equal(budgetBandForAmount(Number.NaN), null);
assert.equal(budgetBandForAmount(0), "budget");
assert.equal(budgetBandForAmount(1499.99), "budget");
assert.equal(budgetBandForAmount(1500), "midrange");
assert.equal(budgetBandForAmount("2500"), "midrange");
assert.equal(budgetBandForAmount(3999), "midrange");
assert.equal(budgetBandForAmount(4000), "premium");
assert.equal(budgetBandForAmount(9999), "premium");
assert.equal(budgetBandForAmount(10000), "luxury");
assert.equal(budgetBandForAmount(50000), "luxury");

// ---------------------------------------------------------------------------
// isTripCompletedForLibrary: status gate + end-date gate
// ---------------------------------------------------------------------------
assert.equal(isTripCompletedForLibrary({ status: "completed", endDate: "2026-10-01" }), true);
assert.equal(isTripCompletedForLibrary({ status: "Completed", endDate: "2026-10-14" }), true);
assert.equal(isTripCompletedForLibrary({ status: "completed", endDate: "2026-10-16" }), false, "future end date is not completed");
assert.equal(isTripCompletedForLibrary({ status: "active", endDate: "2026-10-01" }), false);
assert.equal(isTripCompletedForLibrary({ status: "completed", endDate: null }), false);
assert.equal(isTripCompletedForLibrary({ status: "completed", endDate: "not-a-date" }), false);

// ---------------------------------------------------------------------------
// validateItinerarySubmissionInput
// ---------------------------------------------------------------------------
const baseInput = {
  tripId: "trip-1",
  destination: "Lisbon",
  consentAnonymizedReuse: false,
  itemVerdicts: [
    { segmentId: "seg-1", itemLabel: "Hotel", rating: 5, verdict: "loved" }
  ]
};
assert.equal(validateItinerarySubmissionInput(baseInput).ok, true);
assert.equal(validateItinerarySubmissionInput({ ...baseInput, tripId: "" }).error, "TRIP_REQUIRED");
assert.equal(validateItinerarySubmissionInput({ ...baseInput, destination: "  " }).error, "DESTINATION_REQUIRED");
assert.equal(
  validateItinerarySubmissionInput({ ...baseInput, consentAnonymizedReuse: "yes" }).error,
  "CONSENT_REQUIRED",
  "consent must be an explicit boolean (unchecked default is false, never truthy garbage)"
);
assert.equal(
  validateItinerarySubmissionInput({ ...baseInput, itemVerdicts: [{ segmentId: "s", itemLabel: "x", rating: 6 }] }).error,
  "INVALID_RATING"
);
assert.equal(
  validateItinerarySubmissionInput({ ...baseInput, itemVerdicts: [{ itemLabel: "x", rating: 4 }] }).error,
  "VERDICT_BOOKING_REF_REQUIRED",
  "every verdict must tie to a real booked item"
);
assert.equal(
  validateItinerarySubmissionInput({ ...baseInput, itemVerdicts: [{ segmentId: "s", itemLabel: "   " }] }).error,
  "VERDICT_LABEL_REQUIRED"
);
assert.equal(
  validateItinerarySubmissionInput({ ...baseInput, itemVerdicts: [{ segmentId: "s", itemLabel: "x", verdict: "meh" }] }).error,
  "INVALID_VERDICT_VALUE"
);
assert.equal(validateItinerarySubmissionInput({ ...baseInput, itemVerdicts: [] }).ok, true, "zero verdicts validates; the form requires >= 1");

// ---------------------------------------------------------------------------
// Aggregation: booking-proven weight + small-sample caution
// ---------------------------------------------------------------------------
function makeContext(overrides = {}) {
  return {
    schemaVersion: 1,
    destinationKey: "lisbon,portugal",
    durationDays: 7,
    travelersCount: 2,
    travelStyle: "relaxed",
    accommodationPreference: null,
    transportationPreference: null,
    dayCount: 7,
    plannedItemCount: 10,
    flexibleItemCount: 0,
    estimatedBudgetCategoryCount: 3,
    feedbackSignals: {
      overallSatisfaction: 5,
      itineraryPace: "right",
      scheduleRealism: 4,
      budgetAccuracy: 4,
      hotelLocationSatisfaction: 5,
      hotelQualitySatisfaction: 5,
      transportationSatisfaction: 4,
      wouldUseRoamlyAgain: true
    },
    ...overrides
  };
}

// Two booking-proven trips (weight 2 each): weighted sampleCount 4 but only
// 2 distinct trips -> must NOT publish ("a couple of reviews don't crown a best").
{
  const patterns = aggregateSuccessfulTripExperiencePatterns([
    { experienceContext: makeContext(), weight: 2, budgetBand: "midrange" },
    { experienceContext: makeContext(), weight: 2, budgetBand: "midrange" }
  ]);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].sampleCount, 4);
  assert.equal(patterns[0].sourceTripCount, 2);
  assert.equal(patterns[0].evidenceStrength, "limited");
  assert.equal(patterns[0].budgetBand, "midrange");
  assert.equal(isPublishableSuccessfulTripPattern(patterns[0]), false, "2 weighted trips must not publish");
}

// Three booking-proven trips -> publishes with weighted samples.
{
  const patterns = aggregateSuccessfulTripExperiencePatterns([
    { experienceContext: makeContext(), weight: 2, budgetBand: "midrange" },
    { experienceContext: makeContext(), weight: 2, budgetBand: "midrange" },
    { experienceContext: makeContext(), weight: 2, budgetBand: "budget" }
  ]);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].sampleCount, 6);
  assert.equal(patterns[0].sourceTripCount, 3);
  assert.equal(patterns[0].budgetBand, "midrange", "majority band wins");
  assert.equal(isPublishableSuccessfulTripPattern(patterns[0]), true);
}

// Weighted averages: satisfaction 5 (w2) + 4 (w1) = 14/3.
{
  const low = makeContext({ feedbackSignals: { overallSatisfaction: 4, itineraryPace: null, scheduleRealism: 4, budgetAccuracy: 4, hotelLocationSatisfaction: 4, hotelQualitySatisfaction: 4, transportationSatisfaction: 4, wouldUseRoamlyAgain: true } });
  const patterns = aggregateSuccessfulTripExperiencePatterns([
    { experienceContext: makeContext(), weight: 2 },
    { experienceContext: low, weight: 1 }
  ]);
  assert.ok(Math.abs(patterns[0].averageSatisfaction - 14 / 3) < 1e-9, `weighted avg, got ${patterns[0].averageSatisfaction}`);
  assert.equal(patterns[0].sampleCount, 3);
}

// evidenceStrength turns solid at 5 distinct trips.
{
  const records = Array.from({ length: 5 }, () => ({ experienceContext: makeContext(), weight: 1 }));
  const patterns = aggregateSuccessfulTripExperiencePatterns(records);
  assert.equal(patterns[0].evidenceStrength, "solid");
  assert.equal(patterns[0].sourceTripCount, 5);
}

// Feedback-lane behavior unchanged: unweighted records behave as before.
{
  const patterns = aggregateSuccessfulTripExperiencePatterns([
    { experienceContext: makeContext() },
    { experienceContext: makeContext() },
    { experienceContext: makeContext() }
  ]);
  assert.equal(patterns[0].sampleCount, 3);
  assert.equal(patterns[0].sourceTripCount, 3);
  assert.equal(isPublishableSuccessfulTripPattern(patterns[0]), true);
}

// Low-satisfaction contexts still do not qualify.
{
  const bad = makeContext({ feedbackSignals: { overallSatisfaction: 2, itineraryPace: null, scheduleRealism: 2, budgetAccuracy: 2, hotelLocationSatisfaction: 2, hotelQualitySatisfaction: 2, transportationSatisfaction: 2, wouldUseRoamlyAgain: true } });
  const patterns = aggregateSuccessfulTripExperiencePatterns([{ experienceContext: bad, weight: 2 }]);
  assert.equal(patterns.length, 0);
}

// ---------------------------------------------------------------------------
// selectRelevantSuccessfulTripPatterns: budget band, recency, caution
// ---------------------------------------------------------------------------
function dbRow(overrides = {}) {
  return {
    pattern_key: "lisbon|relaxed|unknown|unknown|4-7|2",
    destination_key: "lisbon,portugal",
    travel_style: "relaxed",
    accommodation_preference: null,
    transportation_preference: null,
    duration_bucket: "4-7",
    travelers_bucket: "2",
    sample_count: 5,
    source_trip_count: 5,
    budget_band: "midrange",
    updated_at: "2026-10-01T00:00:00Z",
    average_satisfaction: 4.6,
    average_schedule_realism: 4,
    average_budget_accuracy: 4,
    average_hotel_location_satisfaction: 5,
    average_hotel_quality_satisfaction: 5,
    average_transportation_satisfaction: 4,
    ...overrides
  };
}
const planningInput = {
  destinationCity: "Lisbon",
  destinationCountry: "Portugal",
  daysCount: 7,
  travelersCount: 2,
  travelStyle: "relaxed",
  budgetAmount: 2500
};

{
  const rows = [
    dbRow({ pattern_key: "b", budget_band: "luxury", sample_count: 10, source_trip_count: 10 }),
    dbRow({ pattern_key: "a", budget_band: "midrange", sample_count: 3, source_trip_count: 3 })
  ];
  const selected = selectRelevantSuccessfulTripPatterns(rows, planningInput);
  assert.equal(selected[0].patternKey, "a", "exact budget-band match outranks larger mismatched sample");
}

{
  const rows = [
    dbRow({ pattern_key: "old", updated_at: "2026-01-01T00:00:00Z", sample_count: 5, source_trip_count: 5 }),
    dbRow({ pattern_key: "new", updated_at: "2026-10-10T00:00:00Z", sample_count: 5, source_trip_count: 5 })
  ];
  const selected = selectRelevantSuccessfulTripPatterns(rows, planningInput);
  assert.equal(selected[0].patternKey, "new", "recency breaks sample-count ties");
}

{
  const rows = [
    dbRow({ pattern_key: "thin", sample_count: 4, source_trip_count: 2 }),
    dbRow({ pattern_key: "ok", sample_count: 3, source_trip_count: 3 })
  ];
  const selected = selectRelevantSuccessfulTripPatterns(rows, planningInput);
  assert.deepEqual(selected.map((p) => p.patternKey), ["ok"], "weighted-but-thin rows are filtered by small-sample caution");
}

{
  // No trip budget -> original sample-count ordering preserved.
  const rows = [
    dbRow({ pattern_key: "small", sample_count: 3, source_trip_count: 3 }),
    dbRow({ pattern_key: "big", sample_count: 9, source_trip_count: 9 })
  ];
  const selected = selectRelevantSuccessfulTripPatterns(rows, { ...planningInput, budgetAmount: null });
  assert.deepEqual(selected.map((p) => p.patternKey), ["big", "small"]);
}

{
  // camelCase in-memory rows (stored generation state) are accepted too.
  const rows = [
    {
      patternKey: "lisbon|relaxed|unknown|unknown|4-7|2",
      destinationKey: "lisbon,portugal",
      travelStyle: "relaxed",
      accommodationPreference: null,
      transportationPreference: null,
      durationBucket: "4-7",
      travelersBucket: "2",
      sampleCount: 4,
      sourceTripCount: 4,
      evidenceStrength: "limited",
      budgetBand: "midrange",
      updatedAt: null,
      averageSatisfaction: 4.5
    }
  ];
  const selected = selectRelevantSuccessfulTripPatterns(rows, planningInput);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].evidenceStrength, "limited");
}

// ---------------------------------------------------------------------------
// readItineraryLibraryExperienceRecords: fail-soft
// ---------------------------------------------------------------------------
{
  const throwingAdmin = { from: () => { throw new Error('relation "public.itinerary_submissions" does not exist'); } };
  const records = await readItineraryLibraryExperienceRecords(throwingAdmin);
  assert.deepEqual(records, [], "missing tables -> []");
}
{
  const chainable = (result) => new Proxy({}, {
    get: (target, prop) => prop === "then" ? (resolve) => resolve(result) : () => chainable(result)
  });
  const errorAdmin = { from: () => chainable({ data: null, error: { message: "schema cache miss" } }) };
  const records = await readItineraryLibraryExperienceRecords(errorAdmin);
  assert.deepEqual(records, [], "query error -> []");
}
{
  // Positive path: consenting submission -> weighted record with budget band.
  const tables = {
    itinerary_submissions: {
      data: [{
        id: "sub-1", trip_id: "trip-1", destination: "Lisbon", destination_city: "Lisbon",
        destination_country: "Portugal", start_date: "2026-09-01", end_date: "2026-09-07",
        created_at: "2026-09-08T00:00:00Z"
      }],
      error: null
    },
    item_verdicts: {
      data: [
        { submission_id: "sub-1", item_type: "hotel", rating: 5 },
        { submission_id: "sub-1", item_type: "flight", rating: 4 }
      ],
      error: null
    },
    roamly_trips: {
      data: [{ id: "trip-1", travelers_count: 2, travel_style: "relaxed", accommodation_preference: null, transportation_preference: null, budget_amount: 2500 }],
      error: null
    }
  };
  const chainable = (table) => new Proxy({}, {
    get: (target, prop) => prop === "then" ? (resolve) => resolve(tables[table] || { data: [], error: null }) : () => chainable(table)
  });
  const fakeAdmin = { from: (table) => chainable(table) };
  const records = await readItineraryLibraryExperienceRecords(fakeAdmin);
  assert.equal(records.length, 1);
  assert.equal(records[0].weight, 2, "booking-proven records weigh highest");
  assert.equal(records[0].budgetBand, "midrange");
  assert.equal(records[0].experienceContext.destinationKey, "lisbon,portugal");
  assert.equal(records[0].experienceContext.feedbackSignals.wouldUseRoamlyAgain, true);
  assert.equal(records[0].experienceContext.feedbackSignals.overallSatisfaction, 5, "avg(5,4)=4.5 rounds to 5");
}

// Low-rated submissions do not feed successful patterns (still stored, just not aggregated).
{
  const tables = {
    itinerary_submissions: {
      data: [{ id: "sub-2", trip_id: "trip-2", destination: "Lisbon", destination_city: "Lisbon", destination_country: "Portugal", start_date: "2026-09-01", end_date: "2026-09-07", created_at: "2026-09-08T00:00:00Z" }],
      error: null
    },
    item_verdicts: { data: [{ submission_id: "sub-2", item_type: "hotel", rating: 2 }], error: null },
    roamly_trips: { data: [], error: null }
  };
  const chainable = (table) => new Proxy({}, {
    get: (target, prop) => prop === "then" ? (resolve) => resolve(tables[table] || { data: [], error: null }) : () => chainable(table)
  });
  const records = await readItineraryLibraryExperienceRecords({ from: (table) => chainable(table) });
  assert.deepEqual(records, [], "avg rating < 4 does not qualify as a successful-trip record");
  const patterns = aggregateSuccessfulTripExperiencePatterns(records);
  assert.equal(patterns.length, 0);
}

// ---------------------------------------------------------------------------
// File-content assertions: wiring is present and shaped correctly
// ---------------------------------------------------------------------------
const migration = fs.readFileSync("supabase/migrations/20261015000100_roamly_itinerary_library_frontdoor.sql", "utf8");
assert.match(migration, /itinerary_submissions_one_per_trip unique \(trip_id\)/, "one submission per completed trip");
assert.match(migration, /consent_anonymized_reuse boolean not null default false/, "consent defaults to unchecked");
assert.match(migration, /booking_proven boolean not null default true/);
assert.match(migration, /for all\s+to service_role/, "service-role RLS coverage");
assert.match(migration, /Roamly users delete own itinerary submissions/, "owners can retract (rollback path)");
assert.match(migration, /add column if not exists budget_band/);
assert.match(migration, /add column if not exists source_trip_count/);

const sharePage = fs.readFileSync("app/trips/share/page.tsx", "utf8");
assert.match(sharePage, /\/login\?next=\/trips\/share/, "signed-in only");
assert.match(sharePage, /getCompletedTripsForSharing/);
assert.match(sharePage, /getTripBookedSegments/);

const shareForm = fs.readFileSync("components/trip/ItineraryShareForm.tsx", "utf8");
assert.match(shareForm, /const \[consent, setConsent\] = useState\(false\)/, "consent checkbox unchecked by default");
assert.match(shareForm, /\/api\/itinerary-submissions/);
assert.match(shareForm, /Choose a booked item/);

const askCard = fs.readFileSync("components/trip/PostTripLibraryAskCard.tsx", "utf8");
assert.match(askCard, /\/trip\/\$\{tripId\}\/feedback/, "ask (a): rate booked items");
assert.match(askCard, /\/trips\/share\?trip=\$\{tripId\}/, "ask (b): share itinerary");

const tripPage = fs.readFileSync("app/trip/[id]/page.tsx", "utf8");
assert.match(tripPage, /{completedTrip \? <PostTripLibraryAskCard tripId=\{id\} \/> : null}/, "card renders on completed trips only");

const cronRoute = fs.readFileSync("app/api/cron/roamly-post-trip-ask/route.ts", "utf8");
assert.match(cronRoute, /isCronRequestAuthorized/);
assert.match(cronRoute, /const IDEMPOTENCY_PREFIX = "post_trip_library_ask"/);
assert.match(cronRoute, /\$\{IDEMPOTENCY_PREFIX\}:\$\{tripId\}/, "one email per trip via idempotency key");
assert.match(cronRoute, /library_ask_opt_out/, "marketing consent honored");
assert.match(cronRoute, /sendRoamlyEmail/);

const vercel = fs.readFileSync("vercel.json", "utf8");
assert.match(vercel, /\/api\/cron\/roamly-post-trip-ask/);

const email = fs.readFileSync("lib/roamly/email.ts", "utf8");
assert.match(email, /"post_trip_library_ask"/);

const generator = fs.readFileSync("lib/roamly/stagedItineraryGeneration.ts", "utf8");
assert.match(generator, /evidenceStrength/, "guidance prompt carries evidence strength");
assert.match(generator, /treat them as anecdotal, never as the proven best option/);

console.log("itinerary-library checks: all assertions passed");
