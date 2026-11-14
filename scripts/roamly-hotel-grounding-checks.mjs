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
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs
//        --import ./scripts/roamly-test-server-only-register.mjs
//        scripts/roamly-hotel-grounding-checks.mjs
// Data: live read-only snapshots in
//   ~/workspace/goals/roamly-october-4-repair/hidden_files/hotel-grounding-fix-2026-11-13/
//   (trips.json, discoveries.json, itineraries.json — PostgREST reads, no writes).
import { readFileSync } from "node:fs";
import { validateItineraryForProduction } from "@/lib/itinerary";
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
  "4b KL hotel items after final validation: exactly 1 left — the repair-added departure checkout item (sanitize removed the 4 search items)",
  klFinalTitles.length === 1 && klFinalTitles[0].includes("Hotel checkout and luggage check"),
  JSON.stringify(klFinalTitles)
);
check(
  "4c KL remaining failure is the ungrounded repair-added checkout item + the multi-day rule",
  klFinal.validation.errors.length === 2 &&
    klFinal.validation.errors.some((e) => e.includes("Hotel checkout and luggage check")) &&
    klFinal.validation.errors.some((e) => e.includes("Multi-day itinerary names no hotel")),
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

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
