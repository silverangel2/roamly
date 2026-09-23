import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMarketSearchRequest } from "../lib/roamly/marketSearchRequest.ts";

const hotel = parseMarketSearchRequest({
  category: "hotel", destination: "Lisbon", country: "Portugal", start_date: "2026-10-10", end_date: "2026-10-13",
  travelers: 999, rooms: 99, currency: "eur", maximum_nightly_price: "220", hotel_preferences: "quiet, walkable"
});
assert.equal(hotel?.travelers, 20, "traveler count is bounded");
assert.equal(hotel?.rooms, 10, "room count is bounded");
assert.equal(hotel?.currency, "EUR");
assert.equal(hotel?.maximum_nightly_price, 220, "hotel budget filters are parsed as a bounded nightly amount");
assert.equal(hotel?.hotel_preferences, "quiet, walkable", "hotel preference text is preserved for relevance ranking");
assert.equal(parseMarketSearchRequest({ category: "hotel", destination: "Lisbon", country: "Portugal", start_date: "2026-02-30", end_date: "2026-03-02" }), null, "impossible dates are rejected");
assert.equal(parseMarketSearchRequest({ category: "hotel", destination: "Lisbon", country: "Portugal", start_date: "2026-10-13", end_date: "2026-10-10" }), null, "checkout before check-in is rejected");
assert.equal(parseMarketSearchRequest({ category: "flight", destination: "Lisbon" }), null, "flight searches require an origin and departure date");
assert.equal(parseMarketSearchRequest({ category: "attraction", destination: "Lisbon" }), null, "activity searches require an activity query");
assert.equal(parseMarketSearchRequest({ category: "hotel", destination: "Lisbon", country: "Portugal", start_date: "2026-10-10", end_date: "2026-10-11", currency: "US DOLLARS" }), null, "currency must be an ISO currency code");
assert.equal(parseMarketSearchRequest({ category: "attraction", destination: "L".repeat(500), title: "Food tour" })?.destination.length, 100, "provider-bound search fields are capped");

const route = await readFile(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8");
assert.match(route, /MAX_REQUEST_BYTES = 16_384/);
assert.match(route, /new TextEncoder\(\)\.encode\(rawBody\)\.byteLength/);
assert.match(route, /parseMarketSearchRequest\(body\)/);
console.log("Roamly market search request validation checks passed.");
