import assert from "node:assert/strict";
import { buildSuccessfulTripExperienceContext, qualifiesAsSuccessfulTripExperience } from "../lib/roamly/successfulTripExperience.ts";

const context = buildSuccessfulTripExperienceContext(
  {
    destination_city: "Montreal",
    destination_country: "Canada",
    start_date: "2026-08-01",
    end_date: "2026-08-04",
    travelers_count: 2,
    travel_style: "Balanced",
    accommodation_preference: "Downtown",
    transportation_preference: "Mixed",
    metadata: { planning: { destination: "Montreal" } }
  },
  {
    daily_itinerary: [
      { live_timeline: [{ title: "Museum", authority: "must_do" }, { title: "Open evening", authority: "flexible" }] },
      { activities: [{ title: "Market", status: "planned" }] }
    ],
    estimated_budget_breakdown: { hotel: 400, activities: 120 }
  },
  {
    overallSatisfaction: 5,
    wouldUseRoamlyAgain: true,
    itineraryPace: "right",
    scheduleRealism: 5,
    budgetAccuracy: 4,
    hotelLocationSatisfaction: 5,
    hotelQualitySatisfaction: 4,
    transportationSatisfaction: 4
  }
);

assert.equal(context.destinationKey, "montreal,canada");
assert.equal(context.durationDays, 4);
assert.equal(context.dayCount, 2);
assert.equal(context.plannedItemCount, 2);
assert.equal(context.flexibleItemCount, 1);
assert.equal(context.estimatedBudgetCategoryCount, 2);
assert.equal(qualifiesAsSuccessfulTripExperience(context), true);
assert.equal(qualifiesAsSuccessfulTripExperience({ ...context, feedbackSignals: { ...context.feedbackSignals, overallSatisfaction: 3 } }), false);
assert.equal(qualifiesAsSuccessfulTripExperience({ ...context, feedbackSignals: { ...context.feedbackSignals, wouldUseRoamlyAgain: false } }), false);
assert.equal(context.feedbackSignals, context.feedbackSignals);
console.log("successful trip experience checks passed");
