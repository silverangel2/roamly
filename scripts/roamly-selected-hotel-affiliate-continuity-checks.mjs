import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    if (absolute.endsWith(".json")) {
      const module = { exports: JSON.parse(fs.readFileSync(absolute, "utf8")) };
      cache.set(absolute, { module });
      return module.exports;
    }
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
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
          const local = path.join(path.dirname(file), id);
          return load(local.match(/\.(ts|tsx|json)$/) ? local : `${local}.ts`);
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

const links = loadTsModule("lib/roamly/affiliateLinks.ts");
const resolver = loadTsModule("lib/roamly/affiliateResolver.ts");
const { marketResultIsSelectedHotel } = links;
const { isTravelerSafeStay22Url, resolveAffiliateLink } = resolver;

const previous = {
  ROAMLY_AFFILIATES_ENABLED: process.env.ROAMLY_AFFILIATES_ENABLED,
  ROAMLY_HOTEL_AFFILIATE_PROVIDER: process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER,
  ROAMLY_STAY22_PARTNER_ID: process.env.ROAMLY_STAY22_PARTNER_ID,
  ROAMLY_STAY22_SMART_LINK_URL: process.env.ROAMLY_STAY22_SMART_LINK_URL,
  ROAMLY_STAY22_REFERRAL_URL: process.env.ROAMLY_STAY22_REFERRAL_URL
};

process.env.ROAMLY_AFFILIATES_ENABLED = "true";
process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER = "stay22";
process.env.ROAMLY_STAY22_PARTNER_ID = "stay22-test-partner";
delete process.env.ROAMLY_STAY22_SMART_LINK_URL;
delete process.env.ROAMLY_STAY22_REFERRAL_URL;

const payload = {
  destination: "Toronto, Canada",
  destinationCity: "Toronto",
  destinationCountry: "Canada",
  origin: "Saint John, Canada",
  startDate: "2026-10-05",
  endDate: "2026-10-08",
  travelersCount: 2,
  travelers: { adults: 2, children: 1, infants: 0 },
  rooms: 1,
  budgetCurrency: "CAD",
  budgetAmount: 2500,
  budgetIncludesHotel: true,
  priceDiscovery: {
    groundedDecision: { selectedHotelCandidateId: "hotel-a", candidates: [{ candidateId: "hotel-a", category: "hotel", name: "Hotel A" }] },
    marketResults: []
  }
};

const baseSuggestion = {
  category: "hotel",
  booking_category: "hotel",
  candidateId: "hotel-a",
  title: "Hotel A",
  description: "Selected Hotel A",
  destination: "Toronto, Canada",
  neighborhood: "Downtown",
  room_type: "standard room",
  booking_status: "suggested",
  booking_label: "View hotel options",
  normal_search_url: "",
  estimated_cost_min: null,
  estimated_cost_max: null,
  currency: "CAD",
  price_confidence: "unknown"
};

assert.equal(isTravelerSafeStay22Url("https://www.stay22.com/allez/roam?aid=stay22-test-partner"), true, "G: configured Stay22 traveler URL is trusted");
assert.equal(isTravelerSafeStay22Url("https://evil.example/stay22"), false, "H/I/J: non-Stay22 and arbitrary hosts are rejected");
assert.equal(isTravelerSafeStay22Url("https://app.stay22.com/partner"), false, "J: Stay22 operational hosts are not traveler destinations");

const resolved = resolveAffiliateLink({
  category: "hotel",
  title: "Hotel A",
  destination: "Toronto, Canada",
  startDate: payload.startDate,
  endDate: payload.endDate,
  adults: 2,
  children: 1,
  rooms: 1
});
assert.equal(resolved.provider, "stay22", "K: Stay22 remains the hotel affiliate provider");
const stay22 = new URL(resolved.finalUrl);
assert.equal(stay22.searchParams.get("aid"), "stay22-test-partner", "K: Stay22 partner attribution is preserved");
assert.equal(stay22.searchParams.get("checkin"), payload.startDate, "O: check-in context is preserved");
assert.equal(stay22.searchParams.get("checkout"), payload.endDate, "P: check-out context is preserved");
assert.equal(stay22.searchParams.get("guests"), "2", "Q: adult guest context is preserved");
assert.equal(stay22.searchParams.get("rooms"), "1", "R: room context is preserved");
assert.match(stay22.searchParams.get("address") || "", /Hotel A.*Toronto/i, "N: selected hotel search context is preserved");
assert.equal(stay22.searchParams.has("providerPropertyId"), false, "X: Booking Demand property identity is not crossed into Stay22");
assert.equal(stay22.searchParams.has("providerProductId"), false, "Y: Booking Demand product identity is not treated as Stay22 room/rate identity");

const hotelBMarketOnly = {
  ...payload,
  priceDiscovery: {
    ...payload.priceDiscovery,
    marketResults: [{
      id: "hotel-b",
      category: "hotel",
      title: "Hotel B",
      city: "Toronto",
      country: "Canada",
      destination: "Toronto, Canada",
      source: "stay22",
      affiliate_url: "https://www.stay22.com/allez/roam?address=Hotel%20B%2C%20Toronto",
      price_amount: 99,
      currency: "CAD",
      price_type: "live_partner",
      metadata: { retrieval_provider: "provider_api" }
    }]
  }
};
assert.equal(marketResultIsSelectedHotel(hotelBMarketOnly.priceDiscovery.marketResults[0], baseSuggestion), false, "C: Hotel B market facts cannot enrich Hotel A");
assert.equal(marketResultIsSelectedHotel({ id: "hotel-a", category: "hotel" }, baseSuggestion), true, "W: exact Hotel A market identity may enrich Hotel A");

const source = await (await import("node:fs/promises")).readFile(new URL("../lib/roamly/affiliateLinks.ts", import.meta.url), "utf8");
assert.match(source, /category === "hotel" && cleanStringValue\(suggestion\.candidateId\)/, "AX: hotel market enrichment uses exact candidate identity");
assert.doesNotMatch(source, /candidateDecisionCore/, "AI: ranking core is not involved");
assert.doesNotMatch(source, /bookingapi\.booking\.com.*affiliate|BOOKING_DEMAND_AFFILIATE_ID/, "L: no Booking Demand affiliate crossover");

for (const [key, value] of Object.entries(previous)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log("Roamly selected hotel affiliate continuity checks passed.");
