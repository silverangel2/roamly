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
  const sandbox = { exports: {}, module: { exports: {} }, require, URL, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports;
}
const { classifyTripGeography, normalizeCountryCode } = load("lib/roamly/tripGeography.ts");
const place = (country, currency) => ({ country, currency, label: country, value: country, source: "local" });
const base = { originCountry: "Canada", destinationCountry: "Canada", originPlace: place("Canada", "CAD"), destinationPlace: place("Canada", "CAD") };
const classify = (overrides = {}) => classifyTripGeography({ ...base, ...overrides });

assert.equal(classify().scope, "DOMESTIC", "A: CA -> CA is domestic");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD") }).scope, "INTERNATIONAL", "B: CA -> US is international");
assert.equal(classify({ destinationCountry: "FR", destinationPlace: place("France", "EUR") }).scope, "INTERNATIONAL", "C: CA -> FR is international");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("Italy", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).scope, "MULTI_COUNTRY_INTERNATIONAL", "D: CA -> FR -> IT is multi-country international");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD"), returnToOrigin: true }).scope, "INTERNATIONAL", "E: return to origin does not inflate country count");
assert.equal(classify({ destinationStops: [place("United States", "USD"), place("Mexico", "MXN")], destinationCountry: undefined, destinationPlace: undefined }).scope, "MULTI_COUNTRY_INTERNATIONAL", "F: CA -> US -> MX is multi-country international");
assert.equal(classify({ destinationStops: [place("Canada", "CAD"), place("Canada", "CAD")], destinationCountry: undefined, destinationPlace: undefined }).scope, "DOMESTIC", "G: CA -> CA -> CA is domestic");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("France", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).scope, "INTERNATIONAL", "H: repeated France remains international");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("Italy", "EUR"), place("France", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).scope, "MULTI_COUNTRY_INTERNATIONAL", "I: FR and IT remain multi-country");
assert.equal(classify({ originPlace: place("Canada", "CAD"), destinationStops: [place("Canada", "CAD"), place("Canada", "CAD")], destinationCountry: undefined, destinationPlace: undefined }).scope, "DOMESTIC", "J: Canadian multi-city is domestic");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("France", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).destinationCountryCodes.length, 1, "K: Montreal -> Paris -> Nice has one destination country");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("Italy", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).scope, "MULTI_COUNTRY_INTERNATIONAL", "L: FR + IT is multi-country");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("France", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).destinationCountryCodes.length, 1, "M: repeated country is deduplicated");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD"), returnToOrigin: true }).destinationCountryCodes.length, 1, "N: return-to-origin is not a destination country");
assert.equal(classify({ destinationCountry: "", destinationPlace: { country: undefined, currency: undefined }, destination: "London" }).scope, "UNKNOWN", "O/Q: ambiguous or missing country is unknown");
assert.equal(classify({ originCountry: "", originPlace: { country: undefined, currency: undefined } }).scope, "UNKNOWN", "P: missing origin is unknown");
assert.equal(classify({ destinationCountry: "", destinationPlace: { country: undefined, currency: undefined } }).scope, "UNKNOWN", "Q: missing destination is unknown");
assert.equal(normalizeCountryCode("London"), "", "R: city text cannot become country identity");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD"), confirmedGeography: [{ countryCode: "CA", role: "destination", source: "confirmed_booking" }] }).scope, "DOMESTIC", "S: confirmed geography overrides an earlier recommendation assumption");
assert.equal(classify({ transitCountries: ["US"], destinationCountry: "MX", destinationPlace: place("Mexico", "MXN") }).scope, "INTERNATIONAL", "U/V: transit is separate from destination classification");
assert.equal(classify({ transitCountries: ["US"] }).transitCountryCodes.join(","), "US", "U: transit country is represented separately");
assert.equal(classify({ destinationStops: [{ ...place("United States", "USD"), role: "transit" }, place("Canada", "CAD")], destinationCountry: undefined, destinationPlace: undefined }).scope, "DOMESTIC", "V: transit-only country does not become a destination");
assert.equal(classify({ destinationCountry: "", destinationPlace: { country: undefined, currency: undefined } }).travelEssentialSignals.internationalConnectivity, "UNKNOWN", "W: unknown geography keeps signals unknown");
assert.equal(classify().travelEssentialSignals.internationalConnectivity, "NOT_RELEVANT", "X: domestic connectivity signal is not relevant");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD") }).travelEssentialSignals.internationalConnectivity, "RELEVANT", "Y: international connectivity is relevant");
assert.equal(classify({ destinationStops: [place("France", "EUR"), place("Italy", "EUR")], destinationCountry: undefined, destinationPlace: undefined }).travelEssentialSignals.multiCountryConnectivity, "RELEVANT", "Z: multi-country connectivity is relevant");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD") }).travelEssentialSignals.plugCompatibility, "UNKNOWN", "AE/AF: no adapter claim without dataset");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD") }).travelEssentialSignals.currencyDifference, "DIFFERENT", "AH: structured currency difference is factual");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States") }).travelEssentialSignals.currencyDifference, "UNKNOWN", "AH: missing currency remains unknown");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD"), drivingTrip: true }).travelEssentialSignals.internationalDriving, "RELEVANT", "international driving signal requires explicit driving");
assert.equal(classify({ destinationCountry: "US", destinationPlace: place("United States", "USD") }).travelEssentialSignals.internationalDriving, "UNKNOWN", "driving assumption is not invented");

const source = fs.readFileSync(path.join(root, "lib/roamly/tripGeography.ts"), "utf8");
assert.match(source, /confirmedGeography/, "confirmed geography boundary exists");
assert.doesNotMatch(source, /resolveCityPlace|countryHintFromText|routeText/, "free-text country guessing is not used");
for (const file of ["lib/roamly/amazonAffiliate.ts", "lib/roamly/esim.ts", "lib/roamly/affiliateLinks.ts", "lib/roamly/candidateDecisionCore.ts", "lib/roamly/activityFeasibility.ts"]) {
  assert.ok(fs.existsSync(path.join(root, file)), `unchanged subsystem remains present: ${file}`);
}
console.log("Roamly trip geography checks passed.");
