// Deals Stays "Search stays" does nothing (2026-11-25 QA, bug 3).
//
// The failure: a guest picks the verified suggestion "Paris, Ile-de-France,
// France", fills Dec 10-13 2026, 2 travellers, 1 room, clicks "Search stays"
// — and nothing happens. No loading state the user can see, no results, no
// error; only the internal-config warning stays under the form. Two live
// browser repros (16:14-16:27 and 16:30-16:31 AST) confirmed it with every
// field value verified at click time, and native validation proven working
// (it fires on an empty field) but never firing here.
//
// The mechanism (proven against the live API + the mapper):
// - The guest stays POST to /api/roamly/market-search returns HTTP 200 with
//   exactly ONE result: a Stay22 search link — source "stay22",
//   price_type "search_ready", confidence "low", verification_status
//   "search_link_only", no property, no photo, no price. (Saved:
//   hidden_files/qa-2026-11-25/guest-hotel-paris-2026-12-10.json.)
// - `bookingFindCard` drops it three times over: `listingBase` requires
//   source "booking_demand" (it is "stay22"), price_type "live_partner"
//   (it is "search_ready"), and a title + booking URL + bstatic photo +
//   price (it has no photo and no price); and the availability check
//   requires availability_status "available" (absent).
// - So `stays` is empty, the message falls back to `body.warning` — the
//   internal config line — and the ~1.4 s fetch is too fast for the
//   "Opening..." state to register. The guest perceives a dead button.
//
// The fix: a Stay22 search handoff card. When the only live result is a
// `search_ready` Stay22 link, show it as what it honestly is — a partner
// search link for the destination and dates, with no property, no photo
// and no price claimed — the same handoff family as the Aviasales flight
// link the QA verified working. The verified-stays path
// (`bookingFindCard`) is untouched. The message distinguishes a handoff
// from priced stays, so it never calls a search link "verified".
// Second half of bug 3: a place picked via the "Use custom place" row
// (the only row while suggestions load) can never search — the form now
// says so before submit and disables the button while the place is
// custom, instead of silently refusing on click.
//
// Run BEFORE the fix this script FAILS (no handoff mapper; the live
// result maps to nothing). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);

function loadTsModule(entryFile) {
  const source = fs.readFileSync(path.join(root, entryFile), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, URL, URLSearchParams, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: entryFile });
  return sandbox.module.exports;
}

const core = loadTsModule("lib/roamly/findsMarketCore.ts");

// The exact live result the guest stays search returns today (trimmed
// from hidden_files/qa-2026-11-25/guest-hotel-paris-2026-12-10.json).
const liveStay22Result = {
  id: "6633b212-97e4-4984-851a-45cdcaf66432",
  category: "hotel",
  title: "Paris hotel search",
  provider: "Stay22 search",
  source: "stay22",
  destination: "Paris",
  city: "Paris",
  country: "France",
  start_date: "2026-12-10",
  end_date: "2026-12-13",
  travelers: 2,
  rooms: 1,
  currency: "CAD",
  price_type: "search_ready",
  confidence: "low",
  booking_url: "https://www.stay22.com/allez/booking?address=Paris%2C+France&hotelname=Paris+hotel+search&checkin=2026-12-10&checkout=2026-12-13&adults=2&rooms=1&aid=roamly",
  affiliate_url: "https://www.stay22.com/allez/booking?address=Paris%2C+France&hotelname=Paris+hotel+search&checkin=2026-12-10&checkout=2026-12-13&adults=2&rooms=1&aid=roamly",
  searched_at: "2026-11-25T20:32:47.087Z",
  verification_status: "search_link_only"
};

// 1. The defect: the live result maps to NOTHING through the verified path.
assert.equal(core.bookingFindCard(liveStay22Result), null, "verified mapper drops the live Stay22 search link");

// 2. The fix: a Stay22 search handoff card exists and maps the live result.
assert.equal(typeof core.stay22SearchFindCard, "function", "stay22SearchFindCard exists");
const handoff = core.stay22SearchFindCard(liveStay22Result);
assert.ok(handoff, "the live Stay22 result maps to a handoff card");
assert.equal(handoff.category, "hotel");
assert.equal(handoff.href, liveStay22Result.affiliate_url, "handoff goes to the Stay22 search link");
assert.equal(handoff.price, null, "no price is claimed");
assert.equal(handoff.image, null, "no photo is claimed");
assert.ok(!/verified/i.test(`${handoff.title} ${handoff.description}`), "a search link is never called verified");
assert.ok(/Paris/i.test(handoff.title), "the card names the destination");
assert.ok(handoff.affiliate === true, "the partner handoff is marked affiliate");

// 3. The mapper only accepts genuine Stay22 search-ready hotel links.
assert.equal(core.stay22SearchFindCard({ ...liveStay22Result, source: "booking_demand" }), null, "wrong source rejected");
assert.equal(core.stay22SearchFindCard({ ...liveStay22Result, price_type: "live_partner" }), null, "live_partner stays on the verified path");
assert.equal(core.stay22SearchFindCard({ ...liveStay22Result, affiliate_url: "https://evil.example/x", booking_url: "https://evil.example/x" }), null, "non-Stay22 href rejected");
assert.equal(core.stay22SearchFindCard({ ...liveStay22Result, affiliate_url: undefined, booking_url: undefined }), null, "no link, no card");

// 4. No regression: a real verified Booking Demand result still maps.
const livePartnerResult = {
  id: "bd-1",
  category: "hotel",
  title: "Hotel Example Paris",
  source: "booking_demand",
  price_type: "live_partner",
  booking_url: "https://www.booking.com/hotel/fr/example.html",
  price_amount: 189,
  currency: "CAD",
  searched_at: "2026-11-25T20:32:47.087Z",
  metadata: { providerPayload: { availability_status: "available", photo_urls: ["https://cf.bstatic.com/xdata/images/hotel/max1024x768/123.jpg"] } }
};
const verified = core.bookingFindCard(livePartnerResult);
assert.ok(verified, "verified Booking Demand result still maps");
assert.ok(verified.price, "verified card keeps its price");
assert.equal(core.stay22SearchFindCard(livePartnerResult), null, "verified result is not also a handoff");

// 5. The stays form wires the handoff in and tells the two cases apart.
const findsSource = fs.readFileSync(path.join(root, "components/roamly/FindsTabs.tsx"), "utf8");
assert.ok(
  findsSource.includes("stay22SearchFindCard"),
  "FindsTabs imports the handoff mapper"
);
assert.ok(
  /bookingFindCard\(item\) \?\? stay22SearchFindCard\(item\)/.test(findsSource),
  "searchHotels falls through from verified stays to the Stay22 handoff"
);
assert.ok(
  /No priced stays came back for these dates/.test(findsSource),
  "a handoff-only result gets a truthful message, not the verified-stays line"
);

// 6. Second half of bug 3: a custom (unverified) place is called out
// before submit instead of silently refusing on click.
assert.ok(
  /hotelDestination\?\.source === "custom"/.test(findsSource),
  "the stays form knows when the place is custom"
);
assert.ok(
  /Choose a destination from the place suggestions so we can verify its country before searching stays/.test(findsSource),
  "the verify-your-country hint exists"
);

console.log("Stays search handoff checks: PASS");
