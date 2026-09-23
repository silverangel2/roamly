import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { consumeMarketSearchQuota } from "../lib/roamly/marketSearchQuota.ts";

const mock = (result) => ({ rpc: async (name) => {
  assert.equal(name, "roamly_consume_market_search_quota");
  return result;
} });

assert.deepEqual(await consumeMarketSearchQuota(mock({ data: [{ allowed: true, minute_remaining: 11, day_remaining: 119 }], error: null })), {
  ok: true, allowed: true, minuteRemaining: 11, dayRemaining: 119
});
assert.deepEqual(await consumeMarketSearchQuota(mock({ data: [{ allowed: false, retry_after_seconds: 3600 }], error: null })), {
  ok: true, allowed: false, retryAfterSeconds: 3600
});
assert.deepEqual(await consumeMarketSearchQuota(mock({ data: null, error: new Error("missing migration") })), { ok: false }, "missing quota storage fails closed");
assert.deepEqual(await consumeMarketSearchQuota(mock({ data: [{ allowed: true }], error: null })), { ok: false }, "malformed RPC responses fail closed");

const [migration, route] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260928_roamly_market_search_rate_limits.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8")
]);
assert.match(migration, /auth\.uid\(\)/, "identity must be derived server-side");
assert.match(migration, /minute_count > 12/);
assert.match(migration, /day_count > 120/);
assert.match(migration, /on conflict \(user_id, bucket\) do update/i, "quota increments must be atomic across concurrent server instances");
assert.match(migration, /enable row level security/i);
assert.match(migration, /grant execute on function public\.roamly_consume_market_search_quota\(\) to authenticated/i);
assert.match(route, /status: 429/);
assert.match(route, /"Retry-After"/);
assert.match(route, /status: 503/);
assert.equal((route.match(/consumeMarketSearchQuota\(auth\.supabase\)/g) || []).length, 2, "both standalone and trip-linked searches are limited");
console.log("Roamly market search quota checks passed.");
