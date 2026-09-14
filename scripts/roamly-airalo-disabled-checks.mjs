import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const require = createRequire(import.meta.url);
function load(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(id) {
      if (id.startsWith("@/")) {
        const relative = id.slice(2);
        if (/\.json$/i.test(relative)) return { default: require(path.join(root, relative)) };
        return load(`${relative}.ts`);
      }
      return require(id);
    },
    URL,
    process,
    console
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: relativePath });
  return sandbox.module.exports;
}

const esim = await load("lib/roamly/esim.ts");
const resolver = await load("lib/roamly/affiliateResolver.ts");
const geography = await load("lib/roamly/tripGeography.ts");
const connectivity = await load("lib/roamly/connectivityDecision.ts");

const oldEnv = { ...process.env };
try {
  Object.assign(process.env, {
    ROAMLY_ESIM_PROVIDER: "airalo",
    ROAMLY_ESIM_ENABLED: "true",
    ROAMLY_ESIM_REFERRAL_URL: "https://www.airalo.com/esim",
    ROAMLY_ESIM_AFFILIATE_ID: "legacy-id",
    NEXT_PUBLIC_AIRALO_IMPACT_ENABLED: "true"
  });

  const payload = {
    destination: "New York",
    destinationCountry: "US",
    origin: "Canada",
    originCountry: "CA",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    daysCount: 5,
    interests: [],
    priceDiscovery: { cross_border: true }
  };

  assert.equal(esim.getEsimProviderConfig().enabled, false, "legacy Airalo env cannot enable commerce");
  assert.equal(esim.buildAiraloEsimUrl(payload), "", "Airalo URL generation is disabled");
  assert.equal(esim.buildEsimAction(payload), null, "Airalo CTA generation is disabled");

  const resolved = resolver.resolveAffiliateLink({ category: "esim", destination: "New York", origin: "Canada" });
  assert.equal(resolved.finalUrl, "", "resolver cannot return an Airalo URL");
  assert.equal(resolved.configured, false, "Airalo is not considered configured");
  assert.equal(resolved.fallbackBehavior, "hidden", "unapproved eSIM commerce remains hidden");
  assert.notEqual(resolved.provider, "airalo", "resolver does not claim Airalo as provider");

  const domestic = geography.classifyTripGeography({
    originCountry: "CA",
    destinationCountry: "CA",
    originPlace: { country: "CA" },
    destinationPlace: { country: "CA" }
  });
  const international = geography.classifyTripGeography({
    originCountry: "CA",
    destinationCountry: "US",
    originPlace: { country: "CA" },
    destinationPlace: { country: "US" }
  });
  assert.equal(connectivity.decideConnectivity({ tripGeography: domestic }).state, "NOT_NEEDED", "generic domestic connectivity intelligence remains");
  assert.equal(connectivity.decideConnectivity({ tripGeography: international }).reasons.includes("INTERNATIONAL_CONNECTIVITY_RELEVANT"), true, "generic international connectivity intelligence remains");

  const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(source("app/layout.tsx"), /AiraloImpactScript/, "customer layout does not mount Airalo tracking");
  assert.match(source("components/roamly/AiraloImpactScript.tsx"), /return null/, "Impact component is inert");
  assert.doesNotMatch(source("app/trip/[id]/page.tsx"), /airalo\.com/, "trip page does not authorize Airalo hosts");
  assert.doesNotMatch(source("lib/roamly/affiliateRedirect.ts"), /airalo\.com/, "affiliate redirect does not authorize Airalo hosts");
  assert.doesNotMatch(source("lib/roamly/launchReadiness.ts"), /Airalo configured/, "readiness does not report Airalo as configured");
  assert.doesNotMatch(source("lib/roamly/affiliateResolver.ts"), /buildAiraloEsimUrl|getEsimProviderConfig/, "resolver has no Airalo commercial path");
  assert.doesNotMatch(source("lib/roamly/amazonAffiliate.ts"), /provider:\s*["']Airalo["']|affiliate_provider:\s*["']Airalo["']/, "Amazon layer does not substitute Airalo");

  for (const provider of ["Travelpayouts", "Stay22", "Klook", "Amazon"]) {
    assert.match(source("lib/roamly/affiliateResolver.ts"), new RegExp(provider, "i"), `${provider} remains represented`);
  }
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in oldEnv)) delete process.env[key];
  }
  Object.assign(process.env, oldEnv);
}

console.log("roamly-airalo-disabled-checks: PASS");
