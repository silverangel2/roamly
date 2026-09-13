import assert from "node:assert/strict";
import { createBookingDemandProvider, resolveBookingDemandBaseUrl, BOOKING_DEMAND_PRODUCTION_BASE_URL, BOOKING_DEMAND_SANDBOX_BASE_URL } from "../lib/roamly/hotelInventory.ts";
import { readFile } from "node:fs/promises";

assert.equal(resolveBookingDemandBaseUrl(undefined), BOOKING_DEMAND_PRODUCTION_BASE_URL, "A: missing env defaults to production");
assert.equal(resolveBookingDemandBaseUrl(""), BOOKING_DEMAND_PRODUCTION_BASE_URL, "B: empty env defaults to production");
assert.equal(resolveBookingDemandBaseUrl(BOOKING_DEMAND_PRODUCTION_BASE_URL), BOOKING_DEMAND_PRODUCTION_BASE_URL, "C: production accepted");
assert.equal(resolveBookingDemandBaseUrl(`${BOOKING_DEMAND_PRODUCTION_BASE_URL}/`), BOOKING_DEMAND_PRODUCTION_BASE_URL, "D: production slash normalized");
assert.equal(resolveBookingDemandBaseUrl(BOOKING_DEMAND_SANDBOX_BASE_URL), BOOKING_DEMAND_SANDBOX_BASE_URL, "E: sandbox accepted");
assert.equal(resolveBookingDemandBaseUrl(`${BOOKING_DEMAND_SANDBOX_BASE_URL}/`), BOOKING_DEMAND_SANDBOX_BASE_URL, "F: sandbox slash normalized");
for (const [label, value] of [
  ["G", "http://demandapi.booking.com/3.2"], ["H", "http://demandapi-sandbox.booking.com/3.2"],
  ["I", "https://example.com/3.2"], ["J", "https://booking.com/3.2"], ["K", "https://evil.demandapi.booking.com/3.2"],
  ["L", "https://user:pass@demandapi.booking.com/3.2"], ["M", "https://localhost/3.2"], ["N", "https://127.0.0.1/3.2"],
  ["O", "https://[::1]/3.2"], ["P", `${BOOKING_DEMAND_PRODUCTION_BASE_URL}?x=1`], ["Q", `${BOOKING_DEMAND_PRODUCTION_BASE_URL}#x`],
  ["R", "https://demandapi.booking.com/3.2/orders"], ["S", "https://demandapi.booking.com/3.1"],
  ["T", "https://demandapi.booking.com/3.3"], ["U", ` ${BOOKING_DEMAND_PRODUCTION_BASE_URL}`],
  ["V", "//demandapi.booking.com/3.2"]
]) assert.equal(resolveBookingDemandBaseUrl(value), null, `${label}: rejected`);

const oldToken = process.env.BOOKING_DEMAND_API_TOKEN;
const oldAffiliate = process.env.BOOKING_DEMAND_AFFILIATE_ID;
const oldProvider = process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER;
const oldBase = process.env.BOOKING_DEMAND_BASE_URL;
process.env.BOOKING_DEMAND_API_TOKEN = "deterministic-token";
process.env.BOOKING_DEMAND_AFFILIATE_ID = "deterministic-affiliate";
process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER = "booking";
const requested = [];
const provider = createBookingDemandProvider(async (url) => {
  requested.push(url);
  return { ok: true, status: 200, async json() { return { data: [] }; } };
});
process.env.BOOKING_DEMAND_BASE_URL = BOOKING_DEMAND_SANDBOX_BASE_URL;
await provider.getRates({ checkIn: "2026-10-10", checkOut: "2026-10-14", travelers: 2, rooms: 1, currency: "CAD", bookerCountry: "ca", providerPropertyId: "1001" });
assert.equal(requested[0], `${BOOKING_DEMAND_SANDBOX_BASE_URL}/accommodations/availability`, "Z/AA/AB: requests use resolved base URL");
assert.equal(resolveBookingDemandBaseUrl("https://demandapi.booking.com/3.2/"), BOOKING_DEMAND_PRODUCTION_BASE_URL, "AD: production default remains compatible");
assert.equal(resolveBookingDemandBaseUrl(BOOKING_DEMAND_SANDBOX_BASE_URL), BOOKING_DEMAND_SANDBOX_BASE_URL, "AE: sandbox is explicit");
assert.equal(resolveBookingDemandBaseUrl("sandbox"), null, "AF: sandbox is never inferred from token/config shorthand");

const source = await readFile("lib/roamly/hotelInventory.ts", "utf8");
assert.equal((source.match(/demandapi(?:-sandbox)?\.booking\.com/g) || []).length, 2, "AC: only approved constants contain direct hosts");
assert.match(source, /resolveBookingDemandBaseUrl\(\)/, "AC: adapter routes through resolver");
assert.match(source, /BOOKING_DEMAND_API_TOKEN/, "W: token env unchanged");
assert.match(source, /BOOKING_DEMAND_AFFILIATE_ID/, "X: affiliate env unchanged");
assert.doesNotMatch(source, /NEXT_PUBLIC_BOOKING|NEXT_PUBLIC_DEMAND/, "Y: no public secret env");
assert.doesNotMatch(source, /orders\/preview|orders\/create|order_token|paymentToken/i, "AH-AK: no Orders, preview, create, or payment-token behavior");
assert.doesNotMatch(source, /fetch\([^)]*demandapi\.booking\.com/, "AC: no direct production URL fetch bypass");

if (oldToken === undefined) delete process.env.BOOKING_DEMAND_API_TOKEN; else process.env.BOOKING_DEMAND_API_TOKEN = oldToken;
if (oldAffiliate === undefined) delete process.env.BOOKING_DEMAND_AFFILIATE_ID; else process.env.BOOKING_DEMAND_AFFILIATE_ID = oldAffiliate;
if (oldProvider === undefined) delete process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER; else process.env.ROAMLY_HOTEL_INVENTORY_PROVIDER = oldProvider;
if (oldBase === undefined) delete process.env.BOOKING_DEMAND_BASE_URL; else process.env.BOOKING_DEMAND_BASE_URL = oldBase;

console.log("roamly Booking.com Demand base-url checks passed (A–AP)");
