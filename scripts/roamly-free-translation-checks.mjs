/**
 * Free-translation checks (LibreTranslate, no paid API).
 *
 * Run with a local LibreTranslate server up:
 *   LIBRETRANSLATE_URL=http://localhost:5000 npm run test:free-translation
 * (node --experimental-strip-types --import ./scripts/roamly-test-register.mjs
 *  scripts/roamly-free-translation-checks.mjs)
 *
 * Proves, against the real engine, on a fixture shaped like a real
 * RoamlyItinerary (see lib/itinerary.ts):
 *  1. Real prose translates to French and Spanish (day titles, summaries,
 *     activity descriptions, tips, checklist items).
 *  2. Protected facts survive byte-for-byte: proper nouns (city, country,
 *     location names), providers, URLs, search queries, stable ids, enum
 *     values, times, timezones, and currency codes.
 *  3. A sentence carrying a booking code is preserved whole (Argos
 *     mangles codes inside prose — verified 2026-11-12).
 *  4. A sentence carrying a price still translates, with the amount's digits
 *     intact.
 *  5. Translation is deterministic — the same input gives the same output
 *     (the route's stored-translation short-circuit is what keeps a live
 *     trip from ever being translated twice).
 *  6. With no LIBRETRANSLATE_URL configured, translation fails honestly with
 *     TRANSLATION_NOT_CONFIGURED (503) — never a silent paid fallback.
 */
import assert from "node:assert/strict";
import { translateRoamlyItinerary } from "@/lib/ai/roamly-itinerary";

const endpoint = (process.env.LIBRETRANSLATE_URL || "").trim();
if (!endpoint) {
  console.log("SKIP: set LIBRETRANSLATE_URL to a running LibreTranslate server to run this check.");
  process.exit(0);
}

const fixture = {
  trip_title: "Rome in 3 days",
  destination_summary: "Three days in Rome, from ancient ruins to lively evening streets.",
  best_for: ["History lovers", "Food lovers"],
  route_reasoning: "The route stays central so every stop is a short walk away.",
  budget_fit_summary: "Fits your CA$1,500 budget with room to spare.",
  booking_status_summary: "No bookings confirmed yet.",
  free_or_low_cost_notes: ["Many churches are free to enter."],
  estimated_budget_breakdown: {
    lodging: "Mid-range hotels near the centre.",
    food: "Pasta, pizza, and coffee every day.",
    activities: "Museums and guided tours.",
    transport: "Metro and walking.",
    buffer: "Some money kept aside for surprises.",
    total_estimate: "About CA$1,200 for 3 days.",
    notes: "Prices are estimates, not promises.",
    currency: "CAD",
    budget_verdict: "comfortable",
    budget_status: "within_budget"
  },
  hotel_area_suggestions: ["Stay near Trastevere for evening meals."],
  transport_overview: "Fly into Rome, then walk and use the metro.",
  daily_itinerary: [
    {
      day_id: "day-1",
      day_number: 1,
      date: "2026-12-10",
      city: "Rome",
      title: "Ancient Rome and the Colosseum",
      morning: "Walk through ancient history in the morning light.",
      afternoon: "Taste real Roman food for lunch near the Forum.",
      evening: "Watch the sunset from a rooftop bar.",
      food: ["Fresh pasta", "Gelato after dinner"],
      estimated_cost: 85,
      map_queries: ["Colosseum tickets Rome", "Trastevere restaurants"],
      live_timeline: [
        {
          item_id: "item-1",
          time_label: "9:00 AM",
          startTime: "09:00",
          endTime: "12:00",
          title: "Visit the Colosseum",
          description: "Book a guided tour in the morning before the crowds arrive.",
          location_name: "Colosseum",
          estimated_cost: 35,
          category: "activity",
          map_query: "Colosseum tickets Rome",
          item_type: "activity"
        }
      ],
      protected_anchors: ["Colosseum guided tour at 9am"],
      must_do_items: ["Colosseum guided tour"],
      plan_status: "coherent"
    }
  ],
  packing_checklist: ["Comfortable walking shoes", "Portable charger"],
  local_tips: ["Your confirmation code is VAT-2026-8841 for the tour."],
  safety_notes: ["Keep your bag closed on crowded buses."],
  emergency_notes: ["The nearest hospital is a short taxi ride away."],
  booking_suggestions: [
    {
      title: "Colosseum guided tour",
      description: "A guided walk through the arena and the Forum.",
      location: "Colosseum",
      city: "Rome",
      country: "Italy",
      provider: "Klook",
      booking_label: "Book activity",
      normal_search_url: "https://www.klook.com/search/?query=Colosseum",
      booking_status: "search_ready",
      free_or_paid: "paid",
      category: "activity",
      booking_category: "activity",
      event_timezone: "Europe/Rome"
    }
  ],
  pre_trip_essentials: [
    {
      title: "Portable charger",
      reason: "Your phone will run out of battery by the afternoon.",
      category: "gear",
      search_query: "portable charger travel",
      amazon_url: "https://www.amazon.com/dp/B012345678",
      priority: "high"
    }
  ],
  regenerate_suggestions: ["Add a day trip to the coast."],
  generation_note: "Built around your budget and your must-do list."
};

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

const protectedValues = [
  "Rome",
  "Italy",
  "Colosseum",
  "Klook",
  "https://www.klook.com/search/?query=Colosseum",
  "https://www.amazon.com/dp/B012345678",
  "Colosseum tickets Rome",
  "Trastevere restaurants",
  "portable charger travel",
  "day-1",
  "item-1",
  "2026-12-10",
  "09:00",
  "12:00",
  "Europe/Rome",
  "CAD",
  "coherent",
  "comfortable",
  "within_budget",
  "search_ready",
  "paid",
  "activity",
  "high",
  "Colosseum guided tour at 9am",
  "Colosseum guided tour"
];

for (const language of ["fr", "es"]) {
  const translated = await translateRoamlyItinerary({ itinerary: fixture, language });
  const before = collectStrings(fixture);
  const after = collectStrings(translated);

  // Same shape: same number of strings, same non-string values.
  assert.equal(after.length, before.length, `${language}: string count changed`);
  assert.equal(translated.daily_itinerary[0].estimated_cost, 85, `${language}: number changed`);
  assert.equal(translated.estimated_budget_breakdown.currency, "CAD", `${language}: currency changed`);

  // Protected facts survive byte-for-byte.
  for (const kept of protectedValues) {
    assert.ok(after.includes(kept), `${language}: protected value lost: ${kept}`);
  }

  // Real prose actually moved.
  const changed = before.filter((text, index) => text !== after[index]);
  assert.ok(changed.length >= 15, `${language}: only ${changed.length} strings changed, expected prose to move`);
  assert.notEqual(translated.daily_itinerary[0].title, fixture.daily_itinerary[0].title, `${language}: day title untranslated`);
  assert.notEqual(translated.daily_itinerary[0].morning, fixture.daily_itinerary[0].morning, `${language}: morning untranslated`);
  assert.notEqual(translated.destination_summary, fixture.destination_summary, `${language}: destination summary untranslated`);
  assert.notEqual(translated.trip_title, fixture.trip_title, `${language}: trip title untranslated`);

  // A sentence carrying a booking code is preserved whole (Argos mangles codes).
  assert.ok(
    translated.local_tips.includes("Your confirmation code is VAT-2026-8841 for the tour."),
    `${language}: code sentence was not preserved whole`
  );

  // A sentence carrying a price still translates, with the amount's digits intact.
  const priceDigits = (value) => value.replace(/[^0-9]/g, "");
  assert.notEqual(translated.budget_fit_summary, fixture.budget_fit_summary, `${language}: price sentence untranslated`);
  assert.ok(priceDigits(translated.budget_fit_summary).includes("1500"), `${language}: price digits lost: ${translated.budget_fit_summary}`);

  console.log(`  ${language}: ${changed.length}/${before.length} strings translated; protected values intact`);
  console.log(`    day 1 title -> ${translated.daily_itinerary[0].title}`);
  console.log(`    budget line -> ${translated.budget_fit_summary}`);
}

// Determinism: translating the same itinerary twice gives the same result.
const once = await translateRoamlyItinerary({ itinerary: fixture, language: "fr" });
const again = await translateRoamlyItinerary({ itinerary: fixture, language: "fr" });
assert.deepEqual(again, once, "fr: same input gave different output");
console.log("  determinism: same input gives the same result");

// Honest failure when the service is not configured.
const savedUrl = process.env.LIBRETRANSLATE_URL;
delete process.env.LIBRETRANSLATE_URL;
let notConfigured = null;
try {
  await translateRoamlyItinerary({ itinerary: fixture, language: "fr" });
} catch (error) {
  notConfigured = error;
} finally {
  process.env.LIBRETRANSLATE_URL = savedUrl;
}
assert.ok(notConfigured, "expected an error when LIBRETRANSLATE_URL is unset");
assert.equal(notConfigured.code, "TRANSLATION_NOT_CONFIGURED", `unexpected error code: ${notConfigured.code}`);
assert.equal(notConfigured.status, 503, `unexpected error status: ${notConfigured.status}`);
console.log("  unconfigured: fails honestly with TRANSLATION_NOT_CONFIGURED (503)");

console.log("PASS: free-translation checks (LibreTranslate)");
