import assert from "node:assert/strict";
import fs from "node:fs";
import { deriveTravelRequirements } from "../lib/roamly/travelRequirements.ts";

const root = new URL("..", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const travelerModule = read("lib/roamly/tripTravelers.ts");
const route = read("app/api/trips/[id]/travelers/route.ts");
const component = read("components/trip/TripTravelerRequirements.tsx");
const migration = read("supabase/migrations/20260917_roamly_trip_travelers.sql");

const accountOnly = deriveTravelRequirements({ destinationCountry: "GB", passportIssuingCountry: "CA", travelerCount: 1, evidenceFreshness: "CURRENT" });
const companionUnknown = deriveTravelRequirements({ destinationCountry: "GB", passportIssuingCountry: null, travelerCount: 1 });
assert.equal(accountOnly.some((item) => item.id.startsWith("companions-")), false);
assert.equal(companionUnknown[0].status, "UNKNOWN");
assert.equal(companionUnknown[0].acknowledgmentDoesNotVerify, true);

assert.match(travelerModule, /traveler_profiles|accountHolderPassportCountry/);
assert.match(travelerModule, /deriveTravelRequirements/);
assert.match(travelerModule, /role: "companion"/);
assert.match(travelerModule, /passport_issuing_country: null/);
assert.match(travelerModule, /traveler_order/);
assert.match(travelerModule, /traveler_type/);
assert.doesNotMatch(travelerModule, /accountHolderPassportCountry[^\n]*insert/);
assert.match(route, /requireUser\(\)/);
assert.match(route, /eq\("id", id\)\s*\n\s*\.eq\("user_id", auth\.user\.id\)/);
assert.match(route, /eq\("trip_id", id\)/);
assert.match(route, /INVALID_TRAVELER_ID/);
assert.match(route, /INVALID_PASSPORT_COUNTRY/);
assert.match(route, /TRAVELER_SLOT_STALE/);
assert.match(component, /Add traveler details/);
assert.match(component, /Add your passport country/);
assert.match(component, /does not prove visa approval or entry clearance/);
assert.match(migration, /references public\.roamly_trips\(id\)\s*\n\s*on delete cascade/);
assert.match(migration, /revoke insert, update, delete on table public\.roamly_trip_travelers from authenticated/);
assert.doesNotMatch(migration, /passport_number|passport_scan|passport_expiry|date_of_birth|biometric|visa_document/i);

console.log("Roamly multi-traveler requirements checks passed.");
