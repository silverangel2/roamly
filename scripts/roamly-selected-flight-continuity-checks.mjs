import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  marketResultIsSelectedFlight,
  isTrustedTravelpayoutsDeepLink,
  resolveSelectedFlightIdentity,
  selectedFlightContinuityLevel
} from "../lib/roamly/selectedFlightIdentity.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flightA = {
  candidateId: "flight-a",
  category: "flight",
  source: "Travelpayouts",
  sourceType: "provider_api",
  providerOfferId: "offer-a",
  airline: "Air Canada",
  flightNumbers: ["AC101"],
  originAirport: "YFC",
  destinationAirport: "YUL",
  departureAt: "2026-10-01T08:00:00Z",
  arrivalAt: "2026-10-01T09:30:00Z",
  deepLink: "https://www.aviasales.com/search/YFC0110YUL0310"
};
const flightB = { ...flightA, candidateId: "flight-b", providerOfferId: "offer-b", flightNumbers: ["AC202"] };

const identity = resolveSelectedFlightIdentity({ selectedFlightCandidateId: "flight-a", candidates: [flightA, flightB] });
assert.equal(identity?.candidateId, "flight-a");
assert.equal(identity?.providerOfferId, "offer-a");
assert.equal(identity?.flightNumbers[0], "AC101");
assert.equal(selectedFlightContinuityLevel(identity), 1);
assert.equal(resolveSelectedFlightIdentity({ selectedFlightCandidateId: "missing", candidates: [flightA, flightB] }), null);
assert.equal(resolveSelectedFlightIdentity({ selectedFlightCandidateId: "flight-a", candidates: [flightA, { ...flightA }] }), null);
assert.equal(marketResultIsSelectedFlight({ id: "flight-a", category: "flight" }, identity), true);
assert.equal(marketResultIsSelectedFlight({ id: "flight-b", category: "flight" }, identity), false);
assert.equal(marketResultIsSelectedFlight({ id: "flight-a", category: "hotel" }, identity), false);

assert.equal(resolveSelectedFlightIdentity({ selectedFlightCandidateId: "flight-a", candidates: [{ ...flightA, source: "AI Travelpayouts", sourceType: "discovery" }] })?.sourceType, "discovery");
assert.equal(isTrustedTravelpayoutsDeepLink(flightA.deepLink), true);
assert.equal(isTrustedTravelpayoutsDeepLink("https://evil.example/flight-a"), false);
assert.equal(isTrustedTravelpayoutsDeepLink("http://aviasales.com/search/flight-a"), false);
assert.equal(selectedFlightContinuityLevel(null), 0);

const affiliateLinks = source("lib/roamly/affiliateLinks.ts");
const page = source("app/trip/[id]/page.tsx");
assert.match(affiliateLinks, /resolveSelectedFlightIdentity/);
assert.match(affiliateLinks, /marketResultIsSelectedFlight/);
assert.match(affiliateLinks, /selectedFlightContinuityLevel/);
assert.match(affiliateLinks, /ROAMLY_TRAVELPAYOUTS_MARKER/);
assert.doesNotMatch(affiliateLinks, /candidateDecisionCore|orders\/preview|orders\/create/i);
assert.doesNotMatch(page, /selectedFlightIdentity|providerOfferId|flightNumbers/);
assert.doesNotMatch(source("lib/roamly/selectedFlightIdentity.ts"), /fetch\(|supabase|Booking\.com|Stay22|Klook|Amazon/i);
console.log("Roamly selected-flight continuity checks passed");
