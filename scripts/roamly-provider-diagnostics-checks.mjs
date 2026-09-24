import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/roamly/providers/adapters.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/admin/roamly/system/route.ts", import.meta.url), "utf8");

for (const field of ["commercial_routing", "authoritative_inventory", "authorization", "live_reachability"]) {
  assert.match(source, new RegExp(field), `${field} must be explicit in provider diagnostics`);
}
assert.match(source, /TRAVELPAYOUTS_API_TOKEN/, "flight inventory configuration must be separate from the affiliate marker");
assert.match(source, /BOOKING_DEMAND_API_TOKEN/, "hotel inventory configuration must be separate from Stay22 routing");
assert.match(source, /KLOOK_API_KEY/, "activity inventory configuration must be separate from Klook referral routing");
assert.match(source, /authoritative_inventory: inventory/, "diagnostics must expose inventory truth separately");
assert.match(source, /authorization: liveConfigured \? "unverified"/, "credentials must not imply authorization");
assert.match(source, /live_reachability: liveConfigured \? "unverified"/, "credentials must not imply reachability");
assert.match(source, /commercial_routing: commercial/, "commercial routing must remain independently available");
assert.match(source, /status: inventoryDomain/, "inventory-domain diagnostics must not report affiliate-only configuration as fully available");
assert.match(route, /providers: providerDiagnostics\(\)/, "admin system diagnostics must expose the separated provider dimensions");
console.log("Roamly provider diagnostics checks passed.");
