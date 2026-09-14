import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
function load(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, require(id) { if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`); return require(id); }, URL, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports;
}
const { classifyTripGeography } = load("lib/roamly/tripGeography.ts");
const { decideConnectivity } = load("lib/roamly/connectivityDecision.ts");
const place = (country, currency) => ({ country, currency, label: country, value: country, source: "local" });
const geo = (destinationCountries, scope = destinationCountries.length > 1 ? "MULTI_COUNTRY_INTERNATIONAL" : "INTERNATIONAL") => ({ scope, originCountryCode: "CA", destinationCountryCodes: destinationCountries, transitCountryCodes: [], evidence: [], reasons: [], travelEssentialSignals: {} });
const international = geo(["US"]);
const multi = geo(["FR", "IT"]);
const domestic = classifyTripGeography({ originCountry: "CA", destinationCountry: "CA", originPlace: place("CA", "CAD"), destinationPlace: place("CA", "CAD") });
const base = { tripGeography: international };
const decide = (overrides = {}) => decideConnectivity({ ...base, ...overrides });

assert.equal(decideConnectivity({ tripGeography: domestic }).state, "NOT_NEEDED", "A: domestic trips do not trigger international eSIM need");
assert.equal(decide().state, "INSUFFICIENT_INFORMATION", "B/F: international geography alone requires evaluation but not a purchase conclusion");
assert.equal(decide({ tripGeography: multi }).reasons.includes("MULTI_COUNTRY_COVERAGE_REQUIRED"), true, "C: multi-country coverage requirement is preserved");
assert.equal(decideConnectivity({ tripGeography: geo([] , "UNKNOWN") }).esimSuitability, "UNKNOWN", "D: unknown geography cannot produce a confident eSIM decision");
assert.equal(decide().state === "ESIM_POTENTIALLY_SUITABLE", false, "E: geography alone is not BUY_ESIM");
assert.equal(decide({ currentPlan: { roamingIncluded: "UNKNOWN", dataAllowanceAdequate: "UNKNOWN" } }).state, "INSUFFICIENT_INFORMATION", "F/K: unknown plan coverage remains uncertain");
assert.equal(decide({ currentPlan: { destinationCoverage: "ALL_DESTINATIONS", coveredCountryCodes: ["US"], roamingIncluded: "YES", dataAllowanceAdequate: "YES" } }).state, "CURRENT_PLAN_LIKELY_SUFFICIENT", "G: full factual roaming coverage can be sufficient");
assert.equal(decide({ tripGeography: multi, currentPlan: { coveredCountryCodes: ["FR", "IT"], roamingIncluded: "YES", dataAllowanceAdequate: "YES" } }).state, "CURRENT_PLAN_LIKELY_SUFFICIENT", "H/Z: all actual destination countries are required for full coverage");
assert.equal(decide({ tripGeography: multi, currentPlan: { coveredCountryCodes: ["FR"], roamingIncluded: "YES", dataAllowanceAdequate: "YES" } }).coverageStatus, "PARTIAL", "I/AA: France-only coverage is partial for FR + IT");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" } }).state, "ALTERNATIVE_CONNECTIVITY_WORTH_EVALUATING", "J: no coverage keeps alternatives relevant");
assert.equal(decide({ currentPlan: { destinationCoverage: "UNKNOWN", roamingIncluded: "UNKNOWN", dataAllowanceAdequate: "UNKNOWN" } }).esimSuitability, "UNKNOWN", "K: unknown coverage remains unknown");
assert.equal(decide({ currentPlan: { destinationCoverage: "ALL_DESTINATIONS", roamingIncluded: "YES", dataAllowanceAdequate: "YES" } }).coverageStatus, "UNKNOWN", "Z: all-coverage assertion without country evidence is not sufficient");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "YES", unlocked: "UNKNOWN" } }).esimSuitability, "UNKNOWN", "L/O/P: eSIM support and unlock are separate facts");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "NO", unlocked: "YES" } }).state, "ESIM_NOT_USABLE", "M: unsupported eSIM blocks usability");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "YES", unlocked: "NO" } }).state, "ESIM_NOT_USABLE", "N/O: locked device blocks external eSIM suitability");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "YES", unlocked: "YES" } }).state, "ESIM_POTENTIALLY_SUITABLE", "Q/R: supported and unlocked may be suitable");

const needs = { expectedDataUse: "high", callsNeeded: "YES", smsNeeded: "YES", hotspotNeeded: "YES", continuousConnectivityImportance: "YES" };
const needsResult = decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "YES", unlocked: "YES" }, travelerNeeds: needs, tripDurationDays: 60 });
assert.equal(needsResult.travelerNeeds.callsNeeded, "YES", "S/V: voice requirement preserved");
assert.equal(needsResult.travelerNeeds.smsNeeded, "YES", "T: SMS requirement preserved");
assert.equal(needsResult.travelerNeeds.hotspotNeeded, "YES", "U: hotspot requirement preserved");
assert.equal(needsResult.tripDurationDays, 60, "W/X: trip duration preserved");
assert.ok(needsResult.reasons.includes("VOICE_REQUIRED") && needsResult.reasons.includes("SMS_REQUIRED") && needsResult.reasons.includes("HOTSPOT_REQUIRED"), "requirements receive reason codes");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "YES", unlocked: "YES" } }).commercialProvider, null, "AD/AG: no provider is selected");
assert.equal(decide({ currentPlan: { destinationCoverage: "NONE", roamingIncluded: "NO", dataAllowanceAdequate: "NO" }, device: { esimSupport: "YES", unlocked: "YES" } }).state, "ESIM_POTENTIALLY_SUITABLE", "AE: no Amazon product is needed for the decision");
assert.equal(decide({ currentPlan: { destinationCoverage: "ALL_DESTINATIONS", coveredCountryCodes: ["US"], roamingIncluded: "YES", dataAllowanceAdequate: "YES" }, device: { esimSupport: "YES", unlocked: "YES" } }).state, "CURRENT_PLAN_LIKELY_SUFFICIENT", "full coverage takes precedence over device suitability");

const source = fs.readFileSync(path.join(root, "lib/roamly/connectivityDecision.ts"), "utf8");
assert.match(source, /tripGeography: TripGeography/, "AP: released geography result is consumed");
assert.doesNotMatch(source, /Airalo|Holafly|Nomad|Saily|Amazon|provider.*URL/i, "AE/AG: no commercial provider is introduced");
assert.doesNotMatch(source, /resolveCityPlace|countryHintFromText|userAgent|navigator/, "AM/AP: no text/device inference or duplicate geography");
for (const file of ["lib/roamly/tripGeography.ts", "lib/roamly/amazonAffiliate.ts", "lib/roamly/esim.ts", "lib/roamly/affiliateLinks.ts", "lib/roamly/candidateDecisionCore.ts", "lib/roamly/activityFeasibility.ts", "lib/roamly/publicEventDiscovery.ts"]) assert.ok(fs.existsSync(path.join(root, file)), `unchanged subsystem remains present: ${file}`);
console.log("Roamly connectivity decision checks passed.");
