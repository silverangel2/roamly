import assert from "node:assert/strict";
import { enforceSelectedHotelIdentity } from "../lib/roamly/selectedHotelIdentity.ts";

const itinerary = (title = "Hotel Bonaventure Montréal", candidateId = "B") => ({
  daily_itinerary: [{ live_timeline: [{ item_type: "hotel", title, candidateId, source: "ai", location_name: title, estimated_cost: 999 }] }],
  booking_suggestions: [{ category: "hotel", booking_category: "hotel", title, candidateId, provider: "ai", affiliate_url: "https://stay22.com/generic", normal_search_url: "", estimated_cost_min: 999, estimated_cost_max: 999 }]
});
const state = (candidate, extra = {}) => ({ priceDiscovery: { groundedDecision: { selectedHotelCandidateId: candidate?.candidateId, candidates: candidate ? [candidate] : [] } }, ...extra });
const stateWithCandidates = (selectedId, candidates, extra = {}) => ({ priceDiscovery: { groundedDecision: { selectedHotelCandidateId: selectedId, candidates } }, ...extra });
const selected = { candidateId: "A", category: "hotel", sourceType: "provider_api", name: "Fairmont The Queen Elizabeth", address: "900 René-Lévesque Blvd W, Montréal", source: "Booking.com Demand API", providerPropertyId: "123", deepLink: "https://www.booking.com/hotel/fixture.html", factualStatus: "verified", totalStayPrice: 600, currency: "CAD" };

const normalized = enforceSelectedHotelIdentity(itinerary(), state(selected));
assert.equal(normalized.booking_suggestions[0].title, selected.name);
assert.equal(normalized.booking_suggestions[0].candidateId, "A");
assert.equal(normalized.booking_suggestions[0].provider_action_url, selected.deepLink);
assert.equal(normalized.booking_suggestions[0].provider_action_origin, "provider_response");
assert.equal(normalized.booking_suggestions[0].affiliate_url, "https://stay22.com/generic");
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
const noSelectionResult = enforceSelectedHotelIdentity(noSelection, state(null));
assert.equal(noSelectionResult.booking_suggestions[0].title, noSelection.booking_suggestions[0].title);
assert.equal(noSelectionResult.booking_suggestions[0].affiliate_url, noSelection.booking_suggestions[0].affiliate_url);
assert.equal(noSelectionResult.daily_itinerary[0].live_timeline[0].title, noSelection.daily_itinerary[0].live_timeline[0].title);

const unverified = enforceSelectedHotelIdentity(itinerary(), state({ ...selected, factualStatus: "search_ready", totalStayPrice: 600 }));
assert.equal(unverified.booking_suggestions[0].factual_status, "search_ready");
assert.equal(unverified.booking_suggestions[0].estimated_total_cost_min, undefined);
assert.notEqual(unverified.booking_suggestions[0].price_type, "live_partner");

const malicious = enforceSelectedHotelIdentity(itinerary(), state({ ...selected, deepLink: "https://evil.example/path" }));
assert.equal(malicious.booking_suggestions[0].provider_action_url, null);
assert.equal(malicious.booking_suggestions[0].provider_action_origin, undefined);

const candidateB = { ...selected, candidateId: "B", name: "Hotel Bonaventure Montréal", providerPropertyId: "456", deepLink: "https://www.booking.com/hotel/b.html" };
const crossLinked = enforceSelectedHotelIdentity(itinerary(), stateWithCandidates("A", [selected, candidateB]));
assert.equal(crossLinked.booking_suggestions[0].candidateId, "A");
assert.equal(crossLinked.booking_suggestions[0].provider_action_url, selected.deepLink);

const selfDeclared = enforceSelectedHotelIdentity({ daily_itinerary: [], booking_suggestions: [{ category: "hotel", booking_category: "hotel", title: "AI Hotel", provider_action_url: "https://www.booking.com/hotel/ai.html", provider_action_origin: "provider_response", factual_status: "verified", normal_search_url: "", estimated_cost_min: null, estimated_cost_max: null, currency: "CAD", description: "AI" }] }, state(null));
assert.equal(selfDeclared.booking_suggestions[0].provider_action_url, null);
assert.equal(selfDeclared.booking_suggestions[0].provider_action_origin, undefined);

console.log("Roamly selected hotel identity checks passed.");
