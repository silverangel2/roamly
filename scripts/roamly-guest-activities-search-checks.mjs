// Deals Things to do "Explore experiences" does nothing for a guest
// (2026-11-25 QA, bug 4). Tokyo + "Food tour" on /finds: no results, no
// sign-in prompt, no error — only the caption "Sign in to search current
// fares and experiences."
//
// The mechanism (proven by live curl, guest, no auth): POST
// /api/roamly/market-search with category "attraction" returns HTTP 401
// AUTH_REQUIRED. The route's public path — no trip_id, IP-hash public
// quota, no sign-in — covers only "flight" and "hotel"
// (app/api/roamly/market-search/route.ts). Every other category falls
// through to requireUser(). The client (`searchPartner` in FindsTabs)
// turns the 401 into that caption, so the button looks dead.
//
// Junel's decision (2026-11-25 16:36 AST, options widget): guests can
// search stays and activities without signing in. The fix opens the
// public path to "attraction" — same IP-hash quota, same `store: false`
// (nothing is written to the cache), no trip or account data exposed,
// exactly as flight/hotel already run. Transport stays sign-in-only:
// Junel's decision named stays and activities only.
//
// What a guest gets after this: if Klook's live API is configured, real
// Klook activities with prices and photos (mapped by klookFindCard). If
// it is not, the API returns a search-ready result (a Google search
// link), which the client correctly refuses to show as a card — the
// button then shows a message instead of the wrong sign-in caption.
// The live cache proves Klook has never returned a real activity: all
// 82 cached attraction rows are source google_search / price_type
// search_ready, zero live_partner. So after deploy, verify live with a
// guest curl for the QA's exact case (Tokyo, "Food tour") and report
// which of the two the guest actually sees; if it is the search-ready
// case, the next step is the Klook credentials, not a card.
//
// Run BEFORE the fix this script FAILS (attraction is not a public
// category). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const route = fs.readFileSync(path.join(root, "app/api/roamly/market-search/route.ts"), "utf8");

// 1. The public path covers attraction as well as flight and hotel.
const publicBlock = route.match(
  /Ordinary logged-out Finds flight, hotel and attraction discovery[\s\S]*?if \(marketRequest\.category === "flight" \|\| marketRequest\.category === "hotel"([^)]*)\)/
);
assert.ok(publicBlock, "the public-category condition exists");
assert.ok(
  /"attraction"/.test(publicBlock[0]),
  "attraction is a public category for logged-out Finds search"
);

// 2. The public branch runs BEFORE any sign-in check: a guest attraction
// search reaches the IP-hash quota and searchTravelMarket without
// requireUser() standing in front of it.
const publicIndex = route.indexOf('marketRequest.category === "flight"');
const requireUserIndex = route.indexOf("const auth = await requireUser();", publicIndex);
assert.ok(publicIndex > 0 && requireUserIndex > publicIndex, "requireUser comes after the public branch");
const publicBranch = route.slice(publicIndex, requireUserIndex);
assert.ok(publicBranch.includes("consumePublicMarketSearchQuota"), "the public branch uses the IP-hash public quota");
assert.ok(publicBranch.includes("store: false"), "the public branch writes nothing to the cache");
assert.ok(!publicBranch.includes("requireUser"), "no sign-in check inside the public branch");

// 3. Scope discipline: transport and tour stay behind sign-in — Junel's
// decision named stays and activities only.
assert.ok(!/"transport"/.test(publicBlock[0]), "transport stays sign-in-only");
assert.ok(!/"tour"/.test(publicBlock[0]), "tour stays sign-in-only");

// 4. The client maps real Klook activities when they come back, so the
// opened path has somewhere to land.
const findsSource = fs.readFileSync(path.join(root, "components/roamly/FindsTabs.tsx"), "utf8");
assert.ok(findsSource.includes("klookFindCard"), "FindsTabs maps Klook activity cards");
const core = fs.readFileSync(path.join(root, "lib/roamly/findsMarketCore.ts"), "utf8");
assert.ok(/export function klookFindCard/.test(core), "klookFindCard exists");

console.log("Guest activities search checks: PASS");
