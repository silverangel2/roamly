import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const nodeRequire = createRequire(import.meta.url);
const source = fs.readFileSync(path.join(root, "lib/roamly/itineraryBookingOverrides.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "itineraryBookingOverrides.ts"
}).outputText;

const sandbox = {
  exports: {},
  module: { exports: {} },
  require(id) {
    if (id === "@/lib/itinerary") return { buildPreviewFromItinerary: (value) => value };
    if (id === "@/lib/roamly/itineraryValidation") return { validateItineraryDeterministically: () => ({ findings: [] }) };
    if (id === "@/lib/roamly/bookingSupersession") return { isOperationalCurrentBooking: (booking) => !booking.superseded_by_booking_id };
    return nodeRequire(id);
  }
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox, { filename: "itineraryBookingOverrides.ts" });
const { applyConfirmedBookingOverrideToItinerary } = sandbox.module.exports;

const baseItinerary = (items) => ({
  trip_title: "Fixture",
  destination_summary: "Fixture",
  best_for: [],
  route_reasoning: "",
  budget_fit_summary: "",
  booking_status_summary: "",
  free_or_low_cost_notes: [],
  estimated_budget_breakdown: { total_estimate: "$0", categories: [] },
  hotel_area_suggestions: [],
  transport_overview: "",
  daily_itinerary: [{
    day_number: 1,
    date: "2026-10-10",
    title: "Day 1",
    morning: "",
    afternoon: "",
    evening: "",
    food: [],
    estimated_cost: 0,
    map_queries: [],
    live_timeline: items
  }],
  packing_checklist: [],
  local_tips: [],
  safety_notes: [],
  emergency_notes: [],
  booking_suggestions: [],
  pre_trip_essentials: [],
  regenerate_suggestions: []
});

const hotel = {
  id: "booking-hotel-current",
  recommendation_id: "hotel-candidate-1",
  booking_type: "hotel",
  booking_status: "booked",
  title: "Actual Hotel",
  start_at: "2026-10-10T15:00:00Z",
  location_name: "Actual Hotel Address",
  traveler_confirmed: true
};
const selectedHotel = {
  candidateId: "hotel-candidate-1",
  item_type: "hotel",
  title: "Recommended Hotel",
  description: "Recommended",
  location_name: "Old Hotel Area",
  time_label: "3:00 PM",
  startTime: "15:00",
  estimated_cost: 100,
  category: "Hotel",
  map_query: "Old Hotel Area"
};

const hotelResult = applyConfirmedBookingOverrideToItinerary(baseItinerary([selectedHotel]), hotel);
const hotelItem = hotelResult.itinerary.daily_itinerary[0].live_timeline[0];
assert.equal(hotelItem.booking_id, hotel.id, "linked hotel candidate is replaced by booking anchor");
assert.equal(hotelItem.item_type, "booking", "booking anchor uses existing booking item authority");
assert.equal(hotelItem.plan_role, "protected_anchor", "booking anchor is protected");
assert.equal(hotelItem.location_name, hotel.location_name, "factual booking location wins");
assert.equal(hotelResult.itinerary.daily_itinerary[0].live_timeline.length, 1, "linked recommendation is not duplicated");

const repeated = applyConfirmedBookingOverrideToItinerary(hotelResult.itinerary, hotel);
assert.deepEqual(repeated.itinerary, hotelResult.itinerary, "reconciliation is idempotent");

const unrelated = {
  ...selectedHotel,
  candidateId: "unrelated-candidate",
  title: "Nearby Dinner",
  item_type: "activity"
};
const unrelatedResult = applyConfirmedBookingOverrideToItinerary(baseItinerary([unrelated]), hotel);
assert.equal(unrelatedResult.itinerary.daily_itinerary[0].live_timeline.length, 2, "unlinked nearby item is preserved");
assert.equal(unrelatedResult.itinerary.daily_itinerary[0].live_timeline[0].title, unrelated.title, "no fuzzy replacement occurs");

const missingLocation = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), {
  ...hotel,
  id: "booking-without-location",
  recommendation_id: null,
  location_name: null,
  address: null,
  destination: null,
  origin: null
});
assert.equal(missingLocation.itinerary.daily_itinerary[0].live_timeline[0].location_name, "", "missing location remains unknown");

const superseded = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), {
  ...hotel,
  id: "historical-booking",
  superseded_by_booking_id: "booking-hotel-current"
});
assert.equal(superseded.changed, false, "superseded booking cannot become an anchor");

const cancelled = applyConfirmedBookingOverrideToItinerary(baseItinerary([]), {
  ...hotel,
  id: "cancelled-booking",
  booking_status: "cancelled"
});
assert.notEqual(cancelled.itinerary.daily_itinerary[0].live_timeline[0].plan_role, "protected_anchor", "cancelled booking is not an active anchor");

const flight = {
  id: "booking-flight-current",
  recommendation_id: "flight-candidate-1",
  booking_type: "flight",
  booking_status: "booked",
  title: "Actual flight",
  start_at: "2026-10-10T09:00:00Z",
  end_at: "2026-10-10T12:00:00Z",
  origin: "YQM",
  destination: "YYZ",
  flight_number: "AC123",
  traveler_confirmed: true
};
const selectedFlight = {
  candidateId: "flight-candidate-1",
  item_type: "travel",
  title: "Estimated flight",
  description: "Estimated",
  location_name: "YQM to YYZ",
  time_label: "8:00 AM",
  startTime: "08:00",
  estimated_cost: 200,
  category: "Flight",
  map_query: "YQM YYZ"
};
const flightResult = applyConfirmedBookingOverrideToItinerary(baseItinerary([selectedFlight]), flight);
assert.equal(flightResult.itinerary.daily_itinerary[0].live_timeline[0].booking_id, flight.id, "linked flight becomes authoritative");
assert.equal(flightResult.itinerary.daily_itinerary[0].live_timeline[0].plan_role, "protected_anchor");

console.log("confirmed booking canonical itinerary reconciliation checks passed");
