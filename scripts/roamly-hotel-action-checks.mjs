import assert from "node:assert/strict";
import fs from "node:fs";
import { refreshedHotelTruthChanged } from "../lib/roamly/hotelActionPolicy.ts";

const page = fs.readFileSync("app/trip/[id]/page.tsx", "utf8");
const route = fs.readFileSync("app/api/trips/[id]/hotel-action/route.ts", "utf8");
const client = fs.readFileSync("components/trip/GuardedHotelActionButton.tsx", "utf8");
const refresh = fs.readFileSync("lib/roamly/marketPriceRefresh.ts", "utf8");

assert.match(page, /GuardedHotelActionButton/);
assert.match(page, /suggestion\.provider_action_origin === "provider_response"/);
assert.match(client, /\/api\/trips\/\$\{encodeURIComponent\(tripId\)\}\/hotel-action/);
assert.match(client, /body: "\{\}"/);
assert.doesNotMatch(client, /url\s*:/);
assert.match(route, /requireUser\(\)/);
assert.match(route, /getTripBundle\(auth\.supabase, auth\.user\.id, id\)/);
assert.match(route, /loadSelectedHotelActionContext/);
assert.match(route, /selectedHotelForRevalidation: stale/);
assert.match(route, /refreshTripMarketPricesForTrip/);
assert.match(route, /providerUrl\(result\.booking_url\)/);
assert.match(route, /action: "review"/);
assert.match(route, /refreshedHotelTruthChanged/);
assert.doesNotMatch(route, /searchTravelMarket\(/);
assert.match(refresh, /selectedId = getString\(decision\.selectedHotelCandidateId\)/);
assert.match(refresh, /getString\(row\.candidateId\) === selectedId/);
assert.match(refresh, /hotelCandidateIsFresh/);
assert.match(refresh, /source !== "booking_demand"/);

assert.equal(refreshedHotelTruthChanged({ oldPrice: 610, newPrice: 610, oldCurrency: "CAD", newCurrency: "CAD" }), false);
assert.equal(refreshedHotelTruthChanged({ oldPrice: 610, newPrice: 690, oldCurrency: "CAD", newCurrency: "CAD" }), true);
assert.equal(refreshedHotelTruthChanged({ oldPrice: 610, newPrice: null, oldCurrency: "CAD", newCurrency: "CAD" }), true);
assert.equal(refreshedHotelTruthChanged({ oldPrice: null, newPrice: null, oldCurrency: "CAD", newCurrency: "CAD" }), true);
assert.equal(refreshedHotelTruthChanged({ oldPrice: 610, newPrice: 610, oldCurrency: "CAD", newCurrency: "USD" }), true);
assert.equal(refreshedHotelTruthChanged({ oldPrice: 610, newPrice: 610, oldCurrency: "CAD", newCurrency: "CAD", oldTaxesIncluded: true, newTaxesIncluded: false }), true);

console.log("roamly hotel action boundary checks passed");
