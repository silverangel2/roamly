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
const redirect = loadTsModule("lib/roamly/affiliateRedirect.ts");
const { marketResultIsSelectedActivity } = links;
const { safeAffiliateRedirectUrl } = redirect;

const activityA = {
  category: "attraction",
  booking_category: "attraction",
  candidateId: "klook-result-a",
  title: "Activity A",
  destination: "Tokyo, Japan"
};
const activityB = {
  id: "klook-result-b",
  category: "attraction",
  title: "Activity B",
  source: "klook",
  affiliate_url: "https://www.klook.com/activity/123"
};
const publicWebActivity = {
  category: "attraction",
  booking_category: "attraction",
  candidateId: "public-event-a",
  title: "Montreal Saturday Night Festival",
  source: "public_web",
  date: "2026-10-17",
  location_name: "Montreal, Canada"
};

assert.equal(marketResultIsSelectedActivity(activityB, activityA), false, "C: Activity B cannot donate its Klook action to Activity A");
assert.equal(marketResultIsSelectedActivity({ ...activityB, id: "klook-result-a" }, activityA), true, "A: exact Klook result identity resolves Activity A");
assert.equal(marketResultIsSelectedActivity({ ...activityB, id: "klook-result-a", title: "Different title" }, activityA), true, "D: title similarity is not used as identity");
assert.equal(marketResultIsSelectedActivity({ ...activityB, id: "klook-result-a", category: "tour" }, activityA), false, "E: category mismatch cannot substitute");
assert.equal(marketResultIsSelectedActivity({ ...activityB, id: "klook-result-a", destination: "Osaka, Japan" }, activityA), true, "F: destination is not a substitute for exact result identity");
assert.equal(marketResultIsSelectedActivity({ ...activityB, id: "klook-result-a", price_amount: 1 }, activityA), true, "lower price cannot change exact activity identity");
assert.equal(marketResultIsSelectedActivity({ id: "klook-result-a", category: "attraction" }, { ...activityA, candidateId: undefined }), false, "B: unknown activity identity fails conservatively");
assert.equal(marketResultIsSelectedActivity(activityB, publicWebActivity), false, "AE: Klook Activity B cannot replace a public-web Activity A");
assert.equal(publicWebActivity.source, "public_web", "public-web activity provenance remains intact");
assert.equal(publicWebActivity.title, "Montreal Saturday Night Festival", "public-web activity title remains intact");
assert.equal(publicWebActivity.date, "2026-10-17", "public-web activity date remains intact");
assert.equal(publicWebActivity.location_name, "Montreal, Canada", "public-web activity location remains intact");

assert.equal(safeAffiliateRedirectUrl("https://www.klook.com/activity/123"), "https://www.klook.com/activity/123", "G: structured Klook traveler URL is accepted");
assert.equal(safeAffiliateRedirectUrl("https://klook.com.attacker.example/activity/123"), "", "J: Klook lookalike host is rejected");
assert.equal(safeAffiliateRedirectUrl("https://evil.example/activity/123"), "", "I: arbitrary host is rejected");
assert.equal(safeAffiliateRedirectUrl("https://www.klook.com@evil.example/activity/123"), "", "K: userinfo redirect is rejected");

const affiliateLinks = fs.readFileSync(path.join(root, "lib/roamly/affiliateLinks.ts"), "utf8");
const intelligence = fs.readFileSync(path.join(root, "lib/roamly/itineraryIntelligence.ts"), "utf8");
assert.match(affiliateLinks, /marketResultIsSelectedActivity/, "O: Klook enrichment uses the exact activity-result guard");
assert.match(affiliateLinks, /if \(!cleanStringValue\(suggestion\.candidateId\)\) return null/, "W: ungrounded activities do not receive fallback Klook market actions");
assert.match(intelligence, /candidateId: result\.id/, "Q: normalized activity suggestions retain the market result identity");
assert.match(intelligence, /market_source: result\.source/, "public-web and Klook provenance remain separate");
assert.match(intelligence, /date: result\.start_date/, "activity date remains factual source data");
assert.match(affiliateLinks, /source === "klook" && verifiedPartnerMarketResult/, "G: only verified Klook market results can provide actions");
assert.match(affiliateLinks, /\.\.\.suggestion,/, "ungrounded/public activities remain present during enrichment");
assert.doesNotMatch(affiliateLinks, /filter\(.*activity.*klook/i, "absence of Klook identity does not delete activities");
assert.doesNotMatch(affiliateLinks, /candidateDecisionCore/, "AO: ranking core is untouched");
assert.doesNotMatch(affiliateLinks, /BOOKING_DEMAND_AFFILIATE_ID|bookingapi\.booking\.com.*affiliate/, "AT: no Booking Demand affiliate crossover");
assert.doesNotMatch(affiliateLinks, /orders\/(?:preview|create)|payment[_ -]?token|checkout[_ -]?ready/i, "AV-AZ: no Orders/payment/checkout semantics added");

console.log("Roamly Klook activity continuity checks passed.");
