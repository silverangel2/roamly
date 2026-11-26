// KF-1 #3 (Bangkok, 2026-11-23) — flight label / URL mismatch proof.
//
// The failure: the Bangkok itinerary failed final validation with
// "Flight suggestion Saint John, Canada to Bangkok, Thailand flight
// option is not routed through Travelpayouts." — even though the
// suggestion's affiliate_url IS a genuine Travelpayouts/Aviasales deep
// link (marker 750294). The URL and the label come from two different
// branches in enrichItineraryBookingSuggestions: the URL from the
// market's verified-partner Travelpayouts result, the label from the
// link builder's disclosure gate (ROAMLY_TRAVELPAYOUTS_MARKER). When
// the gate is off at enrich time, the label says "roamly_internal"
// while the URL stays a real Travelpayouts link — and the validator
// checks the label alone, so the trip fails.
//
// The fix (lib/roamly/affiliateLinks.ts): derive affiliate_provider
// from the final affiliate_url's host when it identifies a known
// partner for that category (flight -> travelpayouts, hotel -> stay22,
// tour/attraction -> klook), falling back to the resolver's label
// otherwise. Validation itself is untouched.
//
// Run with the marker env FORCED OFF (the Bangkok gate state) so the
// reproduction is deterministic: delete ROAMLY_TRAVELPAYOUTS_MARKER
// before loading any module. Before the fix this script FAILS (label
// "roamly_internal", Travelpayouts validation error present). After
// the fix it PASSES (label "travelpayouts", error gone, validator
// still rejecting a genuinely mis-routed flight).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Bangkok gate state: no Travelpayouts marker configured at enrich time.
delete process.env.ROAMLY_TRAVELPAYOUTS_MARKER;
delete process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER;
delete process.env.ROAMLY_AFFILIATES_ENABLED;

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

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
        if (id === "server-only") return {};
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.match(/\.(ts|tsx|mjs|json)$/) ? resolved : `${resolved}.ts`);
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

const { enrichItineraryBookingSuggestions, affiliateProviderForUrl } = loadTsModule("lib/roamly/affiliateLinks.ts");
const { validateItineraryForProduction } = loadTsModule("lib/itinerary.ts");

const AVIASALES_URL = "https://www.aviasales.com/search/YSJ2411BKK26113?marker=750294";
const TRAVELPAYOUTS_ERROR = "is not routed through Travelpayouts";

// --- Fixture: Bangkok-shaped input (model suggestion + verified-partner market result) ---
const flightSuggestion = {
  title: "Saint John, Canada to Bangkok, Thailand flight option",
  category: "flight",
  booking_category: "flight",
  provider: "Flight search",
  destination: "Bangkok, Thailand",
  city: "Bangkok",
  origin: "Saint John, Canada",
  departure_date: "2026-11-24",
  return_date: "2026-11-26",
  date: "2026-11-24",
  normal_search_url: "https://www.google.com/search?q=Saint+John+to+Bangkok+2026-11-24+2026-11-26+flights"
};

const marketResult = {
  id: "flight-bangkok-1",
  category: "flight",
  title: "Saint John, Canada to Bangkok, Thailand flight option",
  provider: "Flight search",
  source: "travelpayouts",
  price_type: "search_ready",
  affiliate_url: AVIASALES_URL,
  booking_url: AVIASALES_URL,
  normal_search_url: "https://www.google.com/search?q=Saint+John+to+Bangkok+2026-11-24+2026-11-26+flights",
  destination: "Bangkok, Thailand",
  city: "Bangkok",
  country: "Thailand",
  confidence: "low",
  price_confidence: "unknown",
  searched_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
};

const payload = {
  origin: "Saint John, Canada",
  destination: "Bangkok, Thailand",
  destinationCity: "Bangkok",
  destinationCountry: "Thailand",
  startDate: "2026-11-24",
  endDate: "2026-11-26",
  daysCount: 3,
  travelersCount: 3,
  travelers: { adults: 2, children: 1 },
  rooms: 1,
  budgetAmount: 1100,
  budgetCurrency: "CAD",
  travelStyle: "relaxed",
  interests: [],
  pace: "gentle",
  accommodationPreference: "hotel",
  transportationPreference: "public transport",
  specialNotes: "Couple with a six year old son; halal; elevator access.",
  priceDiscovery: {
    groundedDecision: {
      selectedFlightCandidateId: "flight-bangkok-1",
      candidates: [
        {
          candidateId: "flight-bangkok-1",
          category: "flight",
          source: "travelpayouts",
          sourceType: "market",
          deepLink: AVIASALES_URL
        }
      ]
    },
    selectedMarketPrices: [],
    marketResults: [marketResult]
  }
};

const itinerary = {
  daily_itinerary: [],
  estimated_budget_breakdown: { transport_options: [] },
  booking_suggestions: [flightSuggestion]
};

// --- 1. The enrich path (the live failure): gate off + verified-partner market ---
// Runs FIRST so the before-fix run fails on the mechanism itself
// (label "roamly_internal" on a genuine Travelpayouts URL), not on a
// missing export.
const enriched = enrichItineraryBookingSuggestions(itinerary, payload);
const enrichedFlight = enriched.booking_suggestions.find((s) => s.category === "flight");
assert.ok(enrichedFlight, "enrich must keep the flight suggestion");
assert.equal(enrichedFlight.affiliate_url, AVIASALES_URL, "enrich must keep the genuine Travelpayouts URL");
assert.equal(
  enrichedFlight.affiliate_provider,
  "travelpayouts",
  `Bangkok-shaped enrich with the marker gate off must label the Aviasales URL travelpayouts (got ${enrichedFlight.affiliate_provider})`
);

// --- 2. The derivation itself (pure, URL -> label) ---
assert.equal(
  typeof affiliateProviderForUrl,
  "function",
  "affiliateProviderForUrl must be exported from lib/roamly/affiliateLinks.ts"
);
assert.equal(affiliateProviderForUrl(AVIASALES_URL, "flight"), "travelpayouts", "Aviasales deep link must derive travelpayouts for a flight");
assert.equal(affiliateProviderForUrl("https://www.stay22.com/landing?aid=roamly", "hotel"), "stay22", "Stay22 URL must derive stay22 for a hotel");
assert.equal(affiliateProviderForUrl("https://www.klook.com/activity/123", "tour"), "klook", "Klook URL must derive klook for a tour");
assert.equal(affiliateProviderForUrl("https://www.google.com/search?q=flights", "flight"), null, "a plain search URL must not derive any partner");
assert.equal(affiliateProviderForUrl(AVIASALES_URL, "hotel"), null, "a flight URL must not derive a partner for a hotel");

// --- 3. The validator on the enriched itinerary: the Travelpayouts error must be gone ---
const validation = validateItineraryForProduction(enriched, payload);
assert.ok(
  !validation.errors.some((error) => error.includes(TRAVELPAYOUTS_ERROR)),
  `validation must not report the Travelpayouts routing error after the fix (errors: ${validation.errors.join(" | ")})`
);

// --- 4. No weakening: the validator still rejects a genuinely mis-routed flight ---
const misrouted = {
  daily_itinerary: [],
  estimated_budget_breakdown: { transport_options: [] },
  booking_suggestions: [
    {
      title: "Saint John, Canada to Bangkok, Thailand flight option",
      category: "flight",
      affiliate_url: "https://www.example-booking.com/flights/ysj-bkk",
      affiliate_provider: "booking_com"
    }
  ]
};
const misroutedValidation = validateItineraryForProduction(misrouted, payload);
assert.ok(
  misroutedValidation.errors.some((error) => error.includes(TRAVELPAYOUTS_ERROR)),
  "validation must still reject a flight whose affiliate URL is not routed through Travelpayouts"
);

// --- 5. Koeln shape (no affiliate URL): label stays roamly_internal, no routing error ---
const noUrlPayload = { ...payload, priceDiscovery: { groundedDecision: null, selectedMarketPrices: [], marketResults: [] } };
const noUrlEnriched = enrichItineraryBookingSuggestions(
  { daily_itinerary: [], estimated_budget_breakdown: { transport_options: [] }, booking_suggestions: [{ ...flightSuggestion, title: "Saint John, Canada to Koeln, Germany flight option" }] },
  noUrlPayload
);
const noUrlFlight = noUrlEnriched.booking_suggestions.find((s) => s.category === "flight");
assert.ok(noUrlFlight, "enrich must keep the no-URL flight suggestion");
assert.equal(noUrlFlight.affiliate_url || "", "", "Koeln-shaped enrich must produce no affiliate URL");
assert.equal(noUrlFlight.affiliate_provider, "roamly_internal", "a flight with no affiliate URL keeps the roamly_internal label");
const noUrlValidation = validateItineraryForProduction(noUrlEnriched, payload);
assert.ok(
  !noUrlValidation.errors.some((error) => error.includes(TRAVELPAYOUTS_ERROR)),
  "a flight with no affiliate URL must not trip the Travelpayouts routing rule"
);

console.log("KF-1 #3 flight-label checks: PASS (label follows the URL; validator untouched)");
