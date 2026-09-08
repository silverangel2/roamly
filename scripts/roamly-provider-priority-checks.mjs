import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
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

process.env.ROAMLY_AFFILIATES_ENABLED = "true";
process.env.ROAMLY_STAY22_PARTNER_ID = "test-stay22";
process.env.ROAMLY_TRAVELPAYOUTS_MARKER = "test-travelpayouts";
process.env.ROAMLY_KLOOK_PARTNER_ID = "test-klook";

const resolver = loadTsModule("lib/roamly/affiliateResolver.ts");
const neutrality = loadTsModule("lib/roamly/affiliateNeutrality.ts");
const links = loadTsModule("lib/roamly/bookingLinks.ts");

const hotel = resolver.resolveAffiliateLink({ category: "hotel", destination: "Montreal, Canada", title: "Hotel Bonaventure" });
assert.equal(hotel.provider, "stay22");
assert.equal(hotel.fallbackBehavior, "affiliate");
assert.match(hotel.finalUrl, /stay22\.com/);
assert.equal(hotel.disclosureRequired, true);

const flight = resolver.resolveAffiliateLink({
  category: "flight",
  origin: "Saint John, Canada",
  destination: "Montreal, Canada",
  startDate: "2026-10-01",
  endDate: "2026-10-05"
});
assert.equal(flight.provider, "travelpayouts");
assert.equal(flight.fallbackBehavior, "affiliate");
assert.match(flight.finalUrl, /aviasales\.com/);
assert.equal(flight.disclosureRequired, true);

const klookWithoutProduct = resolver.resolveAffiliateLink({ category: "activity", destination: "Montreal, Canada", title: "Montreal Jazz Festival" });
assert.equal(klookWithoutProduct.finalUrl, "", "Klook must not fabricate a product URL without a matched result");
assert.equal(klookWithoutProduct.fallbackBehavior, "hidden");

const bestFit = neutrality.rankAffiliateNeutralOptions([
  { id: "affiliate", customerScore: 80, affiliateAvailable: true },
  { id: "better-fit", customerScore: 81, affiliateAvailable: false }
]);
assert.equal(bestFit[0].id, "better-fit", "affiliate availability cannot override traveler fit");
const closeFit = neutrality.rankAffiliateNeutralOptions([
  { id: "affiliate", customerScore: 80, affiliateAvailable: true },
  { id: "better-fit", customerScore: 80.5, affiliateAvailable: false }
]);
assert.equal(closeFit[0].id, "better-fit", "affiliate availability cannot break a customer-score tie");

assert.match(links.buildAttractionTicketSearchUrl({ attractionName: "Montreal Jazz Festival", destination: "Montreal, Canada" }), /google\.com\/search/);

const contract = read("lib/roamly/generationLanguage.ts");
for (const phrase of [
  "Confirmed bookings are fixed anchors",
  "Explicit traveler must-do events",
  "Generic recommendations fill only the remaining time",
  "Affiliate relationships, payout, or provider availability must never override traveler intent"
]) assert.match(contract, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

for (const file of [
  "lib/ai/roamly-itinerary.ts",
  "lib/roamly/stagedItineraryGeneration.ts",
  "lib/roamly/brain/dailyItineraryStage.ts"
]) {
  const source = read(file);
  assert.match(source, /ROAMLY_TRAVELER_PRIORITY_CONTRACT/);
}
assert.match(read("lib/roamly/stagedItineraryGeneration.ts"), /Traveler anchors|Traveler must-do events/);
assert.match(read("lib/roamly/itineraryIntelligence.ts"), /function isTravelerAnchor/);
assert.match(read("lib/roamly/itineraryIntelligence.ts"), /capPrimaryItems\(mergeShortTransfersIntoFollowingActivity\(identityFixed\), payload\)/);
assert.match(read("lib/roamly/affiliateLinks.ts"), /Check availability/);
assert.match(read("lib/roamly/affiliateLinks.ts"), /Search for tickets/);
assert.match(read("lib/roamly/itineraryIntelligence.ts"), /View on Klook/);

console.log("Roamly provider and traveler-priority checks passed");
