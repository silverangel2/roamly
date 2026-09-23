import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isTravelMarketResultCacheable } from "../lib/roamly/travelMarketCachePolicy.ts";

assert.equal(isTravelMarketResultCacheable({ source: "booking_demand" }), false, "Booking Demand prices/availability must never be cached");
assert.equal(isTravelMarketResultCacheable({ source: "travelpayouts" }), true, "other providers retain their existing cache behavior");
assert.equal(isTravelMarketResultCacheable({ source: "roamly_internal" }), true, "internal search results retain their existing cache behavior");

const source = await readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8");
const cacheReader = source.slice(source.indexOf("async function cachedResults("), source.indexOf("async function storeResults("));
const cacheWriter = source.slice(source.indexOf("async function storeResults("), source.indexOf("function marketEnabled("));
assert.match(cacheReader, /\.filter\(isTravelMarketResultCacheable\)/, "legacy persisted Booking offers are excluded from reads");
assert.match(cacheWriter, /results\.filter\(isTravelMarketResultCacheable\)/, "new Booking offers are excluded from writes");
assert.match(cacheWriter, /if \(!supabase \|\| !cacheableResults\.length\) return/, "an all-Booking result set causes no database write");

console.log("Booking Demand live-price cache policy checks passed");
