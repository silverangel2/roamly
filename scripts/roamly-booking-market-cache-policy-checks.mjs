import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isTravelMarketResultCacheable } from "../lib/roamly/travelMarketCachePolicy.ts";

assert.equal(isTravelMarketResultCacheable({ source: "booking_demand" }), false, "Booking Demand prices/availability must never be cached");
assert.equal(isTravelMarketResultCacheable({ source: "travelpayouts" }), true, "other providers retain their existing cache behavior");
assert.equal(isTravelMarketResultCacheable({ source: "roamly_internal" }), true, "internal search results retain their existing cache behavior");

const source = await readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260929000300_roamly_market_prices_trust_boundary.sql", import.meta.url), "utf8");
const cacheReader = source.slice(source.indexOf("async function cachedResults("), source.indexOf("async function storeResults("));
const cacheWriter = source.slice(source.indexOf("async function storeResults("), source.indexOf("function marketEnabled("));
assert.match(cacheReader, /\.filter\(isTravelMarketResultCacheable\)/, "legacy persisted Booking offers are excluded from reads");
assert.match(cacheWriter, /results\.filter\(isTravelMarketResultCacheable\)/, "new Booking offers are excluded from writes");
assert.match(cacheWriter, /if \(!supabase \|\| !cacheableResults\.length\) return/, "an all-Booking result set causes no database write");
assert.match(source, /createSupabaseAdminClient/, "market cache writer uses the existing service-role helper");
assert.match(source, /import "server-only";/, "market search module is server-only");
assert.match(cacheWriter, /const trustedWriter = createSupabaseAdminClient\(\)/, "cache persistence obtains a trusted writer");
assert.match(cacheWriter, /trustedWriter\.from\("roamly_market_prices"\)\.insert/, "cache persistence writes through service role");
assert.doesNotMatch(cacheWriter, /supabase\.from\("roamly_market_prices"\)\.(insert|update|delete)/, "authenticated caller cannot be used as cache writer");
assert.doesNotMatch(cacheWriter, /createSupabaseAdminClient\(\)\s*\|\|\s*supabase/, "no authenticated-write fallback exists");
assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|createBrowserClient/, "service-role credentials and browser client construction are absent from the search module");

assert.match(migration, /delete\s+from\s+public\.roamly_market_prices\s*;/i, "pre-repair cache is deterministically invalidated");
assert.match(migration, /revoke\s+all\s+privileges\s+on\s+table\s+public\.roamly_market_prices\s+from\s+public,\s*anon\s*;/i, "PUBLIC and anon table privileges are revoked");
assert.match(migration, /revoke\s+all\s+privileges\s+on\s+table\s+public\.roamly_market_prices\s+from\s+authenticated\s*;/i, "authenticated table privileges are reset");
assert.match(migration, /grant\s+select\s+on\s+table\s+public\.roamly_market_prices\s+to\s+authenticated\s*;/i, "authenticated SELECT is retained");
assert.match(migration, /grant\s+all\s+privileges\s+on\s+table\s+public\.roamly_market_prices\s+to\s+service_role\s*;/i, "service_role trusted access is retained");
assert.match(migration, /drop\s+policy\s+if\s+exists\s+"Roamly authenticated users insert market prices"/i, "authenticated INSERT policy is removed");
assert.match(migration, /drop\s+policy\s+if\s+exists\s+"Roamly authenticated users update market prices"/i, "authenticated UPDATE policy is removed");
assert.doesNotMatch(migration, /create\s+policy[^;]+\bfor\s+(insert|update|delete)\b/i, "no authenticated write policy is recreated");

console.log("Market-price cache trust-boundary checks passed");
