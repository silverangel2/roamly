import assert from "node:assert/strict";
import { deriveTripReadiness } from "../lib/roamly/tripReadiness.ts";

const base = {
  tripId: "trip-1",
  startDate: "2026-10-10",
  endDate: "2026-10-14",
  hasItinerary: true,
  budgetStatus: "WITHIN_BUDGET",
  now: new Date("2026-09-15T12:00:00Z")
};

assert.equal(deriveTripReadiness({ ...base, confirmedBookingCount: 2 }).state, "READY");
assert.equal(deriveTripReadiness({ ...base, bookingsNeedingReview: 1 }).primaryAction.id, "bookings");
assert.equal(deriveTripReadiness({ ...base, bookingsNeedingReview: 1, bookingFocus: "hotel" }).primaryAction.href, `/trip/${base.tripId}?focus=hotel#bookings`);
assert.equal(deriveTripReadiness({ ...base, bookingsToArrange: 2 }).primaryAction.id, "bookings");
assert.equal(deriveTripReadiness({ ...base, conflictCount: 1 }).primaryAction.id, "conflict");
assert.equal(deriveTripReadiness({ ...base, conflictCount: 1, conflictDay: 3 }).primaryAction.href, `/trip/${base.tripId}?focus=day-3#day-by-day`);
assert.equal(deriveTripReadiness({ ...base, budgetStatus: "OVER_BUDGET" }).primaryAction.id, "budget");
assert.equal(deriveTripReadiness({ ...base, budgetStatus: "OVER_BUDGET" }).primaryAction.href, `/trip/${base.tripId}?focus=budget#budget`);
assert.equal(deriveTripReadiness({ ...base, budgetStatus: "BUDGET_UNCERTAIN" }).state, "UNCERTAIN");
assert.equal(deriveTripReadiness({ ...base, uncertainItemCount: 1 }).state, "UNCERTAIN");
assert.equal(deriveTripReadiness({ ...base, generationStatus: "partially_failed", hasItinerary: false }).primaryAction.id, "generation");
const completed = deriveTripReadiness({ ...base, startDate: "2026-08-04", endDate: "2026-08-05", now: new Date("2026-09-15T12:00:00Z"), bookingsNeedingReview: 3, bookingsToArrange: 3 });
assert.equal(completed.phase, "completed");
assert.equal(completed.primaryAction.id, "plan");
assert.equal(deriveTripReadiness({ ...base, startDate: "invalid", endDate: null }).phase, "unknown");
console.log("Roamly trip readiness checks passed.");
