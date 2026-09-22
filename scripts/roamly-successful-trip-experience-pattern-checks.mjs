import assert from "node:assert/strict";
import { aggregateSuccessfulTripExperiencePatterns, isPublishableSuccessfulTripPattern } from "../lib/roamly/successfulTripExperiencePatterns.ts";

const context = (overrides = {}) => ({
  schemaVersion: 1,
  destinationKey: "lisbon,portugal",
  durationDays: 5,
  travelersCount: 2,
  travelStyle: "balanced",
  accommodationPreference: "boutique hotel",
  transportationPreference: "walk + transit",
  dayCount: 5,
  plannedItemCount: 8,
  flexibleItemCount: 2,
  estimatedBudgetCategoryCount: 4,
  feedbackSignals: {
    overallSatisfaction: 5,
    itineraryPace: "right",
    scheduleRealism: 4,
    budgetAccuracy: 4,
    hotelLocationSatisfaction: 5,
    hotelQualitySatisfaction: 4,
    transportationSatisfaction: 4,
    wouldUseRoamlyAgain: true
  },
  ...overrides
});

const patterns = aggregateSuccessfulTripExperiencePatterns([
  { experienceContext: context() },
  { experienceContext: context({ feedbackSignals: { ...context().feedbackSignals, overallSatisfaction: 4 } }) },
  { experienceContext: context({ feedbackSignals: { ...context().feedbackSignals, budgetAccuracy: 3 } }) },
  { experienceContext: context({ feedbackSignals: { ...context().feedbackSignals, wouldUseRoamlyAgain: false } }) },
  { experienceContext: null }
]);

assert.equal(patterns.length, 1, "only qualifying contexts should aggregate");
assert.equal(patterns[0].sampleCount, 3, "records should group into one anonymous pattern");
assert.equal(patterns[0].durationBucket, "4-7");
assert.equal(patterns[0].travelersBucket, "2");
assert.equal(patterns[0].averageSatisfaction, 14 / 3);
assert.equal(isPublishableSuccessfulTripPattern(patterns[0]), true);
assert.equal(isPublishableSuccessfulTripPattern({ ...patterns[0], sampleCount: 2 }), false);
assert.equal(patterns[0].patternKey.includes("|"), true);
console.log("successful trip experience pattern checks passed");
