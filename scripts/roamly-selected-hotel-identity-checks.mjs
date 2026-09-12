import assert from "node:assert/strict";
import { enforceSelectedHotelIdentity } from "../lib/roamly/selectedHotelIdentity.ts";

const itinerary = (title = "Hotel Bonaventure Montréal", candidateId = "B") => ({
  daily_itinerary: [{ live_timeline: [{ item_type: "hotel", title, candidateId, source: "ai", location_name: title, estimated_cost: 999 }] }],
  booking_suggestions: [{ category: "hotel", booking_category: "hotel", title, candidateId, provider: "ai", normal_search_url: "", estimated_cost_min: 999, estimated_cost_max: 999 }]
});
const state = (candidate, extra = {}) => ({ priceDiscovery: { groundedDecision: { selectedHotelCandidateId: candidate?.candidateId, candidates: candidate ? [candidate] : [] } }, ...extra });
const selected = { candidateId: "A", category: "hotel", name: "Fairmont The Queen Elizabeth", address: "900 René-Lévesque Blvd W, Montréal", source: "booking.com", providerPropertyId: "123", factualStatus: "verified", totalStayPrice: 600, currency: "CAD" };

const normalized = enforceSelectedHotelIdentity(itinerary(), state(selected));
assert.equal(normalized.booking_suggestions[0].title, selected.name);
assert.equal(normalized.booking_suggestions[0].candidateId, "A");
assert.equal(normalized.daily_itinerary[0].live_timeline[0].title, selected.name);
assert.equal(normalized.booking_suggestions[0].estimated_total_cost_min, 600);

const omitted = enforceSelectedHotelIdentity({ daily_itinerary: [], booking_suggestions: [] }, state(selected));
assert.equal(omitted.booking_suggestions[0].candidateId, "A");
assert.equal(omitted.booking_suggestions[0].title, selected.name);

const omittedUnknowns = enforceSelectedHotelIdentity({ daily_itinerary: [], booking_suggestions: [] }, state({ ...selected, currency: undefined, totalStayPrice: undefined }));
assert.equal(omittedUnknowns.booking_suggestions[0].currency, "");
assert.equal(omittedUnknowns.booking_suggestions[0].estimated_cost_min, null);

const confirmed = enforceSelectedHotelIdentity(itinerary(), state(selected, { confirmedBookings: [{ booking_type: "hotel", booking_status: "confirmed" }] }));
assert.equal(confirmed.booking_suggestions[0].title, "Hotel Bonaventure Montréal");

const awaitingConfirmation = enforceSelectedHotelIdentity(itinerary(), state(selected, { confirmedBookings: [{ booking_type: "hotel", booking_status: "needs_confirmation" }] }));
assert.equal(awaitingConfirmation.booking_suggestions[0].title, selected.name);

const noSelection = itinerary();
assert.deepEqual(enforceSelectedHotelIdentity(noSelection, state(null)), noSelection);

const unverified = enforceSelectedHotelIdentity(itinerary(), state({ ...selected, factualStatus: "search_ready", totalStayPrice: 600 }));
assert.equal(unverified.booking_suggestions[0].factual_status, "search_ready");
assert.equal(unverified.booking_suggestions[0].estimated_total_cost_min, undefined);
assert.notEqual(unverified.booking_suggestions[0].price_type, "live_partner");

console.log("Roamly selected hotel identity checks passed.");
