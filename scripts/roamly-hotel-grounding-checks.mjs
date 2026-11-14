// Hotel-grounding gap — proof harness (2026-11-13; fix gated 2026-11-13).
// Proves, from the LIVE stored bytes of the Rome + KL tester trips:
//   1. Both stored itineraries fail final validation with hotel-search errors (KF-1, live).
//   2. FIXED (Defect 1): the grounded decision NEVER selects the Stay22 SEARCH QUERY
//      as the hotel — selectedHotelCandidateId is null when no named hotel exists,
//      even when named pack hotels are in the pool (tie-break). The search query
//      stays the best available RECOMMENDATION so the budget ledger keeps its
//      unknown-amount hotel line (budget stays honestly BUDGET_UNCERTAIN).
//   3. runStagedFinalValidation CAN rebind Rome's hotel items to a named pack hotel
//      (sanitize), but that validated copy is never what gets stored (Defect 2):
//      persistItinerary re-assembles from state instead of persisting the validated
//      copy. FIXED: persistItinerary accepts the validated itinerary and
//      completeGeneration passes it in both branches.
//   4. KL has no named hotel candidate anywhere, so sanitize can only remove the
//      hotel items and the multi-day rule still fails — the KL leg needs Defect 1
//      fixed (never select a search query), which keeps the engine's own anchor titles.
//   5. FIXED PIPELINE (end to end): with the fixed decision, enforceSelectedHotel-
//      Identity leaves the engine's anchor-titled hotel items alone and the
//      itinerary PASSES final validation for both KL and Rome — including when a
//      STALE decision still names the search query (enforce guard).
//   6. §6 FIX (2026-11-13): the repair-added check-in/check-out actions are
//      operational reminders, NOT stays. Typed "hotel" they were ungrounded
//      hotel items (no candidateId, no factualStatus) that final validation
//      rejects — the repair added an item the validator then failed (KL
//      advance: 9 errors -> 1, the single remaining error). §§1-5 never
//      exercise this path: the stored bytes' last days already carry a
//      complete departure structure, so the repair is a no-op there. §6
//      builds RAW engine-like days (last day WITHOUT the departure
//      structure, Day 1 WITHOUT arrival travel) and runs the real
//      production path: repair (assemble step) then runStagedFinalValidation.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs
//        --import ./scripts/roamly-test-server-only-register.mjs
//        scripts/roamly-hotel-grounding-checks.mjs
// Data: live read-only snapshots in
//   ~/workspace/goals/roamly-october-4-repair/hidden_files/hotel-grounding-fix-2026-11-13/
//   (trips.json, discoveries.json, itineraries.json — PostgREST reads, no writes).
import { readFileSync } from "node:fs";
import { repairItineraryForTravelRequirements, validateItineraryForProduction } from "@/lib/itinerary";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import { runStagedFinalValidation } from "@/lib/roamly/stagedItineraryGeneration";
import { buildGroundedDecisionCore } from "@/lib/roamly/candidateDecisionCore";
import { enforceSelectedHotelIdentity } from "@/lib/roamly/selectedHotelIdentity";

const DATA = `${process.env.HOME}/workspace/goals/roamly-october-4-repair/hidden_files/hotel-grounding-fix-2026-11-13`;
const trips = JSON.parse(readFileSync(`${DATA}/trips.json`, "utf8"));
const discoveries = JSON.parse(readFileSync(`${DATA}/discoveries.json`, "utf8"));
const itineraries = JSON.parse(readFileSync(`${DATA}/itineraries.json`, "utf8"));

const ROME_TRIP = "a41343d5-2760-4867-9f26-4dea64c1c275";
const KL_TRIP = "464e9a94-0ece-4ac5-aa73-78f2b3582314";
const ROME_DISC = "17cd073d-924e-4db7-adb2-eab4ed10f7c5";
const KL_DISC = "caa9d464-493d-443f-b4f8-92d358490b17";
const ROME_SEARCH_ID = "21f52f77-02cf-40d5-99bd-82589736cd6f";
const KL_SEARCH_ID = "38b2615d-a6ff-45ac-ab6b-01e0b10b270c";

const romeDisc = discoveries.find((r) => r.id === ROME_DISC);
const klDisc = discoveries.find((r) => r.id === KL_DISC);
const romeItin = itineraries.find((r) => r.trip_id === ROME_TRIP).full_json;
const klItin = itineraries.find((r) => r.trip_id === KL_TRIP).full_json;

const romePayload = {
  destination: "Rome",
  destinationCity: "Rome",
  destinationCountry: "Italy",
  origin: "Saint John",
  originCity: "Saint John",
  originCountry: "Canada",
  startDate: "2026-11-20",
  endDate: "2026-11-24",
  daysCount: 5,
  travelers: { adults: 1, children: 0, infants: 0 },
  travelersCount: 1,
  rooms: 1,
  budgetAmount: 3000,
  budgetCurrency: "CAD",
  returnToOrigin: true,
  priceDiscoveryId: ROME_DISC,
  priceDiscovery: romeDisc.metadata
};
const klPayload = {
  destination: "Kuala Lumpur",
  destinationCity: "Kuala Lumpur",
  destinationCountry: "Malaysia",
  origin: "Saint John",
  originCity: "Saint John",
  originCountry: "Canada",
  startDate: "2026-11-14",
  endDate: "2026-11-17",
  daysCount: 4,
  travelers: { adults: 2, children: 0, infants: 0 },
  travelersCount: 2,
  rooms: 1,
  budgetAmount: 1700,
  budgetCurrency: "CAD",
  returnToOrigin: true,
  priceDiscoveryId: KL_DISC,
  priceDiscovery: klDisc.metadata
};

function hotelTitles(itinerary) {
  const out = [];
  for (const day of itinerary.daily_itinerary || []) {
    for (const item of day.live_timeline || []) {
      if ((item.item_type || item.type) === "hotel") out.push(`Day ${day.day_number}: ${item.title}`);
    }
  }
  return out;
}

let failures = 0;
function check(name, ok, evidence) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` — ${evidence}` : ""}`);
  if (!ok) failures += 1;
}

// 1. Stored itineraries fail validation with the hotel-search errors (KF-1, live bytes).
const romeValidation = validateItineraryForProduction(romeItin, romePayload);
const klValidation = validateItineraryForProduction(klItin, klPayload);
console.log("ROME stored errors:", JSON.stringify(romeValidation.errors, null, 1));
console.log("KL stored errors:", JSON.stringify(klValidation.errors, null, 1));
check(
  "1a Rome stored itinerary FAILS validation with hotel search errors",
  !romeValidation.ok && romeValidation.errors.some((e) => e.includes("Rome hotel search")),
  `${romeValidation.errors.length} errors`
);
check(
  "1b KL stored itinerary FAILS validation with hotel errors (4 days x 2 + multi-day rule)",
  !klValidation.ok &&
    klValidation.errors.filter((e) => e.includes("hotel search")).length === 8 &&
    klValidation.errors.some((e) => e.includes("Multi-day itinerary names no hotel")),
  `${klValidation.errors.length} errors`
);

// 2. FIXED (Defect 1): the grounded decision never SELECTS the search query as the hotel.
const romeRaw = (romeDisc.metadata.marketResults || []).filter((r) => r.provider !== "Roamly destination pack");
const klRaw = klDisc.metadata.marketResults || [];
console.log(`Rome raw market results: ${romeRaw.length} (of ${(romeDisc.metadata.marketResults || []).length} stored)`);
const romeDecisionRaw = buildGroundedDecisionCore({ payload: romePayload, marketResults: romeRaw });
const klDecision = buildGroundedDecisionCore({ payload: klPayload, marketResults: klRaw });
const romeDecisionAll = buildGroundedDecisionCore({ payload: romePayload, marketResults: romeDisc.metadata.marketResults || [] });
function decisionCheck(name, decision, searchId) {
  const hotelLine = (decision.budgetLedger.lines || []).find((line) => line.category === "hotel");
  check(
    name,
    decision.selectedHotelCandidateId === null &&
      decision.recommendations.hotel.recommendedCandidateId === searchId &&
      hotelLine?.amount === null &&
      hotelLine?.priceStatus === "unknown" &&
      decision.budgetLedger.status === "BUDGET_UNCERTAIN",
    `selected=${decision.selectedHotelCandidateId} recommended=${decision.recommendations.hotel.recommendedCandidateId} hotelLine=${JSON.stringify(hotelLine)} budget=${decision.budgetLedger.status}`
  );
}
decisionCheck(
  "2a KL grounded decision selects NO hotel (search query never selected; recommendation + unknown ledger line kept)",
  klDecision,
  KL_SEARCH_ID
);
decisionCheck(
  "2b Rome grounded decision (raw search results, as production builds it) selects NO hotel",
  romeDecisionRaw,
  ROME_SEARCH_ID
);
decisionCheck(
  "2c Rome grounded decision selects NO hotel even with all 37 stored results incl. 6 named pack hotels",
  romeDecisionAll,
  ROME_SEARCH_ID
);

// 3. The final-validation sanitize CAN rebind Rome to a named hotel — but that copy is discarded (Defect 2).
const romeFinal = runStagedFinalValidation(romeItin, romePayload);
const romeFinalTitles = hotelTitles(romeFinal.itinerary);
console.log("ROME after runStagedFinalValidation hotel titles:", JSON.stringify(romeFinalTitles));
check(
  "3a runStagedFinalValidation on stored Rome PASSES (sanitize rebinds hotel to a named pack hotel)",
  romeFinal.validation.ok === true,
  `attempts=${romeFinal.validationAttemptCount} errors=${JSON.stringify(romeFinal.validation.errors)}`
);
check(
  "3b validated Rome copy carries NO search-titled hotel item",
  romeFinalTitles.every((t) => !/hotel search/i.test(t)),
  romeFinalTitles.join(" | ")
);
check(
  "3c validated Rome copy DIFFERS from the stored bytes (what validation passes on is not what is stored)",
  JSON.stringify(romeFinalTitles) !== JSON.stringify(hotelTitles(romeItin)),
  `stored=${hotelTitles(romeItin).join(" | ")}`
);

// 4. KL has no named hotel candidate anywhere: sanitize can only remove the items.
const klFinal = runStagedFinalValidation(klItin, klPayload);
const klFinalTitles = hotelTitles(klFinal.itinerary);
console.log("KL after runStagedFinalValidation hotel titles:", JSON.stringify(klFinalTitles));
console.log("KL after runStagedFinalValidation errors:", JSON.stringify(klFinal.validation.errors));
check(
  "4a runStagedFinalValidation on stored KL still FAILS (no named hotel in the pool)",
  klFinal.validation.ok === false,
  `attempts=${klFinal.validationAttemptCount}`
);
check(
  "4b KL hotel items after final validation: NONE — the repair-added checkout item is now a reminder, not a hotel item (§6 fix: operational check-in/check-out actions are not stays)",
  klFinalTitles.length === 0 &&
    (klFinal.itinerary.daily_itinerary || []).some((day) =>
      (day.live_timeline || []).some((item) => item.title === "Hotel checkout and luggage check" && item.item_type === "reminder")
    ),
  JSON.stringify(klFinalTitles)
);
check(
  "4c KL remaining failure is ONLY the multi-day rule (no named hotel in the pool); the checkout item no longer fails",
  klFinal.validation.errors.length === 1 &&
    klFinal.validation.errors.some((e) => e.includes("Multi-day itinerary names no hotel")) &&
    !klFinal.validation.errors.some((e) => e.includes("Hotel checkout")),
  JSON.stringify(klFinal.validation.errors)
);

// 5. FIXED PIPELINE: with the fixed decision, enforce leaves the engine's anchor-titled
// hotel items alone and the itinerary PASSES final validation (both trips).
// The engine emits hotel items titled with its anchor name before enforce runs; the
// stored bytes above are what enforce produced AFTER stamping the search query, so
// restore the anchor titles to reconstruct the pre-enforce itinerary.
function engineStyleItinerary(stored, anchorTitle) {
  const copy = JSON.parse(JSON.stringify(stored));
  for (const day of copy.daily_itinerary || []) {
    for (const item of day.live_timeline || []) {
      if ((item.item_type || item.type) === "hotel" && /hotel search/i.test(item.title || "")) {
        item.title = anchorTitle;
        item.candidateId = null;
        item.factualStatus = "search_ready";
      }
    }
  }
  return copy;
}
const klEngine = engineStyleItinerary(klItin, "Kuala Lumpur centre (base anchor)");
const romeEngine = engineStyleItinerary(romeItin, "Charming Pantheon Apartment");
const klEnforced = enforceSelectedHotelIdentity(klEngine, { priceDiscovery: { groundedDecision: klDecision } });
const romeEnforced = enforceSelectedHotelIdentity(romeEngine, { priceDiscovery: { groundedDecision: romeDecisionRaw } });
const klEnforcedValidation = validateItineraryForProduction(klEnforced, klPayload);
const romeEnforcedValidation = validateItineraryForProduction(romeEnforced, romePayload);
check(
  "5a KL fixed pipeline PASSES final validation (engine anchor titles survive enforce)",
  klEnforcedValidation.ok === true && hotelTitles(klEnforced).every((t) => t.includes("Kuala Lumpur centre (base anchor)")),
  `errors=${JSON.stringify(klEnforcedValidation.errors)} titles=${hotelTitles(klEnforced).join(" | ")}`
);
check(
  "5b Rome fixed pipeline PASSES final validation (engine anchor titles survive enforce)",
  romeEnforcedValidation.ok === true && hotelTitles(romeEnforced).every((t) => t.includes("Charming Pantheon Apartment")),
  `errors=${JSON.stringify(romeEnforcedValidation.errors)} titles=${hotelTitles(romeEnforced).join(" | ")}`
);
// 5c. Enforce guard: even a STALE decision that still names the search query must
// never stamp it onto the timeline.
const staleDecision = {
  selectedHotelCandidateId: ROME_SEARCH_ID,
  candidates: [{ candidateId: ROME_SEARCH_ID, category: "hotel", name: "Rome hotel search", source: "stay22", sourceType: "fallback", factualStatus: "search_ready" }]
};
const romeGuarded = enforceSelectedHotelIdentity(romeEngine, { priceDiscovery: { groundedDecision: staleDecision } });
const romeGuardedValidation = validateItineraryForProduction(romeGuarded, romePayload);
check(
  "5c Enforce guard: stale search-query decision does NOT retitle hotel items (validation still passes)",
  hotelTitles(romeGuarded).every((t) => t.includes("Charming Pantheon Apartment")) && romeGuardedValidation.ok === true,
  `titles=${hotelTitles(romeGuarded).join(" | ")} errors=${JSON.stringify(romeGuardedValidation.errors)}`
);

// 6. §6 FIX: the repair path on RAW engine-like days (the KL advance path).
// The stored bytes' last days already carry the departure structure, so the
// repair never fires on them; the advance re-assembles from STATE, whose
// last generated day lacks it — that is where the checkout item came from.
const DEPARTURE_TITLES = new Set([
  "Hotel checkout and luggage check",
  "Luggage handling and departure documents",
  "Transfer to departure point",
  "Recommended flight departure buffer",
  "Recommended mixed transport departure buffer",
  "Return travel to Saint John",
  "Estimated arrival back in Saint John"
]);
function rawEngineItinerary(stored, anchorTitle) {
  const copy = engineStyleItinerary(stored, anchorTitle);
  const last = copy.daily_itinerary[copy.daily_itinerary.length - 1];
  last.live_timeline = last.live_timeline.filter((item) => !DEPARTURE_TITLES.has(item.title));
  return copy;
}
function findItem(itinerary, dayNumber, title) {
  const day = (itinerary.daily_itinerary || []).find((d) => d.day_number === dayNumber);
  return (day?.live_timeline || []).find((item) => item.title === title) || null;
}
const klRawEngine = rawEngineItinerary(klItin, "Kuala Lumpur centre (base anchor)");
const klRepaired = repairItineraryForTravelRequirements(klRawEngine, klPayload);
const klCheckout = findItem(klRepaired, 4, "Hotel checkout and luggage check");
check(
  "6a Repair on a last day WITHOUT a departure structure adds the checkout action as a REMINDER, not a hotel item",
  klCheckout !== null && klCheckout.item_type === "reminder",
  `type=${klCheckout?.item_type} title=${klCheckout?.title}`
);
check(
  "6a2 The repaired last day carries NO hotel-typed checkout item (the stay slot lives on Days 1-3)",
  hotelTitles(klRepaired).length === 3 && hotelTitles(klRepaired).every((t) => t.includes("Kuala Lumpur centre (base anchor)")),
  hotelTitles(klRepaired).join(" | ")
);
const klRepairedFinal = runStagedFinalValidation(klRepaired, klPayload);
const klFinalCheckout = findItem(klRepairedFinal.itinerary, 4, "Hotel checkout and luggage check");
check(
  "6b Fresh-generation path PASSES final validation (the KL advance path: repair then final validation)",
  klRepairedFinal.validation.ok === true,
  `attempts=${klRepairedFinal.validationAttemptCount} errors=${JSON.stringify(klRepairedFinal.validation.errors)}`
);
check(
  "6b2 The checkout action survives final validation with its own title and reminder type (not retitled into the anchor)",
  klFinalCheckout !== null && klFinalCheckout.item_type === "reminder",
  `type=${klFinalCheckout?.item_type} title=${klFinalCheckout?.title}`
);
// 6c. Day-1 arrival path: engine Day 1 WITHOUT arrival travel.
// Uncrowded fixture (hotel slot only) so the 6-item cap cannot hide the
// check-in action: it must survive as a reminder.
// NOTE (trade-off, verified by counterfactual): on a CROWDED Day 1 the
// 6-item cap ranks reminders last, so the check-in line can be dropped
// from the visible timeline — the old hotel type ranked it above
// activities and kept it. That is still strictly better than the old
// behaviour, where the same fallback failed the WHOLE trip at final
// validation; see 6c3.
const klNoArrival = JSON.parse(JSON.stringify(klEngine));
klNoArrival.daily_itinerary[0].live_timeline = klNoArrival.daily_itinerary[0].live_timeline.filter(
  (item) => (item.item_type || item.type) === "hotel"
);
const klArrivalRepaired = repairItineraryForTravelRequirements(klNoArrival, klPayload);
const klCheckin = findItem(klArrivalRepaired, 1, "Check in, store bags, and recover");
check(
  "6c Repair on a Day 1 WITHOUT arrival travel adds the check-in action as a REMINDER, not a hotel item",
  klCheckin !== null && klCheckin.item_type === "reminder",
  `type=${klCheckin?.item_type} title=${klCheckin?.title}`
);
const klArrivalFinal = runStagedFinalValidation(klArrivalRepaired, klPayload);
check(
  "6c2 Day-1 arrival path PASSES final validation",
  klArrivalFinal.validation.ok === true,
  `attempts=${klArrivalFinal.validationAttemptCount} errors=${JSON.stringify(klArrivalFinal.validation.errors)}`
);
// 6c3. Crowded Day 1 (full activity list): the check-in action may be
// dropped by the 6-item cap — but it must NEVER survive as an ungrounded
// hotel item, and validation must still pass.
const klNoArrivalCrowded = JSON.parse(JSON.stringify(klEngine));
klNoArrivalCrowded.daily_itinerary[0].live_timeline = klNoArrivalCrowded.daily_itinerary[0].live_timeline.filter(
  (item) => item.title !== "Travel from Saint John to Kuala Lumpur"
);
const klCrowdedRepaired = repairItineraryForTravelRequirements(klNoArrivalCrowded, klPayload);
const klCrowdedCheckin = findItem(klCrowdedRepaired, 1, "Check in, store bags, and recover");
const klCrowdedFinal = runStagedFinalValidation(klCrowdedRepaired, klPayload);
check(
  "6c3 Crowded Day 1: no ungrounded hotel-typed check-in item survives repair, and validation still passes",
  (klCrowdedCheckin === null || klCrowdedCheckin.item_type === "reminder") && klCrowdedFinal.validation.ok === true,
  `checkinType=${klCrowdedCheckin?.item_type} attempts=${klCrowdedFinal.validationAttemptCount} errors=${JSON.stringify(klCrowdedFinal.validation.errors)}`
);
// 6d. Enforce with a NAMED hotel actually selected (future priced-provider path):
// the stay slots take the selected name, the checkout action must keep its own title.
const namedDecision = {
  selectedHotelCandidateId: "pack:000491c4-7076-47e4-a089-c8ceee214054",
  candidates: [{
    candidateId: "pack:000491c4-7076-47e4-a089-c8ceee214054",
    category: "hotel",
    name: "Romantic Suite Colosseum",
    source: "Roamly destination pack",
    factualStatus: "search_ready"
  }]
};
// Stale-fixture note: the Nov 11 snapshot's market results + suggestions all
// expired Nov 11-12, so enrich falls back to Google Maps route links that the
// validator rejects for transport CTAs. At generation time they were fresh
// (Klook links, as the stored bytes prove). Refresh the expiries in the §6d
// fixture copies ONLY, to reproduce generation-time conditions; no
// production code is touched.
function freshFixture(payload, itinerary) {
  const fresh = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();
  const payloadCopy = JSON.parse(JSON.stringify(payload));
  for (const r of payloadCopy.priceDiscovery?.marketResults || []) {
    if (typeof r.expires_at === "string") r.expires_at = fresh;
    if (typeof r.searched_at === "string") r.searched_at = now;
  }
  const itineraryCopy = JSON.parse(JSON.stringify(itinerary));
  for (const s of itineraryCopy.booking_suggestions || []) {
    if (typeof s.expires_at === "string") s.expires_at = fresh;
    if (typeof s.searched_at === "string") s.searched_at = now;
  }
  return { payload: payloadCopy, itinerary: itineraryCopy };
}
const fresh6d = freshFixture(romePayload, rawEngineItinerary(romeItin, "Charming Pantheon Apartment"));
const romeRepaired = repairItineraryForTravelRequirements(fresh6d.itinerary, fresh6d.payload);
// Mirror assembleItinerary's order: repair -> enrich -> enforce -> validate.
// (Without enrich, the repair-added return-travel CTA has no booking URL and
// validation fails on the CTA, not on any hotel rule — a fixture artifact.)
const romeEnriched = enrichItineraryBookingSuggestions(romeRepaired, fresh6d.payload);
const romeEnforcedNamed = enforceSelectedHotelIdentity(romeEnriched, { priceDiscovery: { groundedDecision: namedDecision } });
const romeNamedCheckout = findItem(romeEnforcedNamed, 5, "Hotel checkout and luggage check");
check(
  "6d Enforce with a named hotel selected retitles the STAY slots but NEVER the checkout action",
  hotelTitles(romeEnforcedNamed).every((t) => t.includes("Romantic Suite Colosseum")) &&
    romeNamedCheckout !== null && romeNamedCheckout.item_type === "reminder",
  `hotelTitles=${hotelTitles(romeEnforcedNamed).join(" | ")} checkoutType=${romeNamedCheckout?.item_type}`
);
const romeNamedValidation = validateItineraryForProduction(romeEnforcedNamed, fresh6d.payload);
// 6d2 scope note (CTA FIX, 2026-11-13): the named-hotel enforce path used to
// report exactly one CTA error — "Day 5 CTA Open route uses the wrong
// provider" — on the mixed-transport departure BUFFER item: enrich attached the
// resolver's Google Maps directions fallback (provider google_maps, fired
// whenever Klook is unconfigured) while the validator requires transport CTAs
// to route through Klook. Proven independent of the §6 fix (reproduced
// identically on pre-fix main e5d43da7). FIXED in enrichTimelineItems
// (affiliateLinks.ts): a transport item whose resolved booking is the
// google_maps degradation carries NO CTA — the item text stays, only the
// button goes — exactly like an unconfigured flight item. The resolver is
// untouched (suggestions keep their legal Maps fallback) and the validator is
// untouched. The check below asserts the whole path now passes with ZERO
// errors; 6d3 pins the no-booking behaviour and 6d4 pins the Klook-configured
// counterfactual (the CTA survives when Klook IS configured, as in production).
check(
  "6d2 Named-hotel enforce path PASSES final validation with ZERO errors (mixed-transport buffer CTA fixed)",
  romeNamedValidation.ok === true && romeNamedValidation.errors.length === 0,
  `errors=${JSON.stringify(romeNamedValidation.errors)}`
);
// 6d3. In the Klook-less env, the buffer item carries NO booking, and NO
// timeline item anywhere carries a google_maps booking (the guard is general
// to transport items, not just the buffer title).
const romeNamedBuffer = findItem(romeEnforcedNamed, 5, "Recommended mixed transport departure buffer");
const googleMapsBookings = [];
for (const day of romeEnforcedNamed.daily_itinerary || []) {
  for (const item of day.live_timeline || []) {
    if (item.booking?.provider === "google_maps") googleMapsBookings.push(`Day ${day.day_number}: ${item.title}`);
  }
}
check(
  "6d3 Klook-less env: buffer item carries NO booking and no timeline item carries a google_maps booking",
  romeNamedBuffer !== null && romeNamedBuffer.booking === undefined && romeNamedBuffer.booking_label === undefined && googleMapsBookings.length === 0,
  `bufferBooking=${JSON.stringify(romeNamedBuffer?.booking)} googleMapsBookings=${JSON.stringify(googleMapsBookings)}`
);
// 6d4. Counterfactual: with Klook configured (as in production), the SAME path
// attaches the Klook CTA to the buffer item and validation still passes —
// the fix removes the CTA only when there is no Klook link, never when there is one.
const savedKlookPartner = process.env.ROAMLY_KLOOK_PARTNER_ID;
const savedKlookReferral = process.env.ROAMLY_KLOOK_REFERRAL_URL;
let klookBufferBooking = null;
let klookValidation = null;
try {
  process.env.ROAMLY_KLOOK_PARTNER_ID = "harness-klook-partner";
  delete process.env.ROAMLY_KLOOK_REFERRAL_URL;
  const fresh6d4 = freshFixture(romePayload, rawEngineItinerary(romeItin, "Charming Pantheon Apartment"));
  const repaired6d4 = repairItineraryForTravelRequirements(fresh6d4.itinerary, fresh6d4.payload);
  const enriched6d4 = enrichItineraryBookingSuggestions(repaired6d4, fresh6d4.payload);
  const enforced6d4 = enforceSelectedHotelIdentity(enriched6d4, { priceDiscovery: { groundedDecision: namedDecision } });
  klookBufferBooking = findItem(enforced6d4, 5, "Recommended mixed transport departure buffer")?.booking || null;
  klookValidation = validateItineraryForProduction(enforced6d4, fresh6d4.payload);
} finally {
  if (savedKlookPartner === undefined) delete process.env.ROAMLY_KLOOK_PARTNER_ID;
  else process.env.ROAMLY_KLOOK_PARTNER_ID = savedKlookPartner;
  if (savedKlookReferral === undefined) delete process.env.ROAMLY_KLOOK_REFERRAL_URL;
  else process.env.ROAMLY_KLOOK_REFERRAL_URL = savedKlookReferral;
}
check(
  "6d4 Klook configured: buffer item carries the Klook CTA and validation passes",
  klookBufferBooking !== null && klookBufferBooking.provider === "klook" && klookBufferBooking.ctaLabel === "View on Klook" &&
    klookValidation !== null && klookValidation.ok === true && klookValidation.errors.length === 0,
  `bufferBooking=${JSON.stringify(klookBufferBooking)} errors=${JSON.stringify(klookValidation?.errors)}`
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
