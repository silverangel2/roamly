import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function loadTsModule(entryFile) {
  const cache = new Map();

  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;

    const ext = path.extname(absolute);
    if (ext === ".json") return JSON.parse(fs.readFileSync(absolute, "utf8"));

    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText;

    const sandbox = {
      exports: {},
      module: { exports: {} },
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.match(/\.(ts|tsx|json)$/) ? resolved : `${resolved}.ts`);
        }
        return require(id);
      },
      URL,
      URLSearchParams,
      process
    };

    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }

  return load(entryFile);
}

const billing = read("lib/roamly/billing.ts");
assert.ok(billing.includes("validateStripePriceForPurchase"), "checkout must validate Stripe Prices server-side");
assert.ok(billing.includes("STRIPE_PRICE_MISSING"), "missing Stripe Price IDs must return a specific safe error");
assert.ok(billing.includes("STRIPE_PRICE_AMOUNT_MISMATCH"), "Stripe Price amount mismatch must be detected");
assert.ok(billing.includes("STRIPE_PRICE_CURRENCY_MISMATCH"), "Stripe Price currency mismatch must be detected");
assert.ok(billing.includes("getOrCreateStripeCustomer"), "checkout must create or reuse one Stripe customer per user");
assert.ok(billing.includes("findReusablePendingCheckoutSession"), "checkout must reuse open pending sessions to reduce duplicate checkout attempts");
assert.ok(!billing.includes("price_data"), "production checkout must not silently fall back to inline Stripe price_data");
assert.ok(billing.includes("handleStripeWebhookEvent"), "Stripe webhooks must use centralized processing");
assert.ok(billing.includes("stripe_webhook_event_processed"), "Stripe webhook events must be idempotent");
assert.ok(billing.includes("invoice.payment_succeeded") && billing.includes("invoice.payment_failed"), "invoice webhooks must be handled");
assert.ok(billing.includes("customer.subscription.updated") && billing.includes("customer.subscription.deleted"), "subscription lifecycle webhooks must be handled");

const payments = read("lib/payments.ts");
assert.ok(payments.includes("awaitingWebhook"), "success redirect must not grant paid access by itself");
assert.ok(!payments.includes("return applyPaidCheckoutSession(session);"), "success redirect must not call paid sync directly");

const checkoutRoute = read("app/api/stripe/create-trip-checkout/route.ts");
assert.ok(checkoutRoute.includes("code: checkout.error"), "checkout API must return stable safe error codes");
assert.ok(checkoutRoute.includes("INVALID_CHECKOUT_KIND"), "checkout API must reject invalid internal plan keys");
assert.ok(!checkoutRoute.includes("priceId"), "checkout API must not accept browser Price IDs");

const webhookRoute = read("app/api/stripe/webhook/route.ts");
assert.ok(webhookRoute.includes("request.text()"), "Stripe webhook must verify the raw request body");
assert.ok(webhookRoute.includes("constructEvent"), "Stripe webhook must verify signatures");
assert.ok(webhookRoute.includes("handleStripeWebhookEvent"), "Stripe webhook route must use centralized handler");

const affiliateResolver = read("lib/roamly/affiliateResolver.ts");
[
  "travelpayouts",
  "stay22",
  "klook",
  "amazon",
  "esim",
  "ROAMLY_TRAVELPAYOUTS_MARKER",
  "ROAMLY_STAY22_PARTNER_ID",
  "ROAMLY_KLOOK_PARTNER_ID",
  "ROAMLY_AMAZON_ASSOCIATE_TAG",
  "ROAMLY_ESIM_REFERRAL_URL"
].forEach((needle) => assert.ok(affiliateResolver.includes(needle), `affiliate resolver missing ${needle}`));
["booking\\.com", "google\\.com\\/travel\\/flights", "viator", "getyourguide"].forEach((needle) =>
  assert.ok(affiliateResolver.toLowerCase().includes(needle), `legacy provider guard missing ${needle}`)
);
assert.ok(!affiliateResolver.includes("source\", \"affiliate_fallback\""), "affiliate resolver must not send booking CTAs back to /plan");
assert.ok(affiliateResolver.includes('fallbackBehavior: isAffiliate ? "affiliate" : "hidden"'), "missing affiliate providers must hide CTAs, not create internal fallbacks");

const iataDataset = JSON.parse(read("lib/roamly/data/iata-airports.json"));
const cityDataset = JSON.parse(read("lib/roamly/data/geonames-cities15000.json"));
assert.ok(iataDataset.airports.length > 9000, "IATA resolver must use a broad airport dataset");
assert.ok(cityDataset.cities.length > 30000, "city resolver must use a broad global city dataset");

const placeResolverExports = loadTsModule("lib/roamly/placeResolver.ts");
const airportResolverExports = loadTsModule("lib/roamly/airportResolver.ts");
const bookingLinksExports = loadTsModule("lib/roamly/bookingLinks.ts");
const bookingCtaLinksExports = loadTsModule("lib/roamly/bookingCtaLinks.ts");
const affiliateResolverExports = loadTsModule("lib/roamly/affiliateResolver.ts");
const travelResultValidationExports = loadTsModule("lib/roamly/travelResultValidation.ts");

[
  ["Montreal", "Montreal, Canada"],
  ["Montréal", "Montreal, Canada"],
  ["Montreal, Canada", "Montreal, Canada"],
  ["New York City", "New York City, United States"],
  ["NYC", "New York City, United States"],
  ["New York, NY", "New York City, United States"],
  ["Saint John, Canada", "Saint John, New Brunswick, Canada"],
  ["Saint John, NB", "Saint John, New Brunswick, Canada"],
  ["Paris, France", "Paris, France"],
  ["London, United Kingdom", "London, United Kingdom"]
].forEach(([input, expected]) => {
  assert.equal(placeResolverExports.resolveCityPlace(input)?.searchLabel, expected, `city resolver failed for ${input}`);
});
assert.equal(placeResolverExports.resolveCityPlace("Definitely Not A Real Roamly Place"), null, "unknown city must fail safely");

[
  ["YSJ", "YSJ"],
  ["YUL", "YUL"],
  ["JFK", "JFK"],
  ["Saint John, Canada", "YSJ"],
  ["Montreal, Canada", "YMQ"],
  ["New York City, United States", "NYC"],
  ["Toronto, Canada", "YTO"],
  ["Paris, France", "PAR"],
  ["London, United Kingdom", "LON"]
].forEach(([input, expected]) => {
  assert.equal(airportResolverExports.resolveTravelIataCode(input), expected, `IATA resolver failed for ${input}`);
});
assert.equal(airportResolverExports.resolveTravelIataCode("Definitely Not A Real Roamly Place"), "", "unknown airport/city must not resolve to a fake code");

assert.equal(
  new URL(bookingLinksExports.buildAviasalesDeepLink({
    origin: "Saint John, Canada",
    destination: "New York City, United States",
    departureDate: "2026-08-05",
    returnDate: "2026-08-08",
    travelers: 1
  })).pathname,
  "/search/YSJ0508NYC08081",
  "Saint John to New York Aviasales deep link path is wrong"
);
assert.equal(
  new URL(bookingLinksExports.buildAviasalesDeepLink({
    origin: "Saint John, Canada",
    destination: "Montreal, Canada",
    departureDate: "2026-08-05",
    returnDate: "2026-08-08",
    travelers: 1
  })).pathname,
  "/search/YSJ0508YMQ08081",
  "Saint John to Montreal Aviasales deep link path is wrong"
);
assert.equal(
  bookingLinksExports.buildAviasalesDeepLink({
    origin: "Unknown City",
    destination: "Montreal, Canada",
    departureDate: "2026-08-05",
    returnDate: "2026-08-08",
    travelers: 1
  }),
  "",
  "unknown city must not produce a broken Aviasales URL"
);
[
  "https://app.stay22.com/dashboard",
  "https://www.stay22.com/login",
  "https://www.stay22.com/account",
  "https://partners.stay22.com/admin"
].forEach((href) => {
  assert.equal(affiliateResolverExports.isTravelerSafeStay22Url(href), false, `Stay22 traveler safety failed for ${href}`);
});
assert.equal(
  affiliateResolverExports.isTravelerSafeStay22Url("https://www.stay22.com/search?aid=partner"),
  true,
  "Stay22 traveler search links should be allowed"
);
assert.equal(
  affiliateResolverExports.isTravelerSafeStay22Url("https://www.stay22.com/allez/roam?aid=partner&address=San%20Juan"),
  true,
  "Stay22 Allez traveler links should be allowed"
);

assert.ok(affiliateResolver.includes("https://www.stay22.com/allez/roam"), "Stay22 partner fallback must use the Allez traveler endpoint");

[
  "https://w3.org/TR/json-ld/",
  "https://schema.org/Hotel",
  "https://schemas.live.com/hotmail/",
  "https://ogp.me/",
  "https://json-ld.org/"
].forEach((href) => {
  assert.equal(travelResultValidationExports.isBlockedTravelDomain(href), true, `${href} must be blocked`);
  assert.equal(
    travelResultValidationExports.validateTravelResultForDisplay({
      category: "hotel",
      title: href.replace(/^https?:\/\//, ""),
      provider: href.replace(/^https?:\/\//, ""),
      url: href,
      requestedDestination: "Toronto, Canada"
    }).ok,
    false,
    `${href} must not validate as a travel result`
  );
});

assert.equal(
  travelResultValidationExports.validateTravelResultForDisplay({
    category: "restaurant",
    title: "Alo",
    provider: "Google Maps",
    url: "https://www.google.com/maps/search/?api=1&query=Alo%20Toronto",
    destination: "Toronto, Canada",
    requestedDestination: "Toronto, Canada"
  }).ok,
  true,
  "real restaurant map results must validate"
);
assert.equal(
  travelResultValidationExports.validateTravelResultForDisplay({
    category: "shopping",
    title: "St. Lawrence Market",
    provider: "Google Maps",
    url: "https://www.google.com/maps/search/?api=1&query=St%20Lawrence%20Market%20Toronto",
    destination: "Toronto, Canada",
    requestedDestination: "Toronto, Canada"
  }).ok,
  true,
  "real souvenir/shopping place results must validate"
);
assert.equal(
  travelResultValidationExports.validateTravelResultForDisplay({
    category: "flight",
    expectedCategory: "hotel",
    title: "Saint John to Vancouver flight",
    provider: "Travelpayouts",
    url: "https://www.aviasales.com/search/YSJ0508YVR08081",
    destination: "Vancouver, Canada",
    requestedDestination: "Toronto, Canada"
  }).ok,
  false,
  "irrelevant categories or destinations must be hidden"
);
assert.equal(
  travelResultValidationExports.dedupeTravelResults(
    [
      { category: "hotel", title: "Chelsea Hotel, Toronto", url: "https://www.google.com/maps/search/?api=1&query=Chelsea%20Hotel%20Toronto&utm_source=x" },
      { category: "hotel", title: "Chelsea Hotel, Toronto", url: "https://www.google.com/maps/search/?api=1&query=Chelsea%20Hotel%20Toronto&utm_source=y" }
    ],
    (item) => item
  ).length,
  1,
  "duplicate travel results must be removed"
);

const affiliateLinks = read("lib/roamly/affiliateLinks.ts");
assert.ok(affiliateLinks.includes("enrichTimelineItems"), "timeline booking CTAs must be resolved server-side");
assert.ok(affiliateLinks.includes("resolveAffiliateLink"), "affiliate links must use the centralized resolver");
assert.ok(affiliateLinks.includes("booking: {"), "timeline items must receive structured booking objects");
assert.ok(affiliateLinks.includes('if (raw.startsWith("/")) return "";'), "generated booking links must reject internal /plan fallbacks");
["recommended_stay_name", "stay_profile", "neighborhood", "room_type", "budget_target", "why_recommended", "View hotel options"].forEach((needle) =>
  assert.ok(affiliateLinks.includes(needle), `hotel recommendation missing ${needle}`)
);
assert.ok(affiliateLinks.includes("payload.budgetIncludesHotel !== false") && affiliateLinks.includes("Boolean(resolvedDestination)"), "hotel recommendations must respect included hotel budget and resolved places");
["Chelsea Hotel, Toronto", "The Anndore House", "Holiday Inn Toronto Downtown Centre"].forEach((needle) =>
  assert.ok(affiliateLinks.includes(needle), `Toronto hotel shortlist missing ${needle}`)
);
assert.ok(affiliateLinks.includes("safeConsumerTravelUrl"), "affiliate enrichment must use the centralized consumer travel URL filter");
assert.ok(affiliateLinks.includes("validateTravelResultForDisplay"), "affiliate enrichment must validate result category/destination before display");

const previousStay22Partner = process.env.ROAMLY_STAY22_PARTNER_ID;
const previousKlookPartner = process.env.ROAMLY_KLOOK_PARTNER_ID;
const previousAffiliateEnabled = process.env.ROAMLY_AFFILIATES_ENABLED;
const restoreEnv = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
process.env.ROAMLY_AFFILIATES_ENABLED = "true";
process.env.ROAMLY_STAY22_PARTNER_ID = "test-stay22";
process.env.ROAMLY_KLOOK_PARTNER_ID = "test-klook";
const affiliateLinksExports = loadTsModule("lib/roamly/affiliateLinks.ts");
const fixtureItinerary = {
  trip_title: "Toronto compact fixture",
  destination_summary: "Toronto itinerary fixture.",
  best_for: ["Downtown", "Food"],
  budget_fit_summary: "Workable",
  transport_overview: "Fly to Toronto.",
  local_tips: ["Use transit downtown."],
  safety_notes: ["Keep booking confirmations offline."],
  emergency_notes: ["Call local emergency services if needed."],
  free_or_low_cost_notes: [],
  packing_checklist: ["Comfortable shoes"],
  estimated_budget_breakdown: {
    total_estimate: "CAD 1,000",
    transport: "Verify flights",
    lodging: "Verify hotels",
    activities: "Verify activities",
    food: "Verify food",
    buffer: "Keep a buffer",
    selected_transport_estimate_amount: 300,
    selected_hotel_estimate_amount: 180,
    recommended_transport_option: null,
    transport_options: [],
    budget_category_confidence: []
  },
  daily_itinerary: [
    {
      day_number: 1,
      date: "2026-08-05",
      city: "Toronto",
      title: "Downtown Toronto",
      morning: "Arrive and settle in.",
      afternoon: "CN Tower.",
      evening: "Dinner downtown.",
      estimated_cost: 80,
      food: ["Alo"],
      map_queries: ["CN Tower Toronto"],
      live_timeline: [
        { startTime: "10:00", endTime: "11:30", title: "CN Tower", description: "Observation visit.", location_name: "Downtown Toronto", category: "attraction", map_query: "CN Tower Toronto" },
        { startTime: "12:00", endTime: "13:00", title: "Alo", description: "Restaurant option.", location_name: "Downtown Toronto", category: "meal", map_query: "Alo Toronto" },
        { startTime: "15:00", endTime: "16:00", title: "St. Lawrence Market", description: "Public market and souvenir stop.", location_name: "Old Town Toronto", category: "shopping", map_query: "St. Lawrence Market Toronto" }
      ]
    }
  ],
  booking_suggestions: [
    {
      category: "flight",
      booking_category: "flight",
      title: "w3.org",
      description: "Invalid metadata result.",
      booking_status: "needs_booking",
      booking_label: "Compare flights",
      normal_search_url: "https://w3.org/TR/",
      estimated_cost_min: null,
      estimated_cost_max: null,
      currency: "CAD",
      price_confidence: "unknown"
    },
    {
      category: "attraction",
      booking_category: "attraction",
      title: "CN Tower",
      description: "Observation visit.",
      destination: "Toronto, Canada",
      booking_status: "needs_booking",
      booking_label: "Book activity",
      normal_search_url: "https://www.google.com/search?q=CN%20Tower%20Toronto%20official%20site",
      estimated_cost_min: null,
      estimated_cost_max: null,
      currency: "CAD",
      price_confidence: "unknown"
    }
  ],
  pre_trip_essentials: []
};
const fixturePayload = {
  tripType: "single_destination",
  origin: "Saint John, Canada",
  destination: "Toronto, Canada",
  destinationCity: "Toronto",
  destinationCountry: "Canada",
  returnToOrigin: true,
  startDate: "2026-08-05",
  endDate: "2026-08-08",
  daysCount: 4,
  travelersCount: 1,
  travelers: { adults: 1, children: 0, infants: 0 },
  rooms: 1,
  bedPreference: "Standard queen room",
  budgetAmount: 1500,
  budgetCurrency: "CAD",
  budgetIncludesFlights: true,
  budgetIncludesHotel: true,
  budgetIncludesActivities: true,
  travelStyle: "Balanced",
  interests: ["food"],
  pace: "Balanced",
  walkingTolerance: "Medium",
  accommodationPreference: "Central hotel",
  transportationPreference: "Flight",
  language: "en"
};
const enrichedFixture = affiliateLinksExports.enrichItineraryBookingSuggestions(fixtureItinerary, fixturePayload);
const hotelSuggestions = enrichedFixture.booking_suggestions.filter((item) => item.booking_category === "hotel");
assert.equal(hotelSuggestions.length, 3, "exactly three real hotel suggestions must be added before Stay22 actions");
assert.ok(hotelSuggestions.every((item) => !/stay22/i.test(item.title)), "Stay22 must not be used as the hotel identity");
["Chelsea Hotel, Toronto", "The Anndore House", "Holiday Inn Toronto Downtown Centre"].forEach((title) => {
  assert.ok(hotelSuggestions.some((item) => item.title === title), `${title} must be included as a real Toronto hotel suggestion`);
});
hotelSuggestions.forEach((item) => {
  assert.equal(item.affiliate_provider, "stay22", `${item.title} must use Stay22 as the affiliate layer`);
  assert.ok(/stay22\.com/.test(item.affiliate_url || ""), `${item.title} must preserve a Stay22 affiliate URL`);
  const stay22Url = new URL(item.affiliate_url);
  const address = stay22Url.searchParams.get("address") || "";
  assert.ok(address.includes(item.title), `${item.title} must be included in the Stay22 hotel search context`);
  assert.ok(/Toronto|Canada/i.test(address), `${item.title} Stay22 context must preserve the requested destination`);
  assert.equal(stay22Url.searchParams.get("checkin"), fixturePayload.startDate, `${item.title} must preserve check-in date`);
  assert.equal(stay22Url.searchParams.get("checkout"), fixturePayload.endDate, `${item.title} must preserve check-out date`);
  assert.equal(stay22Url.searchParams.get("guests"), String(fixturePayload.travelersCount), `${item.title} must preserve guest count`);
});
assert.ok(!enrichedFixture.booking_suggestions.some((item) => /w3\.org|schema\.org|schemas\.live\.com|ogp\.me|json-ld\.org/i.test(`${item.title} ${item.normal_search_url} ${item.affiliate_url}`)), "metadata domains must be removed from booking suggestions");
assert.ok(enrichedFixture.booking_suggestions.some((item) => item.booking_category === "attraction" && (item.affiliate_provider === "klook" || /klook\.com/.test(item.affiliate_url || ""))), "activities must prefer Klook when configured");
restoreEnv("ROAMLY_STAY22_PARTNER_ID", previousStay22Partner);
restoreEnv("ROAMLY_KLOOK_PARTNER_ID", previousKlookPartner);
restoreEnv("ROAMLY_AFFILIATES_ENABLED", previousAffiliateEnabled);

const tripPageForPrintChecks = read("app/trip/[id]/page.tsx");
assert.ok(!tripPageForPrintChecks.includes("Search link unavailable"), "booking cards must not render disabled unavailable-link copy");
assert.ok(tripPageForPrintChecks.includes("roamly-compact-print"), "trip page must include a compact print/PDF layout");
assert.ok(tripPageForPrintChecks.includes("roamly-screen-document"), "desktop itinerary must be separated from print/PDF output");
const globalsCss = read("app/globals.css");
assert.ok(globalsCss.includes(".roamly-screen-document") && globalsCss.includes("display: none !important"), "print CSS must hide desktop navigation/tabs");
assert.ok(globalsCss.includes(".roamly-compact-print") && globalsCss.includes("break-after: page") && globalsCss.includes("break-before: page"), "print CSS must create compact cover/days/final pages");

const affiliateNeutrality = read("lib/roamly/affiliateNeutrality.ts");
[
  "ROAMLY_AFFILIATE_NEUTRAL_DISCLOSURE",
  "TRANSPORT_SCORE_WEIGHTS",
  "ACCOMMODATION_SCORE_WEIGHTS",
  "affiliate_value: 0",
  "rankAffiliateNeutralOptions",
  "NEAR_TIE_POINTS"
].forEach((needle) => assert.ok(affiliateNeutrality.includes(needle), `affiliate neutrality helper missing ${needle}`));
const compiledAffiliateNeutrality = ts.transpileModule(affiliateNeutrality, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const affiliateNeutralityExports = {};
vm.runInNewContext(compiledAffiliateNeutrality, { exports: affiliateNeutralityExports, module: { exports: affiliateNeutralityExports } });
const neutralRanked = affiliateNeutralityExports.rankAffiliateNeutralOptions([
  { id: "better-customer-option", customerScore: 90, affiliateAvailable: false, affiliateValue: 0 },
  { id: "high-commission-inferior-option", customerScore: 82, affiliateAvailable: true, affiliateValue: 1000 }
]);
assert.equal(neutralRanked[0].id, "better-customer-option", "high-commission inferior option must not outrank a better customer option");

const itinerary = read("lib/itinerary.ts");
[
  "arrivalTravelItems",
  "departureTravelItems",
  "withTransfersBetweenMajorItems",
  "applyRoamlyItineraryIntelligence",
  "mergeShortTransfersIntoFollowingActivity",
  "withChronologicalTimes",
  "timelineChronologyErrors",
  "Day 1 is missing travel/arrival before local activities.",
  "Final day is missing checkout/departure/return travel.",
  "CTA"
].forEach((needle) => assert.ok(itinerary.includes(needle), `itinerary validation missing ${needle}`));
assert.ok(itinerary.includes("startTime") && itinerary.includes("endTime") && itinerary.includes("durationMinutes"), "structured timeline fields must be normalized");
assert.ok(itinerary.includes('if (raw.startsWith("/")) return false;'), "itinerary production validation must reject internal booking CTA URLs");
assert.ok(itinerary.includes("Roamly recommends this option for your trip."), "itinerary must confidently label the recommended transport option");
assert.ok(!itinerary.includes("google\\.com\\/search"), "itinerary validation must allow safe Google official/activity searches");

const itineraryIntelligenceExports = loadTsModule("lib/roamly/itineraryIntelligence.ts");
assert.equal(itineraryIntelligenceExports.isGenericPlaceName("local bistro"), true, "generic place names must be rejected");
const mergedTransfers = itineraryIntelligenceExports.mergeShortTransfersIntoFollowingActivity([
  {
    time_label: "10:00 AM",
    title: "Travel to Notre-Dame Basilica",
    description: "Short local hop.",
    location_name: "Old Port to Notre-Dame Basilica",
    estimated_cost: 0,
    category: "Transfer",
    map_query: "Old Port to Notre-Dame Basilica",
    item_type: "transfer",
    origin: "Old Port",
    destination: "Notre-Dame Basilica",
    travelTimeMinutes: 9,
    transportMode: "walk"
  },
  {
    time_label: "10:15 AM",
    title: "Notre-Dame Basilica admission",
    description: "Timed visit.",
    location_name: "Notre-Dame Basilica",
    estimated_cost: 18,
    category: "Activity",
    map_query: "Notre-Dame Basilica",
    item_type: "activity"
  }
]);
assert.equal(mergedTransfers.length, 1, "short transfer cards must be merged into the following activity");
assert.equal(mergedTransfers[0].origin, "Old Port", "merged activity must retain transfer origin");
assert.equal(mergedTransfers[0].travelTimeMinutes, 9, "merged activity must retain transfer duration");

const intelligentItinerary = itineraryIntelligenceExports.applyRoamlyItineraryIntelligence(
  {
    trip_title: "Montreal test",
    destination_summary: "",
    best_for: [],
    route_reasoning: "",
    budget_fit_summary: "",
    booking_status_summary: "",
    free_or_low_cost_notes: [],
    estimated_budget_breakdown: {
      lodging: "",
      food: "",
      activities: "",
      transport: "",
      buffer: "",
      total_estimate: "",
      notes: ""
    },
    hotel_area_suggestions: [],
    transport_overview: "",
    daily_itinerary: [
      {
        day_number: 1,
        city: "Montreal",
        title: "Generic day",
        morning: "",
        afternoon: "",
        evening: "",
        food: ["local bistro"],
        estimated_cost: 100,
        map_queries: [],
        live_timeline: [
          {
            time_label: "9:30 AM",
            title: "Museum or gallery",
            description: "Generic activity.",
            location_name: "Montreal",
            estimated_cost: 20,
            category: "Activity",
            map_query: "Montreal activity"
          },
          {
            time_label: "10:30 AM",
            title: "Travel to lunch",
            description: "Short hop.",
            location_name: "Museum to lunch",
            estimated_cost: 0,
            category: "Transfer",
            map_query: "Museum to lunch",
            item_type: "transfer",
            origin: "Museum",
            destination: "Lunch",
            travelTimeMinutes: 8,
            transportMode: "walk"
          },
          {
            time_label: "2:30 PM",
            title: "Neighborhood lunch and explore",
            description: "Generic lunch.",
            location_name: "Montreal",
            estimated_cost: 30,
            category: "Meal",
            map_query: "Montreal lunch",
            item_type: "meal"
          },
          {
            time_label: "4:00 PM",
            title: "Easy evening finish",
            description: "Generic evening.",
            location_name: "Montreal",
            estimated_cost: 25,
            category: "Activity",
            map_query: "Montreal evening"
          },
          {
            time_label: "5:30 PM",
            title: "Hidden gem",
            description: "Generic.",
            location_name: "Montreal",
            estimated_cost: 10,
            category: "Activity",
            map_query: "Montreal"
          },
          {
            time_label: "7:00 PM",
            title: "Casual dinner",
            description: "Generic.",
            location_name: "Montreal",
            estimated_cost: 35,
            category: "Meal",
            map_query: "Montreal dinner"
          },
          {
            time_label: "8:30 PM",
            title: "Nightlife district",
            description: "Generic.",
            location_name: "Montreal",
            estimated_cost: 20,
            category: "Activity",
            map_query: "Montreal nightlife"
          }
        ]
      }
    ],
    packing_checklist: [],
    local_tips: [],
    safety_notes: [],
    emergency_notes: [],
    booking_suggestions: [],
    pre_trip_essentials: [],
    regenerate_suggestions: []
  },
  {
    destination: "Montreal",
    destinationCity: "Montreal",
    startDate: "2026-08-05",
    endDate: "2026-08-08",
    daysCount: 4,
    budgetCurrency: "CAD",
    interests: ["Culture", "Food"],
    priceDiscovery: {
      marketResults: [
        {
          id: "native-notre-dame",
          category: "attraction",
          title: "Notre-Dame Basilica admission",
          provider: "ReviewIntel native retrieval",
          source: "roamly_internal",
          currency: "CAD",
          price_type: "search_ready",
          confidence: "medium",
          normal_search_url: "https://example.com/notre-dame",
          searched_at: "2026-08-01T12:00:00.000Z",
          expires_at: "2026-08-02T12:00:00.000Z",
          metadata: { retrieval_provider: "native", verification_status: "native_review_evidence" }
        },
        {
          id: "native-restaurant",
          category: "restaurant",
          title: "Joe Beef",
          provider: "ReviewIntel native retrieval",
          source: "roamly_internal",
          currency: "CAD",
          price_type: "search_ready",
          confidence: "medium",
          normal_search_url: "https://example.com/joe-beef",
          searched_at: "2026-08-01T12:00:00.000Z",
          expires_at: "2026-08-02T12:00:00.000Z",
          metadata: { retrieval_provider: "native", verification_status: "native_review_evidence" }
        }
      ]
    }
  }
);
assert.ok(intelligentItinerary.daily_itinerary[0].live_timeline.length <= 6, "intelligence pass must cap visible timeline items at 6");
assert.ok(
  intelligentItinerary.daily_itinerary[0].live_timeline.some((item) => item.title === "Notre-Dame Basilica admission"),
  "generic activity must be replaced by a real market-backed place"
);
assert.ok(!JSON.stringify(intelligentItinerary).toLowerCase().includes("local bistro"), "generic food text must be removed");

const tripPage = read("app/trip/[id]/page.tsx");
assert.ok(tripPage.includes("BookingPlan") && tripPage.includes("BookingRecommendationCard"), "booking recommendations must render in a dedicated section");
assert.ok(!tripPage.includes("shouldShowInlineTimelineBooking") && !tripPage.includes("item.booking"), "timeline must not render booking spam inside itinerary cards");
assert.ok(tripPage.includes("isLegacyBookingUrl(raw)"), "trip rendering must reject legacy booking links");
assert.ok(tripPage.includes("enrichItineraryBookingSuggestions"), "saved trips must reconstruct missing affiliate links on load");
assert.ok(tripPage.includes("const generationFailed = generationStatus === \"failed\" || generationStatus === \"partially_failed\""), "trip page must detect terminal failed generation state");
assert.ok(tripPage.includes("(!canShowFull || generationFailed)"), "trip page must still show failed generation UI when a non-final preview itinerary exists");
assert.ok(tripPage.includes("canShowFull && full && !generationPanelVisible"), "trip page must render the itinerary automatically after generation completes");
[
  "buildDisplayTimelineItems",
  "roamly-day-nav",
  "roamly-tab-nav",
  "DayTimelineCard",
  "min-h-11",
  "buildRelevantBookingGroups",
  "isImpracticalBookingSuggestion",
  "RecommendedTransportCard"
].forEach((needle) => assert.ok(tripPage.includes(needle), `mobile itinerary/bookings UI missing ${needle}`));
assert.ok(tripPage.includes("slice(0, 6)") || tripPage.includes("output.length >= 6"), "completed itinerary display must cap daily primary items");

const planPage = read("app/plan/page.tsx");
assert.ok(planPage.includes("hidden gap-2 lg:grid"), "mobile plan page must not render the desktop info rail");
assert.ok(!planPage.includes("min-h-screen"), "/plan must not force full-screen height");

const planForm = read("components/plan/TripPlanForm.tsx");
assert.ok(!planForm.includes("setConfirming") && !planForm.includes("confirming"), "planner must not use the old extra confirmation modal");
assert.ok(!planForm.includes("min-h-[24rem]"), "planner form must not reserve excessive blank height");
assert.ok(planForm.includes("submitPlan(generationPayload)"), "final planner action must generate immediately after budget check");
assert.ok(!planForm.includes("controller.abort()"), "planner generation must not abort paid AI requests on a client timer");

const generateLockedButton = read("components/trip/GenerateLockedItineraryButton.tsx");
assert.ok(!generateLockedButton.includes("controller.abort()"), "locked itinerary generation must not abort paid AI requests on a client timer");

const stagedGenerator = read("lib/roamly/stagedItineraryGeneration.ts");
[
  "outlinePrompt",
  "dayBatchPrompt",
  "plannedDayBatches",
  "MAX_AI_COST_USD",
  "45_000",
  "BATCH_ATTEMPT_LIMIT",
  "assertCostBudget",
  "estimatedStageCost",
  "aiCallCount",
  "estimatedAiCostUsd",
  "generatedDays",
  "repairItineraryForTravelRequirements",
  "enrichItineraryBookingSuggestions",
  "persistItinerary",
  "resetFailedStagedBatch",
  "finalizeStagedGenerationNotification",
  "generationEmail",
  "maxRetries: 0",
  "staged_ai_call_start",
  "staged_ai_call_result",
  "staged_ai_call_failed"
].forEach((needle) => assert.ok(stagedGenerator.includes(needle), `staged generation missing ${needle}`));
assert.ok(stagedGenerator.includes("persistedTripStatusForGeneration"), "staged generation must map terminal statuses before persisting trips");
assert.ok(stagedGenerator.includes('status === "failed" || status === "partially_failed"'), "partially failed generations must persist as draft instead of staying generating");
assert.ok(stagedGenerator.includes("credit_balance_exhausted"), "OpenAI quota exhaustion must be detected explicitly");
assert.ok(stagedGenerator.includes("AI_QUOTA_EXHAUSTED"), "OpenAI quota exhaustion must use a distinct generation failure code");
assert.ok(stagedGenerator.includes("safe.errorCategory === \"quota_exhausted\""), "quota exhaustion must be treated as a terminal provider condition");
assert.ok(!stagedGenerator.includes("buildFallbackItinerary"), "staged generation must not use template fallback itineraries");
assert.ok(!stagedGenerator.includes("local-starter-itinerary"), "staged generation must not return a local starter itinerary");
assert.ok(!stagedGenerator.includes("ROAMLY_SECONDARY_AI"), "secondary-provider fallback is paused until primary production acceptance passes");
assert.ok(stagedGenerator.includes("repairStagedDayForGenerationValidation"), "staged generation must repair malformed day output before failing a day");
assert.ok(stagedGenerator.includes("canResumeStagedGeneration"), "staged generation must resume repairable failed day batches");

const stagedGeneratorExports = loadTsModule("lib/roamly/stagedItineraryGeneration.ts");
const malformedDay3 = stagedGeneratorExports.repairStagedDayForGenerationValidation(
  {
    day_number: 3,
    date: "2026-08-07",
    city: "Montreal",
    title: "Markets and museums",
    morning: "",
    afternoon: "",
    evening: "",
    food: [],
    estimated_cost: 0,
    map_queries: [],
    live_timeline: [
      {
        time_label: "9:00 AM",
        title: "Museum anchor",
        description: "Visit the main museum stop.",
        location_name: "Downtown Montreal",
        estimated_cost: 20,
        category: "Activity",
        map_query: "Downtown Montreal museum"
      },
      {
        time_label: "9:00 AM",
        title: "Museum anchor",
        description: "Duplicate malformed activity from the model.",
        location_name: "Downtown Montreal",
        estimated_cost: 20,
        category: "Activity",
        map_query: "Downtown Montreal museum"
      }
    ]
  },
  {
    id: "day-3",
    dayNumber: 3,
    date: "2026-08-07",
    theme: "Markets and museums",
    geographicArea: "Downtown Montreal",
    priorityActivities: ["Museum anchor", "Jean-Talon Market", "Old Montreal evening"],
    arrivalRequirements: [],
    departureRequirements: [],
    nextStartRequirement: "Downtown Montreal"
  },
  {
    destination: "Montreal",
    startDate: "2026-08-05",
    endDate: "2026-08-08",
    daysCount: 4,
    budgetAmount: 900,
    budgetCurrency: "CAD",
    travelStyle: "Balanced",
    interests: ["Culture", "Food"],
    pace: "Balanced",
    walkingTolerance: "Medium",
    accommodationPreference: "Mid-range",
    transportationPreference: "Mixed",
    specialNotes: ""
  }
);
const toMinutes = (value) => {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
assert.ok(malformedDay3.live_timeline.length >= 4, "malformed Day 3 must be repaired to a full day timeline");
assert.equal(
  new Set(malformedDay3.live_timeline.map((item) => item.title.toLowerCase())).size,
  malformedDay3.live_timeline.length,
  "repaired Day 3 must not keep duplicate activity titles"
);
malformedDay3.live_timeline.forEach((item, index, items) => {
  const start = toMinutes(item.startTime);
  const end = toMinutes(item.endTime);
  assert.ok(start != null && end != null && end > start, `repaired Day 3 item ${index + 1} must have valid start/end times`);
  if (index > 0) {
    const previousEnd = toMinutes(items[index - 1].endTime);
    assert.ok(previousEnd == null || start >= previousEnd, `repaired Day 3 item ${index + 1} must not overlap`);
  }
});
assert.equal(
  stagedGeneratorExports.canResumeStagedGeneration({
    version: 2,
    status: "failed",
    currentStage: "failed",
    totalDayCount: 4,
    completedDayCount: 2,
    outline: {
      tripSummary: "Montreal test trip",
      hotelAreaRecommendation: "Downtown Montreal",
      importantConstraints: [],
      days: []
    },
    days: {},
    batches: {
      "batch-3": {
        id: "batch-3",
        dayNumbers: [3],
        status: "failed",
        attemptCount: 2,
        lastError: "DAY_BATCH_VALIDATION_FAILED"
      }
    },
    generatedDays: {},
    payload: {
      destination: "Montreal",
      startDate: "2026-08-05",
      endDate: "2026-08-08",
      daysCount: 4,
      budgetAmount: 900,
      budgetCurrency: "CAD",
      travelStyle: "Balanced",
      interests: ["Culture"],
      pace: "Balanced",
      accommodationPreference: "Mid-range",
      transportationPreference: "Mixed",
      specialNotes: ""
    },
    lastErrorCode: "DAY_BATCH_VALIDATION_FAILED",
    startedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z"
  }),
  true,
  "failed Day 3 validation states must be resumable"
);

const trips = read("lib/trips.ts");
["startTime", "endTime", "durationMinutes", "travelTimeMinutes", "booking", "affiliate_category"].forEach((needle) =>
  assert.ok(trips.includes(needle), `itinerary persistence metadata missing ${needle}`)
);
assert.ok(trips.includes("itinerary_storage_write_completed"), "itinerary storage diagnostics must prove structure was persisted");

const generationDiagnostics = read("lib/roamly/generationDiagnostics.ts");
[
  "logGenerationDiagnostic",
  "summarizeItineraryShape",
  "SENSITIVE_KEY_PATTERN",
  "structuredTimelineComplete",
  "firstDayHasTravel",
  "finalDayHasReturnTravel"
].forEach((needle) => assert.ok(generationDiagnostics.includes(needle), `generation diagnostics missing ${needle}`));

const aiGenerator = read("lib/ai/roamly-itinerary.ts");
[
  "ai_generation_call_start",
  "ai_generation_call_result",
  "ai_generation_response_parsed",
  "ai_generation_failed_no_fallback",
  "fallbackDisabled",
  "openAiKeyPresent",
  "responseContentPresent",
  "generationModelCandidates",
  "model_failover",
  "AI_PROVIDER_FAILED"
].forEach((needle) => assert.ok(aiGenerator.includes(needle), `AI generation trace missing ${needle}`));
assert.ok(!aiGenerator.includes("buildFallbackItinerary"), "paid itinerary generation must not silently build a template fallback");
assert.ok(!aiGenerator.includes("local-starter-itinerary"), "paid itinerary generation must not return the local starter itinerary");

const generateRouteDiagnostics = read("app/api/trips/generate/route.ts");
[
  "generation_route_request_received",
  "generation_route_auth_failed",
  "prepareStagedGenerationContext",
  "startStagedItineraryGeneration",
  "createOrResumeGenerationJob",
  "generation_queue_unavailable",
  "generationPriorityForEntitlement",
  "duplicateGenerationRequestKey",
  "paidPriority",
  "generation_staged_job_started",
  "generation_route_response"
].forEach((needle) => assert.ok(generateRouteDiagnostics.includes(needle), `generation route trace missing ${needle}`));
assert.ok(!generateRouteDiagnostics.includes("generateRoamlyItinerary"), "generate route must not call the old all-in-one AI generator");
assert.ok(generateRouteDiagnostics.includes("status: \"queued\""), "generate route must return a queued staged job");
const durableQueueCreatedIndex = generateRouteDiagnostics.indexOf("const queueResult = await ensureDurableGenerationQueue");
const stagedStartIndex = generateRouteDiagnostics.indexOf("state = await startStagedItineraryGeneration", durableQueueCreatedIndex);
const queuedResponseIndex = generateRouteDiagnostics.indexOf("status: \"queued\"", stagedStartIndex);
assert.ok(
  durableQueueCreatedIndex >= 0 && stagedStartIndex > durableQueueCreatedIndex && queuedResponseIndex > stagedStartIndex,
  "durable queue responses must initialize staged generation metadata before returning queued"
);
assert.ok(
  !generateRouteDiagnostics.includes("generation_queued_returning_202"),
  "generation route must not return queued before staged metadata is initialized"
);

assert.ok(tripPage.includes("itinerary_render_full_loaded"), "trip page must log safe structure diagnostics when rendering saved itineraries");

const advanceRoute = read("app/api/trips/[id]/generation/advance/route.ts");
assert.ok(advanceRoute.includes("processGenerationQueue"), "client generation worker route must advance through the durable queue worker");
assert.ok(advanceRoute.includes("workerQueueUnavailable"), "client generation worker route must detect unavailable queue infrastructure");
assert.ok(!advanceRoute.includes("advanceStagedItineraryGeneration"), "client route must not execute staged generation directly");
assert.ok(!advanceRoute.includes("finalizeCompletedStagedGeneration"), "client route must not finalize direct fallback generations");
assert.ok(!advanceRoute.includes("browser_direct_fallback_completion"), "client route must not tag direct fallback completion finalization");
assert.ok(!advanceRoute.includes("direct_staged_generation"), "client route must not expose direct staged fallback diagnostics");
assert.ok(advanceRoute.includes("resetFailedStagedBatch"), "client generation worker route must retry only failed batches");
assert.ok(advanceRoute.includes("queueSnapshot") && advanceRoute.includes("queue: await queueSnapshot"), "client generation worker route must return durable queue progress");
assert.ok(advanceRoute.includes("const savedTrip = await auth.supabase"), "client generation worker route must reload saved progress after terminal generator errors");
assert.ok(advanceRoute.includes("publicStagedGenerationProgress(savedTrip.data?.metadata, id)"), "client generation worker route must return saved failed progress scoped to the trip after worker errors");

const statusRoute = read("app/api/trips/[id]/generation/status/route.ts");
assert.ok(statusRoute.includes("publicStagedGenerationProgress"), "generation status route must expose safe progress");
assert.ok(statusRoute.includes("getGenerationQueueForTrip"), "generation status route must expose durable queue progress");
assert.ok(statusRoute.includes("queue: queueForResponse"), "generation status route must return completed-safe queue progress");
assert.ok(statusRoute.includes("isFinalStoredItinerary"), "generation status route must recognize final stored itineraries");
assert.ok(statusRoute.includes("hasFullItinerary"), "generation status route must mark validated stored itineraries as complete");
assert.ok(statusRoute.includes("hasFinalStoredItineraryInMetadata"), "generation status route must recover from metadata-saved final itineraries");
assert.ok(statusRoute.includes("status_route_stored_itinerary_recovery"), "generation status route must run direct completion recovery for stale building trips");
assert.ok(statusRoute.includes("tripStatusStillBuilding") && statusRoute.includes("itineraryStatusComplete"), "generation status route must repair existing trips stuck queued after a final itinerary is saved");
assert.ok(statusRoute.includes("getGenerationEmailStatus") && statusRoute.includes("completionEmailMissing"), "generation status route must recover missing completion emails for completed stored itineraries");
assert.ok(statusRoute.includes("queueTableMissing(jobsResult.error.message)") && statusRoute.includes("queueTableMissing(layersResult.error.message)"), "generation status route must tolerate missing queue tables");
assert.ok(statusRoute.includes("publicStagedGenerationProgress(data.metadata, id)"), "generation status route must derive metadata progress only for the requested trip id");
assert.ok(statusRoute.includes('.eq("user_id", auth.user.id)'), "generation status route must scope queue lookups by the authenticated user");
assert.ok(statusRoute.includes("completedDayCount: derived.completedDayCount") && statusRoute.includes("totalDayCount: derived.totalDayCount"), "generation status route must expose trip-day counts at the top level");
const generationStatusExports = loadTsModule("lib/roamly/generationStatus.ts");
const completedGenerationState = generationStatusExports.deriveTripGenerationStatus({
  tripStatus: "generated",
  itineraryStatus: "generated",
  metadataProgress: { status: "generating_day", completedDayCount: 1, totalDayCount: 4 },
  latestJob: { status: "completed", completed_at: "2026-08-05T00:00:00.000Z" },
  layers: [
    { status: "completed" },
    { status: "completed" }
  ],
  queueProgress: { completedLayerCount: 2, totalLayerCount: 2 }
});
assert.equal(completedGenerationState.progressStatus, "complete", "completed staged generation must return complete progress");
assert.equal(completedGenerationState.status, "complete", "completed staged generation status endpoint must return complete");
assert.equal(completedGenerationState.completedDayCount, 4, "completed progress must report completed trip days, not queue layers");
assert.equal(completedGenerationState.totalDayCount, 4, "completed progress must report total trip days, not queue layers");
const storedFullGenerationState = generationStatusExports.deriveTripGenerationStatus({
  tripStatus: "generating",
  itineraryStatus: "generating",
  metadataProgress: { status: "generating_day", completedDayCount: 2, totalDayCount: 4 },
  latestJob: { status: "waiting", completed_at: null },
  layers: [{ status: "running" }],
  queueProgress: { completedLayerCount: 2, totalLayerCount: 4 },
  hasFullItinerary: true
});
assert.equal(storedFullGenerationState.progressStatus, "complete", "stored final itinerary must return complete progress");
assert.equal(storedFullGenerationState.status, "complete", "stored final itinerary status endpoint must return complete");
assert.equal(storedFullGenerationState.completedDayCount, storedFullGenerationState.totalDayCount, "completed itinerary progress must report completedDayCount equal to totalDayCount");
assert.equal(storedFullGenerationState.totalDayCount, 4, "completed itinerary progress must use the itinerary day total instead of stale queue layers");
const staleQueuedCompletedState = generationStatusExports.deriveTripGenerationStatus({
  tripStatus: "generating",
  itineraryStatus: "generating",
  metadataProgress: { status: "queued", completedDayCount: 0, totalDayCount: 5 },
  latestJob: { status: "queued", completed_at: null },
  layers: [{ status: "running" }],
  queueProgress: { status: "queued", completedLayerCount: 0, totalLayerCount: 6 },
  hasFullItinerary: true
});
assert.equal(staleQueuedCompletedState.status, "complete", "completed itinerary must override a stale queued job");
assert.equal(staleQueuedCompletedState.progressStatus, "complete", "completed itinerary must override stale queued progress");
assert.equal(staleQueuedCompletedState.completedDayCount, staleQueuedCompletedState.totalDayCount, "completed stale queued jobs must stop at matching terminal day counts");
assert.equal(staleQueuedCompletedState.totalDayCount, 5, "completed stale queued jobs must keep the saved itinerary day total");
const storedFullNoQueueGenerationState = generationStatusExports.deriveTripGenerationStatus({
  tripStatus: "generating",
  itineraryStatus: "generating",
  metadataProgress: { status: "generating_day", completedDayCount: 6, totalDayCount: 6 },
  latestJob: null,
  layers: [],
  queueProgress: null,
  hasFullItinerary: true
});
assert.equal(storedFullNoQueueGenerationState.progressStatus, "complete", "stored final itinerary must complete when queue lookup is unavailable");
assert.equal(storedFullNoQueueGenerationState.percent, 100, "stored final itinerary without queue must stop polling at 100 percent");

const failedValidationGenerationState = generationStatusExports.deriveTripGenerationStatus({
  tripStatus: "draft",
  itineraryStatus: "draft",
  metadataProgress: { status: "failed", completedDayCount: 4, totalDayCount: 4 },
  latestJob: { status: "failed", error_message: "FINAL_VALIDATION_FAILED", completed_at: null },
  layers: [
    { status: "completed" },
    { status: "completed" },
    { status: "completed" },
    { status: "completed" },
    { status: "failed" },
    { status: "pending" }
  ],
  queueProgress: { completedLayerCount: 4, totalLayerCount: 6 }
});
assert.equal(failedValidationGenerationState.isFailed, true, "failed final validation must remain terminal failed");
assert.equal(failedValidationGenerationState.progressStatus, "failed", "failed final validation must not become complete because day counts match");
assert.equal(failedValidationGenerationState.completedDayCount, 4, "failed validation completed days must stay clamped to trip days");
assert.equal(failedValidationGenerationState.totalDayCount, 4, "failed validation total days must not include outline/finalization queue layers");

const stagedGenerationExports = loadTsModule("lib/roamly/stagedItineraryGeneration.ts");
const montrealTripId = "00000000-0000-4000-8000-0000000000a1";
const nycTripId = "00000000-0000-4000-8000-0000000000b2";
const scopedGenerationMetadata = {
  generation: {
    version: 2,
    tripId: montrealTripId,
    status: "generating_day",
    currentStage: "generating_day",
    totalDayCount: 4,
    completedDayCount: 6,
    payload: { destination: "Montreal", startDate: "2026-09-01", endDate: "2026-09-04" },
    days: {
      "1": { dayNumber: 1, status: "complete", attemptCount: 1 },
      "2": { dayNumber: 2, status: "complete", attemptCount: 1 },
      "3": { dayNumber: 3, status: "complete", attemptCount: 1 },
      "4": { dayNumber: 4, status: "complete", attemptCount: 1 },
      "5": { dayNumber: 5, status: "complete", attemptCount: 1 }
    },
    batches: {
      "batch-1": { id: "batch-1", dayNumbers: [1], status: "complete", attemptCount: 1 },
      "batch-5": { id: "batch-5", dayNumbers: [5], status: "complete", attemptCount: 1 }
    },
    generatedDays: {},
    startedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  }
};
const montrealProgress = stagedGenerationExports.publicStagedGenerationProgress(scopedGenerationMetadata, montrealTripId);
assert.equal(montrealProgress.tripId, montrealTripId, "progress must carry the trip id");
assert.equal(montrealProgress.completedDayCount, 4, "progress cannot exceed total trip days");
assert.equal(montrealProgress.totalDayCount, 4, "progress total must remain the trip day count");
assert.deepEqual(Array.from(montrealProgress.days, (day) => day.dayNumber), [1, 2, 3, 4], "progress must discard impossible day states beyond total days");
assert.equal(
  stagedGenerationExports.publicStagedGenerationProgress(scopedGenerationMetadata, nycTripId),
  null,
  "progress for Montreal must not be returned for a New York trip id"
);

const generationFinalization = read("lib/roamly/generationFinalization.ts");
[
  "finalizeCompletedStagedGeneration",
  "recoverCompletedStoredGenerations",
  "isFinalStoredItinerary",
  "hasFinalStoredItineraryInMetadata",
  "FINAL_ITINERARY_NOT_SAVED",
  "queueTableMissing(lookupError)",
  "queueTableMissing(finalized.error)",
  "generation_queue_finalization_best_effort_failed",
  "finalizeTripDirectly",
  "status: \"generated\"",
  "itinerary_status: \"generated\"",
  "itinerary_locked: true",
  "itinerary_generated_at",
  "completeDayStates",
  "completedGenerationState",
  "worker: null",
  "completeGenerationJob",
  "finalizeGenerationCompletion",
  "reconcileCompletedGenerationJobs",
  "reconcileQueueCompletionIfRequired",
  "sendStagedGenerationEmail",
  "kind: \"completion\""
].forEach((needle) => assert.ok(generationFinalization.includes(needle), `generation finalization helper missing ${needle}`));
assert.ok(!generationFinalization.includes("if (queueFinalization.skipped)"), "direct trip completion must not depend on skipped queue finalization");
assert.ok(generationFinalization.includes("tripId?: string | null"), "stored generation recovery must support targeted trip repair without regenerating");
const claimedJobCompletionIndex = generationFinalization.indexOf("const completedJob = await completeGenerationJob");
const queueFinalizationIndex = generationFinalization.indexOf("const finalized = await finalizeGenerationCompletion");
const completionEmailIndex = generationFinalization.indexOf("await sendStagedGenerationEmail", queueFinalizationIndex);
assert.ok(claimedJobCompletionIndex >= 0, "terminal finalization must call completeGenerationJob for worker-locked queue jobs");
assert.ok(
  queueFinalizationIndex > claimedJobCompletionIndex,
  "terminal finalization must complete the claimed job before atomic queue finalization"
);
assert.ok(
  completionEmailIndex > queueFinalizationIndex,
  "completion email must be sent only after queue finalization"
);
assert.ok(
  generationFinalization.includes("return { ok: false as const, jobId, skipped: true as const, error: finalized.error }"),
  "non-missing queue finalization errors must block completion email delivery"
);

const generationQueue = read("lib/roamly/generationQueue.ts");
[
  "generationIdempotencyKey",
  "createOrResumeGenerationJob",
  "ensureGenerationLayers",
  "markQueueFromLegacyState",
  "queueTableMissing",
  "invalidateGenerationLayers",
  "requeueInvalidatedGenerationLayers",
  "finalizeGenerationCompletion",
  "reconcileCompletedGenerationJobs",
  "paid_priority",
  "duplicate_request_key",
  "dead_lettered_at",
  "estimated_cost_json",
  "could not find the (table|function)",
  "PGRST20[25]",
  "roamly_(claim|release|complete|schedule|skip|renew|requeue|invalidate|finalize|reconcile)_generation"
].forEach((needle) => assert.ok(generationQueue.includes(needle), `generation queue helper missing ${needle}`));

const generationScalability = read("lib/roamly/generationScalability.ts");
[
  "getGenerationScalabilityConfig",
  "ROAMLY_PAID_QUEUE_PRIORITY",
  "ROAMLY_FREE_QUEUE_PRIORITY",
  "ROAMLY_FREE_GENERATION_DAILY_LIMIT",
  "ROAMLY_PAID_GENERATION_DAILY_LIMIT",
  "ROAMLY_OPENAI_DAILY_TOKEN_LIMIT",
  "ROAMLY_PROVIDER_RATE_LIMITS_JSON",
  "ROAMLY_GENERATION_RETRY_BUDGET",
  "ROAMLY_GENERATION_COST_BUDGET_USD",
  "generationPriorityForEntitlement",
  "duplicateGenerationRequestKey",
  "recordGenerationCostEvent",
  "estimateGenerationCostFromUsage",
  "checkUserGenerationRateLimit",
  "getGenerationQueueHealth",
  "listAdminGenerationQueue",
  "adminRetryGenerationJob",
  "adminCancelGenerationJob"
].forEach((needle) => assert.ok(generationScalability.includes(needle), `generation scalability helper missing ${needle}`));

const brainStages = read("lib/roamly/brain/stages.ts");
[
  "ROAMLY_BRAIN_VERSION",
  "ROAMLY_BRAIN_STAGES",
  "traveler_profile",
  "trip_requirements",
  "destination_research",
  "transport_search",
  "transport_decision",
  "destination_structure",
  "accommodation_area_selection",
  "accommodation_search",
  "accommodation_decision",
  "daily_itinerary_generation",
  "itinerary_logistics_validation",
  "budget_validation",
  "schedule_validation",
  "backup_plan_generation",
  "final_assembly",
  "completion_notification",
  "dependencies",
  "retryClass",
  "providerRequirements",
  "evidenceRequirements",
  "invalidatedBy",
  "inputSchema",
  "outputSchema",
  "dependentStagesForRegeneration",
  "stagesInvalidatedBy"
].forEach((needle) => assert.ok(brainStages.includes(needle), `Brain stage framework missing ${needle}`));

const brainOrchestrator = read("lib/roamly/brain/orchestrator.ts");
[
  "buildBrainStageInput",
  "validateBrainStageInput",
  "validateBrainStageOutput",
  "dependencyVersionSnapshot",
  "invalidateBrainLayersForChange",
  "invalidateGenerationLayers",
  "requeueInvalidatedGenerationLayers"
].forEach((needle) => assert.ok(brainOrchestrator.includes(needle), `Brain orchestrator missing ${needle}`));

const travelerMemory = read("lib/roamly/travelerMemory.ts");
[
  "TRAVELER_PREFERENCE_KEYS",
  "preferred_travel_pace",
  "maximum_comfortable_driving_hours",
  "transportation_preferences",
  "accommodation_types",
  "hotel_priorities",
  "confirmed_preferences",
  "inferred_preferences",
  "personalization_enabled",
  "getTravelerMemory",
  "upsertTravelerProfile",
  "deleteTravelerPreference",
  "deleteTravelerMemory",
  "updatePreferenceEventStatus",
  "preferenceInfluenceSummary"
].forEach((needle) => assert.ok(travelerMemory.includes(needle), `traveler memory helper missing ${needle}`));
assert.ok(generationQueue.includes("travelerMemory"), "generation layers must receive traveler memory input");

const travelerMemoryMigration = read("supabase/migrations/20260715_roamly_traveler_memory.sql");
[
  "traveler_profiles",
  "traveler_preference_events",
  "preferred_travel_pace",
  "maximum_comfortable_driving_hours",
  "confirmed_preferences",
  "inferred_preferences",
  "personalization_enabled",
  "enable row level security",
  "user_id = auth.uid()",
  "source_trip_id",
  "source_feedback_id"
].forEach((needle) => assert.ok(travelerMemoryMigration.toLowerCase().includes(needle.toLowerCase()), `traveler memory migration missing ${needle}`));

const travelerMemoryRoute = read("app/api/account/traveler-memory/route.ts");
["requireUser", "getTravelerMemory", "upsertTravelerProfile", "deleteTravelerPreference", "updatePreferenceEventStatus", "deleteTravelerMemory"].forEach((needle) =>
  assert.ok(travelerMemoryRoute.includes(needle), `traveler memory route missing ${needle}`)
);

const travelerMemoryComponent = read("components/account/TravelerMemorySettings.tsx");
[
  "/api/account/traveler-memory",
  "Here is what Roamly remembers",
  "Here is what Roamly learned from your trip.",
  "Delete all travel memory",
  "personalization"
].forEach((needle) => assert.ok(travelerMemoryComponent.includes(needle), `traveler memory UI missing ${needle}`));

const tripFeedback = read("lib/roamly/tripFeedback.ts");
[
  "submitTripFeedback",
  "getTripFeedback",
  "proposePreferenceUpdatesFromFeedback",
  "overallSatisfaction",
  "itineraryPace",
  "transportationSatisfaction",
  "hotelLocationSatisfaction",
  "hotelQualitySatisfaction",
  "budgetAccuracy",
  "scheduleRealism",
  "favouriteActivities",
  "disappointingActivities",
  "skippedActivities",
  "reasonsForSkipping",
  "wouldUseRoamlyAgain",
  "freeTextFeedback",
  "transportationDifficult",
  "adjustTomorrow",
  "recommendationUsefulness",
  "traveler_preference_events",
  "status: \"proposed\"",
  "Here is what Roamly learned from your trip."
].forEach((needle) => assert.ok(tripFeedback.includes(needle), `trip feedback helper missing ${needle}`));

const tripFeedbackRoute = read("app/api/trips/[id]/feedback/route.ts");
["requireUser", "getTripFeedback", "submitTripFeedback", "feedbackType", "proposedPreferences"].forEach((needle) =>
  assert.ok(tripFeedbackRoute.includes(needle), `trip feedback route missing ${needle}`)
);

const tripFeedbackComponent = read("components/trip/TripFeedbackForm.tsx");
[
  "fetchWithSupabaseAuth",
  "Trip feedback",
  "Today",
  "Transportation was difficult",
  "Adjust tomorrow",
  "Would use Roamly again",
  "Here is what Roamly learned from your trip."
].forEach((needle) => assert.ok(tripFeedbackComponent.includes(needle), `trip feedback UI missing ${needle}`));

const tripFeedbackMigration = read("supabase/migrations/20260715_roamly_trip_feedback.sql");
[
  "trip_feedback",
  "overall_satisfaction",
  "itinerary_pace",
  "transportation_satisfaction",
  "hotel_location_satisfaction",
  "hotel_quality_satisfaction",
  "budget_accuracy",
  "schedule_realism",
  "favourite_activities",
  "disappointing_activities",
  "skipped_activities",
  "reasons_for_skipping",
  "would_use_roamly_again",
  "free_text_feedback",
  "transportation_difficult",
  "adjust_tomorrow",
  "recommendation_usefulness",
  "learned_preferences_json",
  "traveler_preference_events_source_feedback_id_fkey",
  "enable row level security",
  "user_id = auth.uid()",
  "to service_role"
].forEach((needle) => assert.ok(tripFeedbackMigration.toLowerCase().includes(needle.toLowerCase()), `trip feedback migration missing ${needle}`));

const transportationIntelligence = read("lib/roamly/transportationIntelligence.ts");
[
  "buildTransportationIntelligence",
  "drivingDaysRequired",
  "drivingOvernightStops",
  "door_to_door_minutes",
  "overnight_stops",
  "estimated_additional_costs",
  "score_components",
  "affiliate_value: 0",
  "rental_car",
  "ferry",
  "No ferry provider is configured",
  "Roamly recommends this option for your trip.",
  "user_override_supported",
  "maximumComfortableDrivingHours",
  "transportationPreferences"
].forEach((needle) => assert.ok(transportationIntelligence.includes(needle), `transportation intelligence missing ${needle}`));

const transportStages = read("lib/roamly/brain/transportStages.ts");
["buildTransportSearchLayer", "buildTransportDecisionLayer", "buildTransportationIntelligence"].forEach((needle) =>
  assert.ok(transportStages.includes(needle), `transport Brain stage helper missing ${needle}`)
);

const accommodationIntelligence = read("lib/roamly/accommodationIntelligence.ts");
[
  "buildAccommodationIntelligence",
  "selectAccommodationArea",
  "activity_access",
  "arrival_access",
  "transit_access",
  "walking_fit",
  "review_evidence",
  "repeated_praises",
  "repeated_complaints",
  "reviewQualityScore",
  "booking_conditions",
  "affiliate_value: 0",
  "requires_route_revalidation",
  "Search-ready accommodation option only",
  "Recommendations are ranked according to your trip needs, not commission."
].forEach((needle) => assert.ok(accommodationIntelligence.includes(needle), `accommodation intelligence missing ${needle}`));

const travelEvidence = read("lib/roamly/travelEvidence.ts");
[
  "scoreTravelEvidence",
  "runTravelEvidenceSearchFallback",
  "extractTravelReviewSnippets",
  "marketplaceWeight",
  "repetitionWeight",
  "severityWeight",
  "buildSearchReadyTravelEvidence",
  "travelEvidenceScraperConfigured",
  "ROAMLY_TRAVEL_EVIDENCE_PROVIDER",
  "FIRECRAWL_API_KEY"
].forEach((needle) => assert.ok(travelEvidence.includes(needle), `travel evidence missing ${needle}`));

const travelSearchBrain = read("lib/roamly/travelSearchBrain.ts");
[
  "buildTravelSearchBrief",
  "exact_match_terms",
  "must_match",
  "search_queries",
  "detail_fields",
  "disambiguation_rules",
  "exact_property_name",
  "flight_numbers",
  "exact_activity_name",
  "Never infer live price"
].forEach((needle) => assert.ok(travelSearchBrain.includes(needle), `travel search brain missing ${needle}`));

const travelEvidenceExports = loadTsModule("lib/roamly/travelEvidence.ts");
const strongHotelEvidence = travelEvidenceExports.scoreTravelEvidence({
  subject: "hotel",
  title: "Casa Verde Hotel",
  destination: "San Juan, Puerto Rico",
  marketplaceRating: 4.8,
  marketplaceReviewCount: 1800,
  snippets: [
    { text: "Guests repeatedly say the rooms are spotless and clean with a great location near transit." },
    { text: "Friendly staff, clean rooms, safe area, and easy check in made the stay smooth." },
    { text: "The hotel is central, walkable, comfortable, and worth it for families." },
    { text: "Reviewers call it clean, convenient, quiet, and reliable for first-time visitors." }
  ]
});
assert.ok(strongHotelEvidence.score >= 8 && strongHotelEvidence.score <= 10, "clearly strong travel evidence should score about 8-10");
assert.equal(strongHotelEvidence.verdict, "recommended", "clearly strong travel evidence should be recommended");

const moderateHotelEvidence = travelEvidenceExports.scoreTravelEvidence({
  subject: "hotel",
  title: "Harbor View Inn",
  destination: "San Juan, Puerto Rico",
  marketplaceRating: 4.4,
  marketplaceReviewCount: 320,
  snippets: [
    { text: "Recent guests say the room was clean and the location was convenient." },
    { text: "Clean rooms and friendly staff make this a good value stay." },
    { text: "The location is walkable and convenient for restaurants and beaches." }
  ]
});
assert.ok(moderateHotelEvidence.score >= 7 && moderateHotelEvidence.score <= 8, "moderately positive evidence should score about 7-8");
assert.equal(moderateHotelEvidence.verdict, "recommended", "moderately positive evidence should still be recommended");

const mixedHotelEvidence = travelEvidenceExports.scoreTravelEvidence({
  subject: "hotel",
  title: "Central Budget Rooms",
  destination: "San Juan, Puerto Rico",
  marketplaceRating: 4,
  marketplaceReviewCount: 150,
  snippets: [
    { text: "The location is convenient and staff were friendly." },
    { text: "Guests liked the walkable area and fair price." },
    { text: "Several reviews mention noisy rooms and thin walls." },
    { text: "Travelers also mention long check-in lines and confusing service." }
  ]
});
assert.ok(mixedHotelEvidence.score >= 4 && mixedHotelEvidence.score <= 7, "genuinely mixed evidence should score about 4-7");
assert.equal(mixedHotelEvidence.verdict, "mixed", "genuinely mixed evidence should stay mixed");

const poorHotelEvidence = travelEvidenceExports.scoreTravelEvidence({
  subject: "hotel",
  title: "Beachfront Problem Stay",
  destination: "San Juan, Puerto Rico",
  marketplaceRating: 2.6,
  marketplaceReviewCount: 90,
  snippets: [
    { text: "Multiple guests reported bed bugs and unsafe hallways." },
    { text: "Recent reviews repeat bed bug complaints, theft concerns, and a dirty room." },
    { text: "Travelers said the booking was overbooked and staff left them stranded." }
  ]
});
assert.ok(poorHotelEvidence.score >= 1 && poorHotelEvidence.score <= 3, "clearly poor evidence should score about 1-3");
assert.equal(poorHotelEvidence.verdict, "risky", "clearly poor evidence should be risky");

const highRatedMinorComplaintEvidence = travelEvidenceExports.scoreTravelEvidence({
  subject: "hotel",
  title: "Old Town Reliable Hotel",
  destination: "San Juan, Puerto Rico",
  marketplaceRating: 4.8,
  marketplaceReviewCount: 2200,
  snippets: [
    { text: "Reviewers repeatedly call the hotel clean, safe, and walkable." },
    { text: "Clean rooms, great location, and helpful staff are consistent themes." },
    { text: "Guests say it is convenient, comfortable, and worth it." },
    { text: "One guest thought the room was small and dated, but still clean." }
  ]
});
assert.equal(highRatedMinorComplaintEvidence.verdict, "recommended", "minor isolated complaints must not turn a high-rated hotel into mixed");
assert.ok(highRatedMinorComplaintEvidence.score >= 8, "high-rated option with broad positive evidence should remain strong");

const severeOverridesHighRatingEvidence = travelEvidenceExports.scoreTravelEvidence({
  subject: "hotel",
  title: "Rated But Risky Resort",
  destination: "San Juan, Puerto Rico",
  marketplaceRating: 4.7,
  marketplaceReviewCount: 3000,
  snippets: [
    { text: "Many guests praise the beach and location." },
    { text: "Recent reviews repeatedly report bed bugs in multiple rooms." },
    { text: "Another guest reported bed bug bites, dirty bedding, and refund problems." }
  ]
});
assert.ok(severeOverridesHighRatingEvidence.score >= 1 && severeOverridesHighRatingEvidence.score <= 3.2, "severe repeated complaints must override a high marketplace rating");
assert.equal(severeOverridesHighRatingEvidence.verdict, "risky", "severe repeated complaints should be risky even with high ratings");

const travelSearchBrainExports = loadTsModule("lib/roamly/travelSearchBrain.ts");
const hotelSearchBrief = travelSearchBrainExports.buildTravelSearchBrief({
  category: "hotel",
  destination: "San Juan, Puerto Rico",
  city: "San Juan",
  start_date: "2026-11-20",
  end_date: "2026-11-25",
  travelers: 2,
  rooms: 1,
  room_type: "Standard queen room",
  currency: "CAD"
});
assert.ok(hotelSearchBrief.search_queries.some((query) => query.includes("San Juan")), "hotel search brief must target the exact destination");
assert.ok(hotelSearchBrief.detail_fields.includes("exact_property_name"), "hotel search brief must require exact property names");
assert.equal(hotelSearchBrief.must_match.check_in, "2026-11-20", "hotel search brief must preserve check-in date");

const travelMarketSearchExactMatch = read("lib/roamly/travelMarketSearch.ts");
[
  "searchScraperDiscovery",
  "Firecrawl travel search",
  "exact_match_required",
  "travel_search_brief",
  "buildTravelSearchBrief",
  "discovery_source",
  "ROAMLY_TRAVEL_DISCOVERY_QUERIES",
  "AbortSignal.timeout(5_000)"
].forEach((needle) => assert.ok(travelMarketSearchExactMatch.includes(needle), `travel market exact-match scraper missing ${needle}`));

const accommodationStages = read("lib/roamly/brain/accommodationStages.ts");
[
  "buildAccommodationAreaSelectionLayer",
  "buildAccommodationSearchLayer",
  "buildAccommodationDecisionLayer",
  "buildAccommodationIntelligence"
].forEach((needle) => assert.ok(accommodationStages.includes(needle), `accommodation Brain stage helper missing ${needle}`));

const dailyItineraryStage = read("lib/roamly/brain/dailyItineraryStage.ts");
[
  "generateDailyItineraryBatch",
  "buildDailyItineraryBatches",
  "validateDailyItineraryBatch",
  "normalizeDailyItineraryDay",
  "response_format",
  "OPENAI_API_KEY_MISSING",
  "verified_live",
  "recently_retrieved",
  "estimated",
  "unknown",
  "reservation_requirements",
  "opening_hour_considerations",
  "weather_considerations",
  "accessibility_considerations",
  "backup_plan",
  "optional_flexible_activity",
  "Use only supplied evidence"
].forEach((needle) => assert.ok(dailyItineraryStage.includes(needle), `daily itinerary stage missing ${needle}`));

const brainIndex = read("lib/roamly/brain/index.ts");
assert.ok(brainIndex.includes("dailyItineraryStage"), "Brain index must export the daily itinerary stage");

const itineraryValidation = read("lib/roamly/itineraryValidation.ts");
[
  "validateItineraryDeterministically",
  "repairLowRiskItineraryIssues",
  "validateAndRepairItinerary",
  "buildItineraryLogisticsValidationLayer",
  "buildBudgetValidationLayer",
  "buildScheduleValidationLayer",
  "overlapping_activities",
  "impossible_travel_time",
  "closed_attraction",
  "insufficient_transfer_time",
  "missed_check_in_window",
  "departure_conflict",
  "budget_overrun",
  "duplicate_activity",
  "excessive_walking",
  "excessive_driving",
  "missing_meal_time",
  "missing_rest",
  "timezone_error",
  "date_error",
  "stale_market_data",
  "missing_reservation_warning",
  "mixed_currencies",
  "dependency_mismatch",
  "hotel_route_inconsistency",
  "transport_itinerary_inconsistency",
  "repairItineraryForTravelRequirements",
  "validationFindingsToInvalidatedStages"
].forEach((needle) => assert.ok(itineraryValidation.includes(needle), `itinerary validation missing ${needle}`));

const validationStages = read("lib/roamly/brain/validationStages.ts");
[
  "buildBrainValidationLayer",
  "itinerary_logistics_validation",
  "budget_validation",
  "schedule_validation",
  "validationRequiresTargetedRegeneration",
  "invalidate and rerun only the relevant Brain layer"
].forEach((needle) => assert.ok(validationStages.includes(needle), `validation Brain stage helper missing ${needle}`));
assert.ok(brainIndex.includes("validationStages"), "Brain index must export validation stages");

const finalAssembly = read("lib/roamly/brain/finalAssembly.ts");
[
  "ROAMLY_FINAL_ASSEMBLY_VERSION",
  "assembleFinalItinerary",
  "buildFinalAssemblyLayer",
  "targetedItineraryChangePlan",
  "trip_overview",
  "traveler_fit_summary",
  "recommended_transportation",
  "transportation_alternatives",
  "recommended_accommodation",
  "accommodation_alternatives",
  "area_rationale",
  "daily_itinerary",
  "travel_times",
  "estimated_total_cost",
  "cost_breakdown",
  "reservations",
  "warnings",
  "backup_options",
  "booking_links",
  "affiliate_disclosure",
  "source_timestamps",
  "why_trip_fits_traveler",
  "legacy_itinerary",
  "structured_layers",
  "replace_activity",
  "regenerate_day",
  "change_transport",
  "change_hotel",
  "change_budget",
  "change_pace",
  "change_dates",
  "Only dependent layers are invalidated"
].forEach((needle) => assert.ok(finalAssembly.includes(needle), `final assembly missing ${needle}`));
assert.ok(brainIndex.includes("finalAssembly"), "Brain index must export final assembly helpers");

const generationQueueMigration = read("supabase/migrations/20260715_roamly_generation_queue.sql");
[
  "roamly_trip_generation_jobs",
  "roamly_trip_generation_layers",
  "idempotency_key",
  "lease_expires_at",
  "roamly_claim_generation_jobs",
  "roamly_claim_generation_layer",
  "roamly_renew_generation_lease",
  "roamly_release_generation_job",
  "roamly_complete_generation_layer",
  "roamly_schedule_generation_layer_retry",
  "roamly_schedule_generation_job_retry",
  "roamly_cancel_generation_job",
  "roamly_invalidate_generation_layers",
  "for update skip locked",
  "enable row level security",
  "to service_role",
  "user_id = auth.uid()",
  "shared anonymous market cache"
].forEach((needle) => assert.ok(generationQueueMigration.toLowerCase().includes(needle.toLowerCase()), `generation queue migration missing ${needle}`));
assert.ok(generationQueueMigration.includes("status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')"), "generation job statuses must be constrained");
assert.ok(generationQueueMigration.includes("status in ('pending', 'running', 'completed', 'failed', 'skipped', 'invalidated')"), "generation layer statuses must be constrained");

const generationFinalizationMigration = read("supabase/migrations/20260731_roamly_generation_queue_postgrest_finalization.sql");
[
  "grant select on table public.roamly_trip_generation_jobs to anon, authenticated",
  "grant all privileges on table public.roamly_trip_generation_jobs to service_role",
  "grant select on table public.roamly_trip_generation_layers to anon, authenticated",
  "grant all privileges on table public.roamly_trip_generation_layers to service_role",
  "create policy \"Roamly users read own generation jobs\"",
  "create policy \"Roamly users read own generation layers\"",
  "roamly_finalize_generation_completion",
  "roamly_reconcile_completed_generation_jobs",
  "status = 'completed'",
  "locked_at = null",
  "locked_by = null",
  "lease_expires_at = null",
  "notify pgrst, 'reload schema'"
].forEach((needle) => assert.ok(generationFinalizationMigration.includes(needle), `generation finalization migration missing ${needle}`));

const generationQueueNonNullNextAttemptMigration = read("supabase/migrations/20260731_roamly_generation_queue_non_null_next_attempt.sql");
[
  "roamly_schedule_generation_layer_retry",
  "roamly_schedule_generation_job_retry",
  "roamly_finalize_generation_completion",
  "next_attempt_at = coalesce(next_attempt_at, p_completed_at, now())",
  "alter column next_attempt_at set default now()",
  "alter column next_attempt_at set not null",
  "notify pgrst, 'reload schema'"
].forEach((needle) =>
  assert.ok(
    generationQueueNonNullNextAttemptMigration.includes(needle),
    `generation queue non-null next_attempt_at migration missing ${needle}`
  )
);
assert.ok(
  !/roamly_trip_generation_jobs[\s\S]*?next_attempt_at\s*=\s*null/i.test(generationQueueNonNullNextAttemptMigration),
  "generation job finalization/retry must not write NULL next_attempt_at"
);
assert.ok(
  /next_attempt_at\s*=\s*case[\s\S]*?when next_retry < p_max_retries[\s\S]*?else now\(\)[\s\S]*?end/i.test(
    generationQueueNonNullNextAttemptMigration
  ),
  "exhausted generation job retries must keep a non-null next_attempt_at"
);

const generationCron = read("app/api/cron/roamly-itinerary-generation/route.ts");
assert.ok(generationCron.includes("processGenerationQueue"), "generation cron must wake the shared queue worker");
assert.ok(generationCron.includes("getGenerationWorkerSecrets"), "generation cron must be protected by accepted bearer secrets");
assert.ok(generationCron.includes("export async function POST"), "generation worker must support protected background POST triggers");
assert.ok(generationCron.includes("maxLayersPerRun: 8"), "protected worker wake must let the durable worker continue until its budget guard yields");

const generationWorker = read("lib/roamly/generationWorker.ts");
[
  "processGenerationQueue",
  "getGenerationWorkerConfig",
  "ROAMLY_GENERATION_BATCH_SIZE",
  "ROAMLY_GENERATION_CONCURRENCY",
  "ROAMLY_GENERATION_MAX_RETRIES",
  "ROAMLY_GENERATION_LEASE_SECONDS",
  "ROAMLY_GENERATION_MAX_LAYERS_PER_RUN",
  "maxLayersPerRun: 8",
  "ROAMLY_GENERATION_STAGE_CLEANUP_BUFFER_MS",
  "stageCleanupBufferMs",
  "hasBudgetForWork",
  "nextStagedGenerationWork",
  "ROAMLY_GENERATION_RETRY_BASE_SECONDS",
  "ROAMLY_GENERATION_RETRY_MAX_SECONDS",
  "claimGenerationJobs",
  "claimGenerationJobByTrip",
  "advanceStagedItineraryGeneration",
  "reconcileGenerationLayersFromStagedState",
  "sendStagedGenerationEmail",
  "finalizeStoredFullItinerary",
  "finalizeCompletedStagedGeneration",
  "requireQueueFinalization: true",
  "workerId: params.workerId",
  "recordGenerationCostEvent",
  "worker_execution",
  "model_tokens",
  "terminalStatus(state.status)",
  "releaseGenerationJob",
  "scheduleGenerationJobRetry"
].forEach((needle) => assert.ok(generationWorker.includes(needle), `generation worker missing ${needle}`));
[
  "terminalState && terminalStatus(terminalState.status)",
  "syncQueueFromState",
  "retry: { maxRetries: 0, retryBaseSeconds: 1, retryMaxSeconds: 1 }"
].forEach((needle) => assert.ok(generationWorker.includes(needle), `generation worker terminal throw handling missing ${needle}`));
assert.ok(
  generationWorker.indexOf("const finalized = await finalizeCompletedStagedGeneration") >= 0 &&
    generationWorker.indexOf("email = finalized.email", generationWorker.indexOf("const finalized = await finalizeCompletedStagedGeneration")) >
      generationWorker.indexOf("const finalized = await finalizeCompletedStagedGeneration"),
  "completion email result must come only from shared terminal finalization"
);
assert.ok(
  !stagedGenerator.includes('sendGenerationEmailSafely({ tripId: params.trip.id, kind: "completion"'),
  "staged generator must not send completion email before queue finalization"
);

const generationScalabilityMigration = read("supabase/migrations/20260715_roamly_generation_scalability.sql");
[
  "roamly_generation_cost_events",
  "roamly_generation_rate_limits",
  "roamly_generation_provider_limits",
  "paid_priority",
  "duplicate_request_key",
  "dead_lettered_at",
  "estimated_cost_json",
  "provider_usage_json",
  "roamly_record_generation_cost",
  "roamly_retry_generation_job_admin",
  "roamly_cancel_generation_job_admin",
  "roamly_mark_generation_job_dead_letter",
  "roamly_generation_queue_health",
  "roamly_generation_queue_admin",
  "model_tokens",
  "transport_search",
  "accommodation_search",
  "worker_execution",
  "enable row level security",
  "to service_role"
].forEach((needle) => assert.ok(generationScalabilityMigration.toLowerCase().includes(needle.toLowerCase()), `generation scalability migration missing ${needle}`));

const generationQueueAdminRoute = read("app/api/admin/roamly/generation-queue/route.ts");
["requireRoamlyAdmin", "getGenerationQueueHealth", "listAdminGenerationQueue", "adminRetryGenerationJob", "adminCancelGenerationJob"].forEach((needle) =>
  assert.ok(generationQueueAdminRoute.includes(needle), `generation queue admin route missing ${needle}`)
);

const providerAdapters = read("lib/roamly/providers/adapters.ts");
[
  "RoamlyProviderResponse",
  "provider_identifier",
  "retrieved_at",
  "availability_at",
  "raw_result",
  "normalized_result",
  "confidence",
  "stale_status",
  "rate_limit",
  "PROVIDER_CREDENTIALS_MISSING",
  "Roamly will not fabricate live availability, schedules, ratings, reviews, prices, or distances.",
  "providerDiagnostics",
  "validateProviderEnvironment",
  "flightProviderAdapter",
  "railProviderAdapter",
  "busProviderAdapter",
  "ferryProviderAdapter",
  "drivingDistanceProviderAdapter",
  "mapsProviderAdapter",
  "hotelProviderAdapter",
  "activitiesProviderAdapter",
  "reviewsProviderAdapter",
  "weatherProviderAdapter",
  "currencyConversionProviderAdapter",
  "affiliateProviderAdapter",
  "ROAMLY_TRAVELPAYOUTS_MARKER",
  "ROAMLY_RAIL_PROVIDER_API_KEY",
  "ROAMLY_BUS_PROVIDER_API_KEY",
  "ROAMLY_FERRY_PROVIDER_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "ROAMLY_STAY22_PARTNER_ID or ROAMLY_STAY22_SMART_LINK_URL or ROAMLY_STAY22_REFERRAL_URL",
  "ROAMLY_KLOOK_PARTNER_ID or ROAMLY_KLOOK_REFERRAL_URL",
  "live_prices_configured",
  "live_activity_prices_configured",
  "ROAMLY_REVIEWS_PROVIDER_API_KEY",
  "ROAMLY_WEATHER_API_KEY",
  "ROAMLY_CURRENCY_API_KEY",
  "ROAMLY_PROVIDER_ADAPTERS"
].forEach((needle) => assert.ok(providerAdapters.includes(needle), `provider adapter missing ${needle}`));

const liveProviderMigration = read("supabase/migrations/20260716_roamly_live_provider_status.sql");
[
  "live_provider_status_snapshots",
  "live_flight_status",
  "airport_gate",
  "train_status",
  "local_transit_disruption",
  "attraction_closure",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) => assert.ok(liveProviderMigration.toLowerCase().includes(needle.toLowerCase()), `live provider migration missing ${needle}`));

const liveProviderAdapters = read("lib/roamly/liveProviderAdapters.ts");
[
  "LiveProviderResult",
  "liveProviderDiagnostics",
  "liveFlightStatusAdapter",
  "airportGateAdapter",
  "trainStatusAdapter",
  "localTransitDisruptionAdapter",
  "weatherStatusAdapter",
  "trafficDrivingConditionsAdapter",
  "attractionClosureAdapter",
  "recordLiveProviderSnapshot",
  "ROAMLY_FLIGHT_STATUS_API_KEY",
  "ROAMLY_TRAIN_STATUS_API_KEY",
  "ROAMLY_TRANSIT_STATUS_API_KEY",
  "ROAMLY_ATTRACTION_STATUS_API_KEY",
  "Roamly will not fabricate live delays, gates, cancellations, weather, traffic, or closures."
].forEach((needle) => assert.ok(liveProviderAdapters.includes(needle), `live provider adapter missing ${needle}`));

const providerIndex = read("lib/roamly/providers/index.ts");
assert.ok(providerIndex.includes("liveProviderAdapters"), "live provider adapters must be exported through provider index");

const companionEventsMigration = read("supabase/migrations/20260716_roamly_companion_events.sql");
[
  "booking_change_events",
  "companion_events",
  "event_fingerprint",
  "affected_layers",
  "requires_user_approval",
  "booking_change_events_fingerprint_uidx",
  "companion_events_fingerprint_uidx",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) => assert.ok(companionEventsMigration.toLowerCase().includes(needle.toLowerCase()), `companion event migration missing ${needle}`));

const companionEventEngine = read("lib/roamly/companionEventEngine.ts");
[
  "companionEventFingerprint",
  "recordBookingChangeEvent",
  "recordCompanionEvent",
  "processBookingChangeEvent",
  "eventFromLiveProviderResult",
  "affectedLayersForCompanionEvent",
  "approvalRequiredForEvent",
  "flight_delayed",
  "flight_cancelled",
  "gate_changed",
  "hotel_cancelled",
  "missed_connection_risk",
  "analyzeCompanionImpact",
  "onConflict: \"user_id,event_fingerprint\""
].forEach((needle) => assert.ok(companionEventEngine.includes(needle), `companion event engine missing ${needle}`));

const companionImpactMigration = read("supabase/migrations/20260716_roamly_companion_impact_analysis.sql");
[
  "companion_impact_results",
  "affected_items_json",
  "timing_impact_json",
  "cost_impact_json",
  "traveler_action_required",
  "safe_automatic_actions",
  "approval_required_actions",
  "fallback_options",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) => assert.ok(companionImpactMigration.toLowerCase().includes(needle.toLowerCase()), `companion impact migration missing ${needle}`));

const companionImpactAnalysis = read("lib/roamly/companionImpactAnalysis.ts");
[
  "COMPANION_IMPACT_SCHEMA",
  "analyzeCompanionImpact",
  "deterministicImpact",
  "aiImpactReview",
  "json_schema",
  "strict: true",
  "paid_commitment_allowed: false",
  "Do not book, cancel, purchase",
  "safeAutomaticActions",
  "approvalRequiredActions"
].forEach((needle) => assert.ok(companionImpactAnalysis.includes(needle), `companion impact analysis missing ${needle}`));

const generationWorkerMigration = read("supabase/migrations/20260715_roamly_generation_worker.sql");
[
  "roamly_claim_generation_job_by_trip",
  "roamly_release_generation_layer",
  "roamly_skip_remaining_generation_layers",
  "for update skip locked",
  "grant execute"
].forEach((needle) => assert.ok(generationWorkerMigration.toLowerCase().includes(needle.toLowerCase()), `generation worker migration missing ${needle}`));

const generationBackground = read("lib/roamly/stagedGenerationBackground.ts");
assert.ok(generationBackground.includes("after("), "generation background trigger must continue after the response");
assert.ok(generationBackground.includes("/api/cron/roamly-itinerary-generation"), "background trigger must call the protected worker route");
assert.ok(generationBackground.includes("ROAMLY_GENERATION_CRON_SECRET") && generationBackground.includes("CRON_SECRET"), "background trigger must use the existing cron secret");
assert.ok(generationBackground.includes("staged_generation_background_worker_wake"), "background trigger must log protected worker wake results");
assert.ok(generationBackground.includes("staged_generation_background_wake_skipped"), "background trigger must log missing worker secrets");
assert.ok(generationBackground.includes("tripId: params.tripId"), "background worker wake must only process the scheduled trip id");
assert.ok(!generationBackground.includes("runLocalWorkerFallback"), "background trigger must not depend on an in-process fallback worker");
assert.ok(!generationBackground.includes("advanceStagedItineraryGeneration"), "background trigger must not execute staged generation directly");
assert.ok(!generationBackground.includes("outlineCompletedNeedsFirstDayContinuation"), "background trigger must not chain outline-to-day continuations");
assert.ok(!generationBackground.includes("outline_to_first_day"), "background trigger must not depend on outline-to-day chained HTTP timing");

const progressComponent = read("components/trip/StagedGenerationProgress.tsx");
assert.ok(progressComponent.includes("fetchWithSupabaseAuth"), "generation progress UI must send authenticated cookies/tokens");
assert.ok(progressComponent.includes("retryLimit"), "generation progress UI must respect the retry ceiling");
assert.ok(progressComponent.includes("estimatedAiCostUsd"), "generation progress payload must keep estimated AI cost available for diagnostics");
assert.ok(progressComponent.includes("Email me when ready"), "generation progress UI must show transactional email status");
assert.ok(!progressComponent.includes("QueueProgress"), "generation progress UI must not show internal QueueProgress labels");
assert.ok(!progressComponent.includes("percent"), "generation progress UI must not compute a display percentage");
assert.ok(!progressComponent.includes("role=\"progressbar\""), "generation progress UI must not render a progress bar");
[
  "SAVED_QUEUE_MESSAGE",
  "Your trip is safely saved. Roamly will continue building it even if you close this page.",
  "Preparing outline",
  "Outline",
  "Finalizing",
  "Building your trip",
  "Saving your itinerary",
  "Trip ready",
  "Taking longer than expected. You can leave this page.",
  "Generation failed — Retry",
  "simpleGenerationState",
  "progressFromApiForTrip(data, tripId)",
  "normalizeProgressForTrip",
  "normalizeQueueForTrip",
  "data?.status !== \"complete\"",
  "backendFailed",
  "finalValidationErrors",
  "trackPollMovement(nextProgress || data?.progress, nextQueue)",
  "terminalRefreshQueued",
  "router.refresh()",
  "wakeGenerationWorker"
].forEach((needle) => assert.ok(progressComponent.includes(needle), `generation progress UI missing ${needle}`));
assert.ok(!progressComponent.includes("(totalDays > 0 && completedDays >= totalDays)"), "generation progress UI must not mark a failed validation complete from day counts alone");
assert.ok(progressComponent.includes("/generation/status"), "generation progress UI must poll read-only status");
assert.ok(!progressComponent.includes("await advanceProgress"), "generation progress UI must not advance generation from polling");
["Trip understood", "Creating your days", "Checking your plan", "Current step"].forEach((needle) =>
  assert.ok(!progressComponent.includes(needle), `generation progress UI must not render old progress label ${needle}`)
);

const generationDiagnosticsRoute = read("app/api/admin/roamly/generation-diagnostics/route.ts");
["completionEmailQueued", "completionEmailSent", "completionEmailError", "itinerary_status", "finalStoredItinerary"].forEach((needle) =>
  assert.ok(generationDiagnosticsRoute.includes(needle), `generation diagnostics route missing ${needle}`)
);

const completedGenerationRepairRoute = read("app/api/admin/roamly/repair-completed-generations/route.ts");
assert.ok(completedGenerationRepairRoute.includes("tripId") && completedGenerationRepairRoute.includes("recoverCompletedStoredGenerations"), "completed generation repair route must support targeted stored-itinerary recovery");

const generationEmail = read("lib/roamly/itineraryGenerationEmail.ts");
[
  "finalizeStagedGenerationNotification",
  "sendStagedGenerationEmail",
  "sendPendingStagedGenerationEmail",
  "completion_email_status",
  "completion_email_sent_at",
  "completion_email_attempt_count",
  "completion_email_next_retry_at",
  "failure_email_sent_at",
  "email_provider_message_id",
  "delivery_status",
  "last_email_error",
  "sendRoamlyEmail",
  "transactional: true",
  "idempotencyKey",
  "findDeliveredGenerationEmail",
  "resolveTripOwnerEmail",
  "claimGenerationEmailSend",
  "isBlockedProductionRecipientEmail",
  "productionEmailSafetyEnabled",
  "getGenerationEmailStatusForTrip",
  "deliveredByColumn",
  "roamly_email_logs",
  "tripId: trip.id",
  "destination: getTripDestinationLabel(trip)",
  ".eq(\"idempotency_key\", key)",
  "Generation email already sent."
].forEach((needle) => assert.ok(generationEmail.includes(needle), `generation email helper missing ${needle}`));
assert.ok(generationEmail.includes("toRoamlyAbsoluteUrl(`/trip/${tripId}?from=generation-email`"), "itinerary completion email CTA must use a production-safe absolute trip URL");
assert.ok(!generationEmail.includes("if (process.env.VERCEL_URL) return"), "itinerary completion email must not point at Vercel preview domains");
assert.ok(generationEmail.includes("View your itinerary"), "itinerary completion email CTA copy must match the production template");
assert.ok(generationEmail.includes("same Roamly account"), "itinerary completion email must tell users to sign into the correct account");
assert.ok(generationEmail.includes("admin.auth.admin.getUserById") && !generationEmail.includes(".from(\"roamly_profiles\")"), "completion email must use the authenticated trip owner email only");
assert.ok(generationEmail.includes("completion_email_status.in.(pending,failed,skipped)") && generationEmail.includes("Generation email already sending or sent."), "completion email must claim an idempotent send before provider delivery");

const generationEmailExports = loadTsModule("lib/roamly/itineraryGenerationEmail.ts");
const ownerEmail = await generationEmailExports.resolveTripOwnerEmail(
  {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "real.owner@roamlyhq.com" } } })
      }
    },
    from() {
      throw new Error("profile fallback must not be used for completion email recipients");
    }
  },
  { user_id: "owner-user-id" }
);
assert.equal(ownerEmail.email, "real.owner@roamlyhq.com", "completion email must resolve the real auth owner email");
assert.equal(ownerEmail.source, "auth", "completion email recipient source must be auth");
const montrealFailureEmail = generationEmailExports.renderItineraryGenerationEmail("failure", {
  id: montrealTripId,
  user_id: "owner-user-id",
  title: "Montreal family trip",
  destination_name: "Montreal",
  destination_city: "Montreal",
  destination_country: "Canada",
  status: "draft",
  start_date: "2026-09-01",
  end_date: "2026-09-04",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  metadata: {
    planning: {
      destination: "Montreal",
      startDate: "2026-09-01",
      endDate: "2026-09-04"
    }
  }
});
assert.ok(montrealFailureEmail.subject.includes("Montreal"), "failure email destination must match the failed trip destination");
assert.ok(montrealFailureEmail.text.includes(`/trip/${montrealTripId}?from=generation-email`), "failure email link must point at the same trip id");
assert.ok(!montrealFailureEmail.subject.includes("New York") && !montrealFailureEmail.text.includes("New York"), "Montreal failure email must not leak another trip destination");

const emailAdapter = read("lib/roamly/email.ts");
[
  "nodemailer",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",

  "verifyRoamlyEmailProvider",
  "dns.lookup",
  "createSmtpTransporter",
  "messageId",
  "provider_message_id",
  "template",
  "attempt_count",
  "last_error",
  "EMAIL_PROVIDER_NOT_CONFIGURED",
  "preference === \"resend\"",
  "fetch(\"https://api.resend.com/emails\""
].forEach((needle) => assert.ok(emailAdapter.includes(needle), `email adapter missing ${needle}`));
assert.ok(emailAdapter.includes('readEnv("ROAMLY_EMAIL_PROVIDER").toLowerCase() || "smtp"'), "SMTP must be the default provider preference, not Resend");
assert.ok(!emailAdapter.includes('|| "resend"'), "Resend must not be the default Roamly email provider");
assert.ok(emailAdapter.includes('config.provider === "smtp"') && emailAdapter.includes("sendSmtpEmail"), "SMTP sends must use the SMTP sender path");
assert.ok(emailAdapter.includes('config.provider === "smtp"') && emailAdapter.includes("sendResendEmail"), "Resend must remain optional and provider-gated");
assert.ok(emailAdapter.includes("isBlockedProductionRecipientEmail") && emailAdapter.includes("Production email recipient is blocked."), "production email adapter must block temporary test recipients");
const emailAdapterExports = loadTsModule("lib/roamly/email.ts");
["codex-outline-day-1785541543519@roamlyhq.com", "smoke-test@roamlyhq.com", "traveler@example.com", "temporary-test@roamlyhq.com"].forEach((email) =>
  assert.equal(emailAdapterExports.isBlockedProductionRecipientEmail(email), true, `${email} must be blocked in production email flows`)
);
assert.equal(emailAdapterExports.isBlockedProductionRecipientEmail("real.owner@roamlyhq.com"), false, "real owner email must not be blocked");
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const blockedSend = await emailAdapterExports.sendRoamlyEmail({
  to: "codex-outline-day-1785541543519@roamlyhq.com",
  subject: "Blocked production recipient regression"
});
if (previousNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = previousNodeEnv;
}
assert.equal(blockedSend.ok, false, "codex production recipient must be rejected before delivery");
assert.equal(blockedSend.error, "Production email recipient is blocked.", "codex production recipient must return the production block error");

const emailTemplates = read("lib/roamly/emailTemplates.ts");
[
  "ROAMLY_LOGO_URL",
  "roamly-wordmark@2x.png",
  "renderRoamlyEmailHeader",
  "renderEmailHeading",
  "renderEmailBodyCopy",
  "renderEmailCta",
  "renderEmailSummary",
  "renderRoamlyEmailFooter",
  "renderPlainText",
  "role=\"presentation\"",
  "alt=\"Roamly\"",
  "View your itinerary"
].forEach((needle) => assert.ok(emailTemplates.includes(needle), `shared email layout missing ${needle}`));
assert.ok(!emailTemplates.includes("display:inline-flex"), "email layout must avoid flex-only logo/header markup");

const adminEmailPage = read("app/admin/email/page.tsx");
["Active provider", "activeProviderLabel", "Last successful send", "Retry queue", "completion_email_status"].forEach((needle) =>
  assert.ok(adminEmailPage.includes(needle), `admin email page missing ${needle}`)
);

const adminEmailConsole = read("components/admin/AdminEmailConsole.tsx");
[
  "Verify SMTP connection",
  "Send test email to admin",
  "Preview itinerary-ready email",
  "Preview welcome email",
  "Preview support email",
  "Desktop preview",
  "Mobile preview",
  "HTML preview",
  "Plain-text preview",
  "Retry failed email",
  "provider_message_id"
].forEach((needle) => assert.ok(adminEmailConsole.includes(needle), `admin email console missing ${needle}`));

const emailPreviewRoute = read("app/api/admin/roamly/email/preview/route.ts");
assert.ok(emailPreviewRoute.includes("renderSampleItineraryGenerationEmail") && emailPreviewRoute.includes("renderEmailTemplate"), "admin previews must use production renderers");

const emailTestRoute = read("app/api/admin/roamly/email/test/route.ts");
assert.ok(emailTestRoute.includes("getRoamlySupportEmail"), "admin test email must send to configured support/admin email");

const vercelConfig = read("vercel.json");
assert.ok(vercelConfig.includes("/api/cron/roamly-itinerary-generation"), "Vercel cron must resume staged itinerary generation");
assert.ok(vercelConfig.includes("\"schedule\": \"*/5 * * * *\""), "Vercel itinerary generation cron must run every five minutes");

const travelMarketSearch = read("lib/roamly/travelMarketSearch.ts");
assert.ok(travelMarketSearch.includes('return value !== "false" && value !== "0" && value !== "disabled";'), "market and affiliate gates should default on unless explicitly disabled");

const bookingWalletMigration = read("supabase/migrations/20260716_roamly_booking_wallet.sql");
[
  "trip_bookings",
  "booking_segments",
  "recommended",
  "clicked",
  "detected",
  "needs_confirmation",
  "confirmed",
  "modified",
  "cancelled",
  "refunded",
  "completed",
  "enable row level security",
  "user_id = auth.uid()",
  "trip_bookings_provider_booking_uidx",
  "booking_segments_booking_sequence_uidx"
].forEach((needle) =>
  assert.ok(bookingWalletMigration.toLowerCase().includes(needle.toLowerCase()), `booking wallet migration missing ${needle}`)
);

const bookingWallet = read("lib/roamly/bookingWallet.ts");
[
  "TRIP_BOOKING_TYPES",
  "TRIP_BOOKING_STATUSES",
  "TRIP_BOOKING_SOURCE_TYPES",
  "normalizeTripBookingInput",
  "normalizeBookingSegments",
  "isConfirmedBooking",
  "isBookingClickOnly",
  "stableBookingKey",
  "confirmedBookingsForItinerary",
  "bookingWalletSummary"
].forEach((needle) => assert.ok(bookingWallet.includes(needle), `booking wallet helper missing ${needle}`));

const bookingReconciliationMigration = read("supabase/migrations/20260716_roamly_booking_reconciliation.sql");
["booking_reconciliation_runs", "source_booking_id", "affected_layers", "enable row level security", "user_id = auth.uid()"].forEach((needle) =>
  assert.ok(bookingReconciliationMigration.toLowerCase().includes(needle.toLowerCase()), `booking reconciliation migration missing ${needle}`)
);

const bookingReconciliationStage = read("lib/roamly/brain/bookingReconciliation.ts");
[
  "BOOKING_RECONCILIATION_STAGE",
  "booking_reconciliation",
  "reconcileTripBookings",
  "reconcileBookingRecords",
  "stableBookingKey",
  "affectedLayersForBooking",
  "transport_decision",
  "accommodation_decision",
  "recommendationHistoryPreserved"
].forEach((needle) => assert.ok(bookingReconciliationStage.includes(needle), `booking reconciliation stage missing ${needle}`));

const brainIndexWithReconciliation = read("lib/roamly/brain/index.ts");
assert.ok(brainIndexWithReconciliation.includes("bookingReconciliation"), "booking reconciliation stage must be exported from the Brain package");

const compiledBookingWallet = ts.transpileModule(bookingWallet, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const bookingWalletSandbox = {
  exports: {},
  module: { exports: {} },
  require(id) {
    if (id === "@/lib/roamly/events") {
      return {
        recordTripEvent: async () => ({ ok: true })
      };
    }

    if (id === "@/lib/roamly/companionOrchestrator") {
      return {
        processCompanionBookingChange: async () => ({
          ok: true,
          test: true
        })
      };
    }

    return require(id);
  }
};
bookingWalletSandbox.exports = bookingWalletSandbox.module.exports;
vm.runInNewContext(compiledBookingWallet, bookingWalletSandbox);
const wallet = bookingWalletSandbox.module.exports;
const clickedBooking = {
  booking_status: "clicked",
  source_type: "affiliate_click",
  traveler_confirmed: false
};
assert.equal(wallet.isBookingClickOnly(clickedBooking), true, "affiliate clicks must remain click-only wallet records");
assert.equal(wallet.isConfirmedBooking(clickedBooking), false, "affiliate clicks must not become confirmed bookings");
const confirmedBooking = {
  booking_status: "confirmed",
  traveler_confirmed: true
};
assert.equal(wallet.isConfirmedBooking(confirmedBooking), true, "traveler-confirmed bookings must count as confirmed");
const normalizedFlight = wallet.normalizeTripBookingInput({
  bookingType: "flight",
  bookingStatus: "confirmed",
  travelerConfirmed: true,
  provider: "Air Canada",
  title: "AC 870",
  startTime: "2026-08-01T20:30:00-04:00",
  totalPrice: 1200.126,
  currency: "cad"
});
assert.equal(normalizedFlight.booking_type, "flight", "flight bookings must normalize");
assert.equal(normalizedFlight.currency, "CAD", "booking currencies must normalize to ISO uppercase");
assert.equal(normalizedFlight.total_price, 1200.13, "booking prices must be rounded, not converted from cents");
assert.ok(
  wallet.stableBookingKey({
    userId: "user-1",
    provider: "Air Canada",
    providerBookingId: "ABC123",
    bookingType: "flight"
  }).startsWith("provider:user-1:air canada:abc123"),
  "stable booking keys must dedupe provider confirmations"
);

const bookingWalletRoute = read("app/api/trips/[id]/bookings/route.ts");
["requireUser", "listTripBookings", "createTripBooking", "bookingInput", "segmentInput"].forEach((needle) =>
  assert.ok(bookingWalletRoute.includes(needle), `trip booking wallet route missing ${needle}`)
);
assert.ok(bookingWalletRoute.includes("reconcileTripBookings"), "manual booking saves must trigger booking reconciliation");

const bookingReconcileRoute = read("app/api/trips/[id]/bookings/reconcile/route.ts");
assert.ok(bookingReconcileRoute.includes("requireUser") && bookingReconcileRoute.includes("reconcileTripBookings"), "booking reconciliation route must be authenticated");

const bookingWalletPage = read("app/trip/[id]/bookings/page.tsx");
[
  "BookingWalletTimeline",
  "legacyRoamlyBookingToWallet",
  "listTripBookings",
  "mergeBookings",
  "tripHasTrackingUnlock",
  "login?next"
].forEach((needle) => assert.ok(bookingWalletPage.includes(needle), `booking wallet page missing ${needle}`));

const bookingWalletTimeline = read("components/companion/BookingWalletTimeline.tsx");
[
  "Add booking",
  "View details",
  "Trip status",
  "Next",
  "Today",
  "Trip",
  "Bookings",
  "Companion",
  "No bookings yet",
  "statusCopy",
  "BookingIcon"
].forEach((needle) => assert.ok(bookingWalletTimeline.includes(needle), `booking wallet timeline UI missing ${needle}`));
assert.ok(!bookingWalletTimeline.includes("Track flight"), "Booking Wallet must not claim live flight tracking before live providers are wired");
assert.ok(bookingWalletTimeline.includes("/bookings/add"), "Booking Wallet Add booking action must open the manual booking flow");

const manualBookingForm = read("components/companion/ManualBookingForm.tsx");
[
  "Upload confirmation",
  "Enter manually",
  "Review booking",
  "Check this field",
  "Airline",
  "Flight number",
  "Hotel name",
  "Check-in",
  "Check-out",
  "Save booking",
  `/api/trips/${"${tripId}"}/bookings/extract`,
  `/api/trips/${"${tripId}"}/bookings`
].forEach((needle) => assert.ok(manualBookingForm.includes(needle), `manual booking form missing ${needle}`));
assert.ok(!manualBookingForm.includes("Proceed") && !manualBookingForm.includes("Execute"), "manual booking UI must use plain action labels");

const addBookingPage = read("app/trip/[id]/bookings/add/page.tsx");
["ManualBookingForm", "login?next", "getTripBundle"].forEach((needle) =>
  assert.ok(addBookingPage.includes(needle), `add booking page missing ${needle}`)
);

const bookingExtractRoute = read("app/api/trips/[id]/bookings/extract/route.ts");
["extractBookingFromScreenshot", "application/pdf", "Review the fields before saving.", "Trip access denied"].forEach((needle) =>
  assert.ok(bookingExtractRoute.includes(needle), `booking extraction route missing ${needle}`)
);

const affiliateTrackingMigration = read("supabase/migrations/20260716_roamly_affiliate_tracking.sql");
[
  "affiliate_clicks",
  "affiliate_conversions",
  "sub_id",
  "affiliate_clicks_sub_id_uidx",
  "affiliate_conversions_partner_order_uidx",
  "affiliate_conversions_raw_event_uidx",
  "trip_bookings_affiliate_click_id_fkey",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(affiliateTrackingMigration.toLowerCase().includes(needle.toLowerCase()), `affiliate tracking migration missing ${needle}`)
);

const affiliateTracking = read("lib/roamly/affiliateTracking.ts");
[
  "createAffiliateSubId",
  "appendAffiliateSubId",
  "createAffiliateClick",
  "recordAffiliateConversion",
  "verifyAffiliateWebhookSignature",
  "normalizeAffiliateConversionEvent",
  "reconcileTripBookings",
  "We found your booking. Add the confirmation details to activate live tracking."
].forEach((needle) => assert.ok(affiliateTracking.includes(needle), `affiliate tracking helper missing ${needle}`));
const compiledAffiliateTracking = ts.transpileModule(affiliateTracking, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const affiliateTrackingSandbox = {
  exports: {},
  module: { exports: {} },
  require(id) {
    if (id === "@/lib/roamly/bookingLinks") return { safeExternalUrl: (value) => new URL(value).toString() };
    if (id === "@/lib/roamly/bookingWallet") return { createTripBooking: async () => ({ booking: null, error: null }) };
    if (id === "@/lib/roamly/brain/bookingReconciliation") return { reconcileTripBookings: async () => ({ ok: true, output: {} }) };
    return require(id);
  },
  URL,
  Buffer
};
affiliateTrackingSandbox.exports = affiliateTrackingSandbox.module.exports;
vm.runInNewContext(compiledAffiliateTracking, affiliateTrackingSandbox);
const affiliateTrackingExports = affiliateTrackingSandbox.module.exports;
assert.ok(/^rc_/.test(affiliateTrackingExports.createAffiliateSubId()), "affiliate sub IDs must be opaque Roamly click IDs");
assert.ok(
  affiliateTrackingExports.appendAffiliateSubId("https://www.stay22.com/search?aid=partner", "stay22", "rc_safeopaque1234567890").includes("sid=rc_safeopaque"),
  "Stay22 affiliate redirects must use opaque sid values"
);
assert.ok(
  !affiliateTrackingExports.appendAffiliateSubId("https://www.aviasales.com/search", "travelpayouts", "rc_safeopaque1234567890").includes("user"),
  "affiliate redirect params must not expose raw user identifiers"
);

const bookingRecommendationButton = read("components/trip/BookingRecommendationButton.tsx");
const bookingCtaLinks = read("lib/roamly/bookingCtaLinks.ts");
assert.ok(bookingRecommendationButton.includes("trackedAffiliateHref"), "booking CTA component must use the shared tracked affiliate href helper");
assert.ok(bookingCtaLinks.includes("/api/roamly/affiliate/click"), "affiliate booking CTAs must use tracked server redirects");
assert.ok(bookingCtaLinks.includes("destinationUrl") && bookingCtaLinks.includes("affiliateUrl"), "tracked affiliate CTAs must pass only internal redirect metadata");
assert.ok(!bookingRecommendationButton.includes("bookingDotComSearchUrl"), "hotel CTAs must not replace working Stay22 deep links with Booking.com");
assert.ok(!bookingRecommendationButton.includes('url.includes("partner")'), "hotel CTAs must not reject Stay22 traveler links just because an affiliate id includes partner text");

[
  "https://www.stay22.com/search?aid=partner",
  "https://www.stay22.com/allez/roam?aid=partner&address=San%20Juan"
].forEach((href) => {
  assert.equal(bookingCtaLinksExports.isTravelerSafeStay22BookingUrl(href), true, `${href} must remain usable in booking CTAs`);
  const tracked = bookingCtaLinksExports.trackedAffiliateHref({
    href,
    tripId: "trip_123",
    category: "hotel",
    title: "YWCA Hotel Vancouver",
    provider: "Stay22",
    hasAffiliateUrl: true,
    urlType: "affiliate"
  });
  const url = new URL(tracked, "https://roamly.local");
  assert.equal(url.pathname, "/api/roamly/affiliate/click", `${href} must use Roamly affiliate click tracking`);
  assert.equal(url.searchParams.get("affiliateUrl"), href, `${href} must preserve the existing Stay22 affiliate URL`);
  assert.equal(url.searchParams.get("destinationUrl"), href, `${href} must preserve the existing Stay22 destination URL`);
});

assert.equal(
  bookingCtaLinksExports.trackedAffiliateHref({
    href: "https://www.stay22.com/login",
    tripId: "trip_123",
    category: "hotel",
    title: "Unsafe hotel link",
    provider: "Stay22",
    hasAffiliateUrl: true,
    urlType: "affiliate"
  }),
  "",
  "unsafe Stay22 admin/login URLs must not render as hotel booking CTAs"
);

const affiliateClickRoute = read("app/api/roamly/affiliate/click/route.ts");
["requireUser", "createAffiliateClick", "NextResponse.redirect"].forEach((needle) =>
  assert.ok(affiliateClickRoute.includes(needle), `affiliate click route missing ${needle}`)
);

const affiliateWebhookRoute = read("app/api/webhooks/affiliate/route.ts");
["request.text()", "verifyAffiliateWebhookSignature", "ROAMLY_AFFILIATE_WEBHOOK_SECRET", "recordAffiliateConversion"].forEach((needle) =>
  assert.ok(affiliateWebhookRoute.includes(needle), `affiliate webhook route missing ${needle}`)
);

const emailConnectionsMigration = read("supabase/migrations/20260716_roamly_email_connections.sql");
[
  "email_connections",
  "email_watch_subscriptions",
  "email_sync_cursors",
  "encrypted_access_token",
  "encrypted_refresh_token",
  "gmail",
  "outlook",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(emailConnectionsMigration.toLowerCase().includes(needle.toLowerCase()), `email connections migration missing ${needle}`)
);

const travelEmailFilteringMigration = read("supabase/migrations/20260716_roamly_travel_email_filtering.sql");
[
  "travel_email_messages",
  "provider_message_id",
  "extracted_booking_facts",
  "parser_confidence",
  "processing_result",
  "raw_body_retained boolean not null default false",
  "travel_email_messages_no_raw_body_check",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(travelEmailFilteringMigration.toLowerCase().includes(needle.toLowerCase()), `travel email filtering migration missing ${needle}`)
);

const bookingExtractionMigration = read("supabase/migrations/20260716_roamly_booking_extraction_matching.sql");
[
  "booking_extraction_results",
  "email_message_id",
  "extracted_booking_json",
  "field_confidence_json",
  "overall_confidence",
  "match_status",
  "matched_booking_id",
  "needs_confirmation",
  "enable row level security",
  "user_id = auth.uid()"
].forEach((needle) =>
  assert.ok(bookingExtractionMigration.toLowerCase().includes(needle.toLowerCase()), `booking extraction migration missing ${needle}`)
);
const emailLookbackProductionMigration = read("supabase/migrations/20260801_roamly_email_lookback_production.sql");
[
  "references public.roamly_bookings(id)",
  "email_event_types",
  "auto_apply_allowed",
  "requires_user_approval",
  "applied_at",
  "idempotency_key"
].forEach((needle) =>
  assert.ok(emailLookbackProductionMigration.toLowerCase().includes(needle.toLowerCase()), `email lookback production migration missing ${needle}`)
);

const emailConnections = read("lib/roamly/emailConnections.ts");
[
  "GMAIL_READONLY_SCOPE",
  "OUTLOOK_READONLY_SCOPES",
  "ROAMLY_TOKEN_ENCRYPTION_KEY",
  "encryptToken",
  "decryptToken",
  "gmailAuthorizationUrl",
  "outlookAuthorizationUrl",
  "exchangeGmailCodeForTokens",
  "exchangeOutlookCodeForTokens",
  "renewGmailWatch",
  "renewOutlookSubscription",
  "syncGmailConnection",
  "syncOutlookConnection",
  "recordTravelEmailFilterResult",
  "extractAndMatchTravelEmailBooking",
  "EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC",
  "EMAIL_LOOKBACK_FETCH_TIMEOUT_MS",
  "EMAIL_LOOKBACK_BODY_TEXT_LIMIT",
  "fetchGmailTravelBodyText",
  "format\", \"metadata",
  "metadataHeaders",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta",
  "q\", \"newer_than:30d"
].forEach((needle) => assert.ok(emailConnections.includes(needle), `email connections helper missing ${needle}`));
assert.ok(!emailConnections.includes("gmail.modify"), "Gmail integration must not request write mailbox scopes");
assert.ok(!emailConnections.includes("Mail.ReadWrite"), "Outlook integration must not request write mailbox scopes");
assert.ok(emailConnections.indexOf("fetchGmailTravelBodyText") > emailConnections.indexOf("filterTravelEmail(metadata)"), "Gmail body preview must only be fetched after metadata filtering");

const travelEmailFiltering = read("lib/roamly/travelEmailFiltering.ts");
[
  "KNOWN_TRAVEL_DOMAINS",
  "TRAVEL_SUBJECT_PATTERNS",
  "BOOKING_REFERENCE_PATTERN",
  "FLIGHT_NUMBER_PATTERN",
  "filterTravelEmail",
  "recordTravelEmailFilterResult",
  "bodyStored: false",
  "raw_body_retained: false",
  "klook.com",
  "eventTypes",
  "bookingTypes"
].forEach((needle) => assert.ok(travelEmailFiltering.includes(needle), `travel email filtering helper missing ${needle}`));
["full_body", "body_html", "raw_email_body"].forEach((needle) =>
  assert.ok(!travelEmailFilteringMigration.includes(needle), `travel email filtering must not store ${needle}`)
);

const travelEmailFilteringExports = loadTsModule("lib/roamly/travelEmailFiltering.ts");
const klookFilter = travelEmailFilteringExports.filterTravelEmail({
  provider: "gmail",
  messageId: "m1",
  sender: "Klook <booking@klook.com>",
  subject: "Klook activity confirmation",
  snippet: "Voucher ABC12345 for Old Montreal Walking Tour on Aug 6, 2026 at 10:00 AM"
});
assert.equal(klookFilter.shouldProcess, true, "Klook activity confirmations must be processed");
assert.ok(klookFilter.extractedFacts.bookingTypes.includes("activity"), "Klook confirmation must be classified as activity");
const delayFilter = travelEmailFilteringExports.filterTravelEmail({
  provider: "gmail",
  messageId: "m2",
  sender: "Air Canada <updates@aircanada.com>",
  subject: "Flight delayed",
  snippet: "Flight AC123 is delayed. Confirmation QWERTY."
});
assert.ok(delayFilter.extractedFacts.eventTypes.includes("delay"), "flight delay emails must expose a delay event type");

const bookingExtraction = read("lib/roamly/bookingExtraction.ts");
[
  "BOOKING_EXTRACTION_JSON_SCHEMA",
  "deterministicBookingExtraction",
  "scoreTripForEmailLookbackMatch",
  "shouldAutoApplyEmailLookbackExtraction",
  "extractBookingWithAiStructuredOutput",
  "json_schema",
  "strict: true",
  "createTripBooking",
  "bestTripMatch",
  "existingBookingTripMatch",
  "EMAIL_LOOKBACK_AUTO_APPLY_CONFIDENCE",
  "EMAIL_LOOKBACK_TRIP_MATCH_THRESHOLD",
  "requiresUserApproval",
  "auto_apply_allowed",
  "requires_user_approval",
  "needs_confirmation",
  "high_confidence_match",
  "reconcileTripBookings",
  "Do not infer missing booking facts"
].forEach((needle) => assert.ok(bookingExtraction.includes(needle), `booking extraction helper missing ${needle}`));
assert.ok(
  bookingWallet.includes("processCompanionBookingChange"),
  "booking wallet must trigger Companion for meaningful booking changes"
);
assert.ok(
  bookingExtraction.includes('onConflict: "user_id,source_type,source_reference"'),
  "booking extraction persistence must be idempotent by source reference"
);
assert.ok(
  travelEmailFiltering.includes('onConflict: "email_connection_id,provider,provider_message_id"') && emailConnections.includes("email_sync_cursors"),
  "email sync must checkpoint messages and avoid duplicate processing"
);

const bookingExtractionExports = loadTsModule("lib/roamly/bookingExtraction.ts");
const montrealTrip = {
  id: "trip-montreal",
  user_id: "user-1",
  title: "Montreal August trip",
  destination: "Montreal",
  destination_name: "Montreal",
  destination_city: "Montreal",
  start_date: "2026-08-05",
  end_date: "2026-08-08"
};
const torontoTrip = {
  id: "trip-toronto",
  user_id: "user-1",
  title: "Toronto August trip",
  destination: "Toronto",
  destination_name: "Toronto",
  destination_city: "Toronto",
  start_date: "2026-08-05",
  end_date: "2026-08-08"
};

function emailLookbackFixture(metadata) {
  const filter = travelEmailFilteringExports.filterTravelEmail(metadata);
  assert.equal(filter.shouldProcess, true, `${metadata.messageId} must be treated as a travel email`);
  const extraction = bookingExtractionExports.deterministicBookingExtraction({ metadata, filter });
  const montrealScore = bookingExtractionExports.scoreTripForEmailLookbackMatch(montrealTrip, extraction, 2);
  const torontoScore = bookingExtractionExports.scoreTripForEmailLookbackMatch(torontoTrip, extraction, 2);
  assert.ok(montrealScore.score >= 0.7, `${metadata.messageId} must confidently match the Montreal trip`);
  assert.ok(montrealScore.score > torontoScore.score, `${metadata.messageId} must not match the wrong trip first`);
  return { filter, extraction, score: montrealScore.score };
}

const fixtureResults = {
  flightConfirmation: emailLookbackFixture({
    provider: "gmail",
    messageId: "fixture-flight-confirmation",
    sender: "Air Canada <itinerary@aircanada.com>",
    subject: "Booking confirmation for flight AC123",
    snippet: "Confirmation QWERTY. From Saint John to Montreal on Aug 6, 2026 at 10:00 AM. Destination: Montreal."
  }),
  flightDelay: emailLookbackFixture({
    provider: "gmail",
    messageId: "fixture-flight-delay",
    sender: "Air Canada <updates@aircanada.com>",
    subject: "Flight AC123 delayed",
    snippet: "Flight AC123 is delayed. Confirmation QWERTY. From Saint John to Montreal on Aug 6, 2026 at 10:00 AM. Destination: Montreal."
  }),
  flightCancellation: emailLookbackFixture({
    provider: "gmail",
    messageId: "fixture-flight-cancelled",
    sender: "Air Canada <updates@aircanada.com>",
    subject: "Flight AC123 cancelled",
    snippet: "Cancellation notice. Confirmation QWERTY. From Saint John to Montreal on Aug 6, 2026 at 10:00 AM. Destination: Montreal."
  }),
  hotelChange: emailLookbackFixture({
    provider: "gmail",
    messageId: "fixture-hotel-change",
    sender: "Booking.com <noreply@booking.com>",
    subject: "Your hotel booking changed",
    snippet: "Booking changed. Confirmation HN12345. Hotel: Hotel Nelligan. Destination: Montreal. Check-in Aug 6, 2026 at 3:00 PM."
  }),
  activityBooking: emailLookbackFixture({
    provider: "gmail",
    messageId: "fixture-klook-activity",
    sender: "Klook <booking@klook.com>",
    subject: "Klook activity confirmation",
    snippet: "Voucher KLOOK123. Activity: Old Montreal Walking Tour. Destination: Montreal. Aug 7, 2026 at 10:00 AM."
  }),
  transportBooking: emailLookbackFixture({
    provider: "gmail",
    messageId: "fixture-transport",
    sender: "Airport Shuttle <booking@airportshuttle.example>",
    subject: "Transport confirmation",
    snippet: "Confirmation TRNSP9. Transfer: YUL Airport Transfer. Destination: Montreal. Aug 6, 2026 at 1:00 PM."
  })
};

assert.equal(fixtureResults.flightConfirmation.extraction.booking.bookingType, "flight", "flight confirmation must extract a flight booking");
assert.equal(fixtureResults.flightDelay.extraction.eventTypes.includes("delay"), true, "flight delay fixture must expose delay event");
assert.equal(fixtureResults.flightDelay.extraction.requiresUserApproval, false, "minor delay fixture must not require approval by default");
assert.equal(fixtureResults.flightCancellation.extraction.requiresUserApproval, true, "flight cancellation fixture must require approval");
assert.equal(fixtureResults.hotelChange.extraction.booking.bookingType, "hotel", "hotel change fixture must extract a hotel booking");
assert.equal(fixtureResults.hotelChange.extraction.requiresUserApproval, true, "hotel change fixture must require approval");
assert.equal(fixtureResults.activityBooking.extraction.booking.bookingType, "activity", "Klook fixture must extract an activity booking");
assert.equal(fixtureResults.activityBooking.extraction.booking.provider, "Klook", "Klook fixture must keep the provider name");
assert.equal(fixtureResults.transportBooking.extraction.booking.bookingType, "transfer", "transport fixture must extract a transfer booking");
assert.equal(
  bookingExtractionExports.shouldAutoApplyEmailLookbackExtraction({
    extraction: fixtureResults.flightDelay.extraction,
    matchScore: fixtureResults.flightDelay.score
  }),
  true,
  "safe high-confidence delay update must be auto-applicable"
);
assert.equal(
  bookingExtractionExports.shouldAutoApplyEmailLookbackExtraction({
    extraction: fixtureResults.flightCancellation.extraction,
    matchScore: 1
  }),
  false,
  "major cancellation must require approval even with an exact match"
);

const liveCompanionExports = loadTsModule("lib/roamly/liveCompanion.ts");
const verifiedMuseum = liveCompanionExports.applyVerifiedBookingOverride(
  {
    id: "museum",
    title: "Pointe-a-Calliere Museum",
    shortDescription: "Stale itinerary copy.",
    dayNumber: 1,
    timeLabel: "11:00 AM",
    address: "350 Place Royale, Montreal",
    latitude: 45.5027,
    longitude: -73.5545,
    booking: { title: "Pointe-a-Calliere Museum", status: "stale", startTime: "2026-08-06T11:00:00-04:00" }
  },
  [
    {
      id: "booking-museum",
      title: "Pointe-a-Calliere Museum",
      provider: "Email Lookback",
      reference: "KLOOK123",
      status: "verified",
      startTime: "2026-08-06T13:00:00-04:00",
      updatedAt: "2026-08-06T09:00:00-04:00"
    }
  ]
);
assert.equal(verifiedMuseum.startAt, "2026-08-06T13:00:00-04:00", "verified booking changes must override stale itinerary time");
assert.equal(verifiedMuseum.booking.reference, "KLOOK123", "verified booking reference must flow into Live Companion");
const liveSelection = liveCompanionExports.selectNowAndNextActivity({
  activities: [
    {
      id: "basilica",
      title: "Notre-Dame Basilica",
      dayNumber: 1,
      timeLabel: "9:00 AM",
      status: "completed",
      latitude: 45.5045,
      longitude: -73.5561
    },
    verifiedMuseum
  ],
  tripStartDate: "2026-08-06",
  timezone: "America/Toronto",
  now: "2026-08-06T16:30:00.000Z"
});
assert.equal(liveSelection.next.id, "museum", "Live Companion Now/Next must use verified booking timing");
const leaveDecision = liveCompanionExports.evaluateNotificationDecision({
  eventType: "leave_by",
  activity: verifiedMuseum,
  now: "2026-08-06T16:20:00.000Z",
  activeWindow: true,
  paused: false,
  reason: "Fixture leave-by notification."
});
const cooldownDecision = liveCompanionExports.evaluateNotificationDecision({
  eventType: "leave_by",
  activity: verifiedMuseum,
  now: "2026-08-06T16:25:00.000Z",
  activeWindow: true,
  paused: false,
  history: [{ key: leaveDecision.key, eventType: "leave_by", activityId: "museum", sentAt: leaveDecision.eventTime }],
  reason: "Fixture duplicate leave-by notification."
});
assert.equal(leaveDecision.notificationSent, true, "first leave-by notification should send");
assert.equal(cooldownDecision.notificationSent, false, "duplicate leave-by notification should be suppressed by cooldown");

const liveCompanionQaConsole = read("components/admin/LiveCompanionQaConsole.tsx");
[
  "phonePresets",
  "previewModes",
  "Trip start",
  "Before trip",
  "Arrive",
  "Late",
  "Route down",
  "Permission denied",
  "Offline",
  "Cooldown",
  "Notification test log",
  "Suppression:",
  "Reminder lead",
  "Location interval",
  "Arrival radius",
  "longTextStress",
  "darkMode"
].forEach((needle) => assert.ok(liveCompanionQaConsole.includes(needle), `Live Companion QA console missing ${needle}`));

const emailProviderAdapters = read("lib/roamly/emailProviderAdapters.ts");
["EMAIL_PROVIDER_ADAPTERS", "Gmail", "Outlook", "supportsIncrementalSync", "MICROSOFT_OUTLOOK_CLIENT_ID"].forEach((needle) =>
  assert.ok(emailProviderAdapters.includes(needle), `email provider adapter registry missing ${needle}`)
);

[
  "app/api/integrations/gmail/connect/route.ts",
  "app/api/integrations/gmail/callback/route.ts",
  "app/api/integrations/gmail/disconnect/route.ts",
  "app/api/integrations/gmail/sync/route.ts",
  "app/api/webhooks/gmail/route.ts",
  "app/api/integrations/outlook/connect/route.ts",
  "app/api/integrations/outlook/callback/route.ts",
  "app/api/integrations/outlook/disconnect/route.ts",
  "app/api/integrations/outlook/sync/route.ts",
  "app/api/webhooks/outlook/route.ts",
  "lib/roamly/emailProviderAdapters.ts",
  "app/api/account/email-connections/route.ts"
].forEach((file) => assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`));

const gmailConnectRoute = read("app/api/integrations/gmail/connect/route.ts");
["GMAIL_OAUTH_STATE_COOKIE", "gmailAuthorizationUrl", "requireUser"].forEach((needle) =>
  assert.ok(gmailConnectRoute.includes(needle), `Gmail connect route missing ${needle}`)
);

const gmailCallbackRoute = read("app/api/integrations/gmail/callback/route.ts");
["exchangeGmailCodeForTokens", "getGmailProfile", "upsertGmailConnection", "renewGmailWatch"].forEach((needle) =>
  assert.ok(gmailCallbackRoute.includes(needle), `Gmail callback route missing ${needle}`)
);

const gmailWebhookRoute = read("app/api/webhooks/gmail/route.ts");
["ROAMLY_GMAIL_WEBHOOK_SECRET", "Buffer.from", "syncGmailConnection"].forEach((needle) =>
  assert.ok(gmailWebhookRoute.includes(needle), `Gmail webhook route missing ${needle}`)
);

const outlookConnectRoute = read("app/api/integrations/outlook/connect/route.ts");
["OUTLOOK_OAUTH_STATE_COOKIE", "outlookAuthorizationUrl", "requireUser"].forEach((needle) =>
  assert.ok(outlookConnectRoute.includes(needle), `Outlook connect route missing ${needle}`)
);

const outlookCallbackRoute = read("app/api/integrations/outlook/callback/route.ts");
["exchangeOutlookCodeForTokens", "getOutlookProfile", "upsertOutlookConnection", "renewOutlookSubscription"].forEach((needle) =>
  assert.ok(outlookCallbackRoute.includes(needle), `Outlook callback route missing ${needle}`)
);

const outlookWebhookRoute = read("app/api/webhooks/outlook/route.ts");
["ROAMLY_OUTLOOK_WEBHOOK_SECRET", "validationToken", "syncOutlookConnection"].forEach((needle) =>
  assert.ok(outlookWebhookRoute.includes(needle), `Outlook webhook route missing ${needle}`)
);

const emailConnectionSettings = read("components/account/EmailConnectionSettings.tsx");
["Connect Gmail", "Disconnect Gmail", "Sync Gmail", "Connect Outlook", "Disconnect Outlook", "Sync Outlook", "Personal emails are not saved or used for advertising."].forEach((needle) =>
  assert.ok(emailConnectionSettings.includes(needle), `email connection settings missing ${needle}`)
);

const accountPageWithEmailImport = read("app/account/page.tsx");
assert.ok(accountPageWithEmailImport.includes("EmailConnectionSettings"), "account page must expose mailbox controls separately from Google login");

console.log("Roamly core checks passed.");
