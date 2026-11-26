// Deals > Stays shows internal config text to guests (2026-11-25 QA,
// bug 9): "Partner link is configured; live price API credentials are
// optional and not configured. Verify price and availability before
// booking."
//
// The mechanism (lib/roamly/travelMarketSearch.ts): searchTravelMarket
// builds a `warning` string and the market-search route passes it
// through to the client (app/api/roamly/market-search/route.ts), where
// FindsTabs renders body.warning verbatim whenever a search comes back
// with no cards — stays (searchHotels fallback when stays.length === 0)
// and flights/activities/transport (searchPartner fallback). The
// middle branch fires for hotels today: the Stay22 partner link IS
// configured, but the live hotel-price credentials (Booking Demand)
// are not. The third branch ("Provider credentials are not
// configured.") is the same class of leak for the nothing-configured
// case.
//
// The fix (wording only): both config-leaking branches now return one
// guest-safe line — "Live prices are not available for this search.
// Verify price and availability before booking." The first branch
// ("Provider did not return a numeric live price…") was already
// guest-safe and is unchanged. Nothing about the fares themselves
// changes: live hotel fares are still blocked by the separate
// gateway-reachability job (the app container cannot reach its
// Supabase gateway at the Tailscale IP from inside WSL), so do NOT
// call bug 9 "fixed" as fares flowing — only the leaked text is
// fixed.
//
// Run BEFORE the fix this script FAILS (the internal strings are
// present). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const search = fs.readFileSync(path.join(root, "lib/roamly/travelMarketSearch.ts"), "utf8");

// No internal config language reaches the warning string.
assert.ok(!search.includes("live price API credentials"), "no mention of live price API credentials remains");
assert.ok(!search.includes("Provider credentials are not configured"), "no mention of unconfigured provider credentials remains");
assert.ok(!search.includes("Partner link is configured"), "no mention of the partner link configuration remains");

// The guest-safe line is what both unconfigured branches return.
assert.ok(
  search.includes("Live prices are not available for this search. Verify price and availability before booking."),
  "the guest-safe warning is present"
);

// The already-guest-safe branch is unchanged.
assert.ok(
  search.includes("Provider did not return a numeric live price. Verify the search result before booking."),
  "the live-configured-but-no-price branch is unchanged"
);

// The client still falls back to body.warning — no client change was
// needed, because the server now sends a guest-safe line.
const finds = fs.readFileSync(path.join(root, "components/roamly/FindsTabs.tsx"), "utf8");
assert.ok(finds.includes("body.warning"), "FindsTabs still renders the server warning (now guest-safe)");

console.log("Guest-safe market warning checks: PASS");
