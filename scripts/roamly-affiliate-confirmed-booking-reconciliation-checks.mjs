import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reconcileAffiliateAction, confirmedNeedSatisfied } from "../lib/roamly/affiliateActionReconciliation.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

const tripId = "trip-1";
const flight = {
  trip_id: tripId,
  booking_type: "flight",
  booking_status: "confirmed",
  title: "Saint John to Tokyo flight",
  origin: "Saint John",
  destination: "Tokyo",
  start_date: "2026-10-01",
  flight_number: "AC123"
};
const hotel = {
  trip_id: tripId,
  booking_type: "hotel",
  booking_status: "confirmed",
  title: "Hotel Bonaventure Montréal",
  start_date: "2026-10-01",
  end_date: "2026-10-05",
  address: "900 René-Lévesque Blvd W"
};
const activityA = {
  trip_id: tripId,
  booking_type: "activity",
  booking_status: "confirmed",
  title: "Montreal Museum of Fine Arts",
  start_date: "2026-10-02",
  city: "Montreal"
};

const allow = (action, bookings = []) => assert.notEqual(reconcileAffiliateAction({ tripId, ...action }, bookings).decision, "SUPPRESS");
const suppress = (action, bookings, reason) => {
  const result = reconcileAffiliateAction({ tripId, ...action }, bookings);
  assert.equal(result.decision, "SUPPRESS");
  if (reason) assert.equal(result.reason, reason);
};

// A-D: no confirmation preserves every commercial path, including Amazon's separate need.
allow({ category: "flight", origin: "Saint John", destination: "Tokyo", startDate: "2026-10-01" });
allow({ category: "hotel", title: "Hotel Bonaventure Montréal", startDate: "2026-10-01", endDate: "2026-10-05" });
allow({ category: "activity", title: "Montreal Museum of Fine Arts", startDate: "2026-10-02" });
assert.equal(reconcileAffiliateAction({ tripId, category: "product", title: "Travel adapter" }, [flight, hotel, activityA]).decision, "ALLOW");

// E-H: a confirmed flight suppresses only its exact flight need.
suppress({ category: "flight", origin: "Saint John", destination: "Tokyo", startDate: "2026-10-01" }, [flight], "CONFIRMED_FLIGHT_NEED_SATISFIED");
allow({ category: "hotel", title: hotel.title, startDate: hotel.start_date, endDate: hotel.end_date }, [flight]);
allow({ category: "activity", title: activityA.title, startDate: activityA.start_date }, [flight]);
assert.equal(reconcileAffiliateAction({ tripId, category: "product", title: "Travel adapter" }, [flight]).decision, "ALLOW");

// I-L: a confirmed hotel suppresses the matching Stay22 action, not other categories.
suppress({ category: "hotel", title: hotel.title, startDate: hotel.start_date, endDate: hotel.end_date }, [hotel], "CONFIRMED_HOTEL_NEED_SATISFIED");
allow({ category: "flight", origin: "Saint John", destination: "Tokyo", startDate: "2026-10-01" }, [hotel]);
allow({ category: "activity", title: activityA.title, startDate: activityA.start_date }, [hotel]);
assert.equal(reconcileAffiliateAction({ tripId, category: "product", title: "Travel adapter" }, [hotel]).decision, "ALLOW");

// M-Q: activity suppression is exact and narrow.
suppress({ category: "activity", title: activityA.title, startDate: activityA.start_date, city: activityA.city }, [activityA], "CONFIRMED_ACTIVITY_MATCH");
allow({ category: "activity", title: "Montreal Botanical Garden", startDate: activityA.start_date, city: activityA.city }, [activityA]);
allow({ category: "flight", origin: "Saint John", destination: "Tokyo", startDate: "2026-10-01" }, [activityA]);
allow({ category: "hotel", title: hotel.title, startDate: hotel.start_date, endDate: hotel.end_date }, [activityA]);
assert.equal(reconcileAffiliateAction({ tripId, category: "product", title: "Travel adapter" }, [activityA]).decision, "ALLOW");

// R-X: recommendations, selections, pending choices, clicks, and unresolved emails are not confirmations.
for (const state of [
  { booking_type: "flight", booking_status: "recommended" },
  { booking_type: "hotel", booking_status: "selected" },
  { booking_type: "hotel", booking_status: "pending" },
  { booking_type: "hotel", booking_status: "needs_confirmation" },
  { booking_type: "hotel", booking_status: "clicked" },
  { booking_type: "hotel", booking_status: "detected" }
]) allow({ category: state.booking_type, title: hotel.title, startDate: hotel.start_date, endDate: hotel.end_date }, [{ ...hotel, ...state }]);

// Y-Z and AA-AB: scope and correspondence failures never silently suppress.
allow({ category: "flight", origin: flight.origin, destination: flight.destination, startDate: flight.start_date }, [{ ...flight, trip_id: "trip-2" }]);
allow({ category: "hotel", title: hotel.title, startDate: "2026-10-02", endDate: "2026-10-06" }, [hotel]);
assert.equal(reconcileAffiliateAction({ tripId, category: "activity", title: "Museum of Fine Arts Montreal" }, [activityA]).decision, "UNRESOLVED");
assert.equal(reconcileAffiliateAction({ tripId, category: "activity", title: "" }, [activityA]).decision, "UNRESOLVED");

// AC-AF: the same policy reconciles stale persisted suggestions when the trip is reopened.
suppress({ category: "flight", origin: flight.origin, destination: flight.destination, startDate: flight.start_date }, [flight]);
suppress({ category: "hotel", title: hotel.title, startDate: hotel.start_date, endDate: hotel.end_date }, [hotel]);
suppress({ category: "activity", title: activityA.title, startDate: activityA.start_date }, [activityA]);
allow({ category: "activity", title: "Different Activity", startDate: activityA.start_date }, [activityA]);

// AG-AW: policy is pure and provider/business systems remain outside this contract.
assert.equal(confirmedNeedSatisfied("flight", [flight], tripId), true);
assert.equal(confirmedNeedSatisfied("hotel", [hotel], tripId), true);
assert.equal(confirmedNeedSatisfied("activity", [activityA], tripId), false);
assert.equal(confirmedNeedSatisfied("hotel", [{ ...hotel, trip_id: "trip-2" }], tripId), false);

const affiliateLinks = source("lib/roamly/affiliateLinks.ts");
const page = source("app/trip/[id]/page.tsx");
const policy = source("lib/roamly/affiliateActionReconciliation.ts");
assert.match(affiliateLinks, /reconcileAffiliateAction/);
assert.match(page, /reconcileAffiliateAction/);
assert.match(page, /confirmedNeedSatisfied/);
assert.doesNotMatch(policy, /fetch\(|supabase|gmail|booking\.com|candidateDecisionCore|stripe/i);
assert.doesNotMatch(affiliateLinks, /BOOKING_DEMAND_AFFILIATE_ID|orders\/preview|orders\/create/i);
assert.doesNotMatch(page, /candidateDecisionCore|orders\/preview|orders\/create/i);

console.log("Roamly confirmed-booking affiliate reconciliation checks passed");
