import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const nodeRequire = createRequire(import.meta.url);
const source = fs.readFileSync(path.join(root, "lib/roamly/itineraryBookingOverrides.ts"), "utf8");
const routingSource = fs.readFileSync(path.join(root, "lib/roamly/itineraryRouting.ts"), "utf8");
const routingCompiled = ts.transpileModule(routingSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "itineraryRouting.ts"
}).outputText;
const routingSandbox = { exports: {}, module: { exports: {} }, require: nodeRequire };
routingSandbox.exports = routingSandbox.module.exports;
vm.runInNewContext(routingCompiled, routingSandbox, { filename: "itineraryRouting.ts" });
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
    if (id === "@/lib/roamly/itineraryRouting") return routingSandbox.module.exports;
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

const routeEvidence = {
  fromItemId: "airport-item",
  toItemId: "booking-hotel-current",
  mode: "DRIVE",
  distanceKm: 12,
  distanceKind: "ROUTE_DISTANCE",
  durationMinutes: 35,
  durationSource: "fixture route",
  authority: "AUTHORITATIVE_ROUTE",
  source: "fixture",
  confidence: "high"
};
const crossDayItinerary = {
  ...baseItinerary([]),
  daily_itinerary: [
    {
      ...baseItinerary([]).daily_itinerary[0],
      date: "2026-10-10",
      live_timeline: [{
        item_id: "airport-item",
        item_type: "travel",
        title: "Arrival airport",
        description: "Arrival",
        location_name: "Airport A",
        time_label: "11:00 PM",
        startTime: "23:00",
        endTime: "23:30",
        estimated_cost: null,
        category: "Travel",
        map_query: "Airport A to Old Hotel",
        coordinates: { latitude: 46.0, longitude: -64.8 },
        routing_status: "FEASIBLE",
        route_evidence: routeEvidence,
        travelTimeMinutes: 35,
        durationMinutes: 35
      }]
    },
    {
      ...baseItinerary([]).daily_itinerary[0],
      day_number: 2,
      date: "2026-10-11",
      live_timeline: [{
        item_type: "booking",
        title: "Actual Hotel",
        description: "Confirmed",
        location_name: "Old Hotel Address",
        time_label: "12:30 AM",
        startTime: "00:30",
        estimated_cost: null,
        category: "Confirmed booking",
        map_query: "New Hotel Address",
        booking_id: hotel.id,
        booking_status: "confirmed",
        plan_role: "protected_anchor",
        factualStatus: "verified",
        coordinates: { latitude: 46.1, longitude: -64.7 }
      }]
    }
  ]
};
const routed = applyConfirmedBookingOverrideToItinerary(crossDayItinerary, {
  ...hotel,
  start_at: "2026-10-11T00:30:00Z",
  coordinates: { latitude: 46.1, longitude: -64.7 }
});
const oldRoute = routed.itinerary.daily_itinerary[0].live_timeline[0];
assert.equal(oldRoute.routing_status, "UNCERTAIN", "old endpoint route is invalidated across a day boundary");
assert.equal(oldRoute.route_evidence, null, "old endpoint evidence is not operational for the new hotel");
assert.equal(oldRoute.travelTimeMinutes, undefined, "old route duration is not retained");
assert.equal(oldRoute.map_query, "", "stale Maps target is cleared");
const routedAgain = applyConfirmedBookingOverrideToItinerary(routed.itinerary, {
  ...hotel,
  start_at: "2026-10-11T00:30:00Z",
  coordinates: { latitude: 46.1, longitude: -64.7 }
});
assert.deepEqual(routedAgain.itinerary, routed.itinerary, "routing reconciliation is idempotent");

const currentRouteItinerary = structuredClone(crossDayItinerary);
currentRouteItinerary.daily_itinerary[1].live_timeline[0].location_name = hotel.location_name;
currentRouteItinerary.daily_itinerary[1].live_timeline[0].coordinates = { latitude: 46.1, longitude: -64.7 };
const currentRoute = applyConfirmedBookingOverrideToItinerary(currentRouteItinerary, {
  ...hotel,
  start_at: "2026-10-11T00:30:00Z",
  coordinates: { latitude: 46.1, longitude: -64.7 }
});
assert.equal(currentRoute.itinerary.daily_itinerary[0].live_timeline[0].routing_status, "FEASIBLE", "exact current route evidence remains usable");
assert.equal(currentRoute.itinerary.daily_itinerary[0].live_timeline[0].travelTimeMinutes, 35, "current route duration is preserved from evidence");

const missingBookingLocation = applyConfirmedBookingOverrideToItinerary(currentRouteItinerary, {
  ...hotel,
  start_at: "2026-10-11T00:30:00Z",
  location_name: null,
  address: null,
  coordinates: null
});
assert.equal(missingBookingLocation.itinerary.daily_itinerary[1].live_timeline[0].location_name, hotel.location_name, "missing booking location does not erase an existing factual anchor");
assert.equal(missingBookingLocation.itinerary.daily_itinerary[0].live_timeline[0].routing_status, "FEASIBLE", "missing booking location does not falsely invalidate exact current route evidence");

const uncertainRoute = applyConfirmedBookingOverrideToItinerary(baseItinerary([{
  item_id: "airport-item",
  item_type: "transfer",
  title: "Airport transfer",
  description: "Transfer",
  location_name: "Old Hotel Area",
  time_label: "2:00 PM",
  startTime: "14:00",
  endTime: "14:45",
  estimated_cost: null,
  category: "Transfer",
  map_query: "Old Hotel Area",
  routing_status: "FEASIBLE",
  travelTimeMinutes: 45,
  durationMinutes: 45
}, {
  ...selectedHotel,
  candidateId: "hotel-candidate-1"
}]), {
  ...hotel,
  coordinates: null,
  location_name: "New Hotel Address"
});
const uncertainTransfer = uncertainRoute.itinerary.daily_itinerary[0].live_timeline[0];
assert.equal(uncertainTransfer.routing_status, "UNCERTAIN", "missing current route evidence remains uncertain");
assert.equal(uncertainTransfer.travelTimeMinutes, undefined, "missing route evidence cannot retain an old duration");

console.log("confirmed booking canonical itinerary reconciliation checks passed");
