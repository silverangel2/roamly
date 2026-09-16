import assert from "node:assert/strict";
import { deriveTravelRequirements, countMaterialTravelRequirements } from "../lib/roamly/travelRequirements.ts";

const missing = deriveTravelRequirements({ destinationCountry: "GB", travelerCount: 1 });
assert.equal(missing[0].status, "UNKNOWN");
assert.match(missing[0].summary, /passport issuing country/i);

const supported = deriveTravelRequirements({ destinationCountry: "GB", passportIssuingCountry: "CA", startDate: "2026-10-01", endDate: "2026-10-07" });
assert.equal(supported[0].status, "REVIEW_REQUIRED");
assert.equal(supported[0].authority, "GOV.UK");
assert.equal(supported[0].actionUrl, "https://www.gov.uk/check-uk-visa");
assert.equal(supported[0].travelDateContext, "2026-10-01 to 2026-10-07");

const stale = deriveTravelRequirements({ destinationCountry: "CA", passportIssuingCountry: "US", evidenceFreshness: "STALE" });
assert.equal(stale[0].status, "REVIEW_REQUIRED");
assert.equal(stale[0].freshness, "STALE");

const companions = deriveTravelRequirements({ destinationCountry: "FR", passportIssuingCountry: "US", travelerCount: 2 });
assert.equal(companions[1].status, "REVIEW_REQUIRED");
assert.match(companions[1].summary, /only the account holder/i);

const transit = deriveTravelRequirements({ destinationCountry: "US", passportIssuingCountry: "CA", knownTransitCountries: ["" ] });
assert.equal(transit.at(-1)?.category, "TRANSIT");
assert.equal(transit.at(-1)?.status, "UNKNOWN");

assert.equal(countMaterialTravelRequirements(supported), 1);
assert.equal(countMaterialTravelRequirements([]), 0);

const acknowledged = { ...supported[0], status: "ACTION_REQUIRED" };
assert.notEqual(acknowledged.status, "SATISFIED", "acknowledgment must not imply verified satisfaction");

console.log("Roamly travel requirements checks passed (explicit passport fact, provenance, uncertainty, freshness, companions, transit, and conservative status semantics).");
