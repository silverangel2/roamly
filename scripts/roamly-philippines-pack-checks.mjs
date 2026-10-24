/*
 * Philippines pack checks (Roamly PH launch, P0/P1).
 *
 * Asserts the launch plan's hard standards against the real pack data:
 *  1. All 7 v1 destination areas exist, each with >= 8 activities.
 *  2. EVERY activity carries numeric coordinates inside Philippines
 *     bounds, a Google place ID, an ESTIMATED cost status, and a
 *     plain-words cost basis — no coordinate, no activity.
 *  3. No duplicate place IDs.
 *  4. The pack's destination centres are registered in the engine
 *     destination registry (PRODUCTION_DESTINATION_SEEDS).
 *  5. Every PH planner label resolves in recommendedPlaces with
 *     currency PHP and timezone Asia/Manila, and matchRecommendedPlace
 *     finds it exactly (the /ph -> /plan deep-link contract).
 *  6. formatPeso renders the peso sign.
 *  7. A 5-day sample itinerary builds end-to-end through the app's own
 *     itinerary machinery: 5 days, every item carries coordinates,
 *     item costs survive sanitization, and costs are peso amounts.
 *  8. The /ph page and the TripPlanForm deep-link resolution exist in
 *     source (static asserts, the repo's usual pattern).
 */
import { readFileSync } from "node:fs";
import {
  PHILIPPINES_AREAS,
  PH_PACK_CURRENCY,
  buildPhilippinesSampleItinerary,
  formatPeso,
  philippinesActivityCount
} from "../lib/roamly/philippinesPack.ts";
import { PRODUCTION_DESTINATION_SEEDS } from "../lib/roamly/engine/packs/destinations.ts";
import { matchRecommendedPlace, recommendedPlaces } from "../lib/roamly/places.ts";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ok — ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const EXPECTED_AREAS = ["manila", "boracay", "palawan", "cebu-bohol", "siargao", "baguio", "davao-samal"];
check("pack currency is PHP", PH_PACK_CURRENCY === "PHP");
check(
  "all 7 destination areas present",
  EXPECTED_AREAS.every((key) => PHILIPPINES_AREAS.some((area) => area.key === key)),
  PHILIPPINES_AREAS.map((a) => a.key).join(",")
);

const placeIds = new Set();
let totalActivities = 0;
for (const area of PHILIPPINES_AREAS) {
  check(`${area.displayName}: at least 8 activities`, area.activities.length >= 8, `${area.activities.length}`);
  for (const activity of area.activities) {
    totalActivities += 1;
    const coords = activity.coordinates;
    const lat = coords?.latitude;
    const lon = coords?.longitude;
    check(
      `${area.displayName} / ${activity.title}: coordinates present and in PH bounds`,
      typeof lat === "number" && typeof lon === "number" && lat >= 4 && lat <= 19.5 && lon >= 116 && lon <= 127.5,
      JSON.stringify(coords)
    );
    check(`${area.displayName} / ${activity.title}: google place id`, typeof activity.google_place_id === "string" && activity.google_place_id.length > 8);
    check(`${area.displayName} / ${activity.title}: unique place id`, !placeIds.has(activity.google_place_id), activity.google_place_id);
    placeIds.add(activity.google_place_id);
    check(
      `${area.displayName} / ${activity.title}: cost honesty (ESTIMATED + basis + numeric cost)`,
      activity.cost_status === "ESTIMATED" &&
        typeof activity.cost_basis === "string" &&
        activity.cost_basis.length > 12 &&
        typeof activity.estimated_cost === "number"
    );
    check(
      `${area.displayName} / ${activity.title}: seed shape (map query, location, category)`,
      activity.map_query.length > 4 && activity.location_name.length > 2 && activity.category.length > 2 && activity.item_type === "activity"
    );
  }
}
check("activity count matches helper", philippinesActivityCount() === totalActivities, `${totalActivities}`);

const registryNames = new Set(PRODUCTION_DESTINATION_SEEDS.filter((d) => d.country === "Philippines").map((d) => d.displayName));
for (const name of ["Manila", "Boracay", "El Nido", "Coron", "Puerto Princesa", "Cebu City", "Bohol", "Siargao", "Baguio", "Davao City", "Samal Island"]) {
  check(`registry has Philippines destination: ${name}`, registryNames.has(name));
}
for (const seed of PRODUCTION_DESTINATION_SEEDS.filter((d) => d.country === "Philippines")) {
  check(
    `registry ${seed.displayName}: centre in PH bounds + Asia/Manila`,
    seed.centre.lat >= 4 && seed.centre.lat <= 19.5 && seed.centre.lon >= 116 && seed.centre.lon <= 127.5 && seed.timeZone === "Asia/Manila"
  );
}

for (const area of PHILIPPINES_AREAS) {
  for (const link of area.planLinks) {
    const matched = matchRecommendedPlace(link.plannerLabel);
    check(
      `${area.displayName}: planner label "${link.plannerLabel}" resolves with PHP + Asia/Manila`,
      Boolean(matched) && matched.currency === "PHP" && matched.timezone === "Asia/Manila"
    );
  }
}
const phPlaces = recommendedPlaces.filter((p) => p.country === "Philippines");
check("recommendedPlaces carries the 10 PH destinations", phPlaces.length === 10, `${phPlaces.length}`);
check("matchRecommendedPlace returns null for unknown places", matchRecommendedPlace("Atlantis, Ocean") === null);
check("formatPeso renders ₱", formatPeso(1200).includes("₱"), formatPeso(1200));
check("formatPeso(0) renders ₱0 (page prints 'Free' itself)", formatPeso(0).includes("₱"), formatPeso(0));

const sample = buildPhilippinesSampleItinerary("cebu-bohol", 5);
check("sample itinerary has 5 days", sample.daily_itinerary.length === 5, `${sample.daily_itinerary.length}`);
let sampleItems = 0;
let sampleCost = 0;
for (const day of sample.daily_itinerary) {
  check(`sample day ${day.day_number} has activities`, day.live_timeline.length >= 1);
  for (const item of day.live_timeline) {
    sampleItems += 1;
    const coords = item.coordinates;
    check(
      `sample day ${day.day_number} / ${item.title}: coordinates survived the itinerary pipeline`,
      typeof coords?.latitude === "number" && typeof coords?.longitude === "number",
      JSON.stringify(coords)
    );
    check(`sample day ${day.day_number} / ${item.title}: cost present`, typeof item.estimated_cost === "number", `${item.estimated_cost}`);
    sampleCost += item.estimated_cost ?? 0;
  }
}
check("sample itinerary carries a real number of pack activities", sampleItems >= 12, `${sampleItems}`);
check("sample itinerary peso total is positive", sampleCost > 0, `${sampleCost}`);

const phPage = readFileSync(new URL("../app/ph/page.tsx", import.meta.url), "utf8");
check("/ph page builds from the pack", phPage.includes("PHILIPPINES_AREAS") && phPage.includes("buildPhilippinesSampleItinerary"));
check("/ph page labels estimates honestly", phPage.includes("estimates in Philippine pesos"));
const form = readFileSync(new URL("../components/plan/TripPlanForm.tsx", import.meta.url), "utf8");
check(
  "TripPlanForm resolves deep-linked destinations against recommended places (x2) and applies their currency",
  (form.match(/matchRecommendedPlace\(/g) || []).length >= 2 && form.includes("setBudgetCurrency(known")
);

if (failures) {
  console.error(`\nPhilippines pack checks FAILED (${failures}).`);
  process.exit(1);
}
console.log(`\nPhilippines pack checks passed (${totalActivities} activities, ${sampleItems} sample items, ₱${sampleCost} sample total).`);
