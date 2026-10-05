import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    if (absolute.endsWith(".json")) {
      const moduleRecord = { exports: JSON.parse(fs.readFileSync(absolute, "utf8")) };
      cache.set(absolute, { module: moduleRecord });
      return moduleRecord.exports;
    }
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const local = path.join(path.dirname(file), id);
          return load(local.match(/\.(ts|tsx|json)$/) ? local : `${local}.ts`);
        }
        return require(id);
      },
      URL,
      URLSearchParams,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const previous = {
  ROAMLY_AFFILIATES_ENABLED: process.env.ROAMLY_AFFILIATES_ENABLED,
  ROAMLY_HOTEL_AFFILIATE_PROVIDER: process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER,
  ROAMLY_STAY22_PARTNER_ID: process.env.ROAMLY_STAY22_PARTNER_ID,
  ROAMLY_STAY22_SMART_LINK_URL: process.env.ROAMLY_STAY22_SMART_LINK_URL,
  ROAMLY_STAY22_REFERRAL_URL: process.env.ROAMLY_STAY22_REFERRAL_URL
};

function restoreEnv() {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

process.env.ROAMLY_AFFILIATES_ENABLED = "true";
process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER = "stay22";
process.env.ROAMLY_STAY22_PARTNER_ID = "stay22-test-partner";
delete process.env.ROAMLY_STAY22_SMART_LINK_URL;
delete process.env.ROAMLY_STAY22_REFERRAL_URL;

const resolver = loadTsModule("lib/roamly/affiliateResolver.ts");
const input = {
  category: "hotel",
  title: "Hotel Gault",
  destination: "Montreal",
  neighborhood: "Old Montreal",
  startDate: "2026-10-30",
  endDate: "2026-11-02",
  adults: 2,
  children: 0,
  rooms: 1
};

const partners = Array.from(resolver.resolveConfiguredHotelPartners(input));
assert.deepEqual(
  partners.map((partner) => partner.label),
  ["Booking.com", "Expedia", "Hotels.com", "Vrbo", "Agoda"],
  "a configured Stay22 Allez account opens each lodging partner"
);
assert.equal(partners.some((partner) => /kayak/i.test(partner.label + partner.href)), false, "Kayak is not offered as a stay partner");
for (const partner of partners) {
  const url = new URL(partner.href);
  assert.equal(url.hostname.replace(/^www\./, ""), "stay22.com");
  assert.match(url.pathname, /^\/allez\/(booking|expedia|hotelscom|vrbo|agoda)$/);
  assert.equal(url.searchParams.get("aid"), "stay22-test-partner");
  assert.equal(url.searchParams.get("checkin"), "2026-10-30");
  assert.equal(url.searchParams.get("checkout"), "2026-11-02");
  assert.equal(url.searchParams.get("adults"), "2");
  assert.equal("price" in partner, false);
  assert.equal(partner.provider, "stay22");
}
assert.equal(new Set(partners.map((partner) => new URL(partner.href).pathname)).size, partners.length, "each partner is a distinct search");

const primary = resolver.resolveAffiliateLink(input);
assert.equal(new URL(primary.finalUrl).pathname, "/allez/booking", "the single hotel affiliate link stays on Booking.com");

process.env.ROAMLY_AFFILIATES_ENABLED = "false";
assert.equal(resolver.resolveConfiguredHotelPartners(input).length, 0, "disabled affiliates produce no stay buttons");
process.env.ROAMLY_AFFILIATES_ENABLED = "true";
delete process.env.ROAMLY_STAY22_PARTNER_ID;
assert.equal(resolver.resolveConfiguredHotelPartners(input).length, 0, "an unconfigured hotel provider produces no invented partners");

process.env.ROAMLY_STAY22_PARTNER_ID = "stay22-test-partner";
process.env.ROAMLY_STAY22_REFERRAL_URL = "https://www.stay22.com/search?aid=fixed";
const single = Array.from(resolver.resolveConfiguredHotelPartners(input));
assert.equal(single.length, 1, "a Stay22 link that cannot be retargeted stays one choice");
assert.equal(single[0].label, "Stay22");
assert.match(single[0].href, /stay22\.com\/search/);
assert.doesNotMatch(single[0].href, /\/allez\/expedia/);

restoreEnv();

const page = fs.readFileSync(path.join(root, "app/trip/[id]/page.tsx"), "utf8");
const choices = fs.readFileSync(path.join(root, "components/trip/HotelPartnerChoices.tsx"), "utf8");
const customizer = fs.readFileSync(path.join(root, "components/roamly/CustomizeYourTrip.tsx"), "utf8");
const itinerary = fs.readFileSync(path.join(root, "components/trip/ItineraryDayPlan.tsx"), "utf8");
const nav = fs.readFileSync(path.join(root, "components/roamly/TripContextNav.tsx"), "utf8");

assert.match(page, /Customize your trip/);
assert.match(customizer, /Tell us what to change — we’ll rebuild the parts that need it/);
assert.match(customizer, /Your notes/);
assert.match(customizer, /flexible stop can be swapped or removed/);
assert.match(customizer, /CustomerBudgetChange/);
assert.match(customizer, /CustomerDateChange/);
assert.match(customizer, /CustomerDestinationChange/);
assert.match(customizer, /CustomerTripIntentChange/);
assert.match(page, /<CustomizeYourTrip/);
assert.match(nav, /#customize/);
assert.match(page, /PackageStays/);
assert.match(page, /Stay options in this package/);
assert.match(page, /Price not available/);
assert.match(page, /positiveHotelAmount/);
assert.match(choices, /Book stay options/);
assert.match(choices, /Roamly may earn a commission/);
assert.doesNotMatch(choices, /roamly-print-only/);
assert.match(itinerary, /HotelPartnerChoices/);
assert.match(itinerary, /staySearch/);
assert.match(page, /staySearch=\{staySearch\}/);
assert.doesNotMatch(page, /CustomerBudgetChange/);
assert.match(page, /function hotelTravelerPrice/);
assert.match(page, /value > 0/);
assert.match(choices, /partners\.map/);
assert.match(choices, /partner\.label/);
assert.match(choices, /emphasis=\{primary \? "primary" : "secondary"\}/);
assert.match(choices, /overflow-x-auto/);
assert.match(choices, /compact/);
assert.doesNotMatch(choices, /hidden|display:\s*none|partners\.slice\(0,\s*1\)/);
assert.match(customizer, /divide-y/);
const budgetChange = fs.readFileSync(path.join(root, "components/roamly/CustomerBudgetChange.tsx"), "utf8");
assert.match(budgetChange, /Change budget/);
assert.match(budgetChange, /PackageChangeRow/);
assert.match(nav, /label: "Customize"/);
assert.match(nav, /label: "Live"/);
assert.match(page, /headerBudgetText/);
assert.match(page, /Review the budget/);

const shell = fs.readFileSync(path.join(root, "components/AppShellClient.tsx"), "utf8");
const scroll = loadTsModule("lib/roamly/bottomNavScroll.ts");
assert.match(shell, /nextBottomNavHidden/);
assert.match(shell, /data-bottom-nav=/);
assert.match(shell, /aria-hidden=\{bottomNavHidden/);
assert.match(shell, /inert=\{bottomNavHidden/);
assert.match(shell, /lg:hidden/);
assert.match(shell, /aria-label="Mobile navigation"/);
assert.match(shell, /motion-reduce:transition-none/);

function scrollStep(state, currentY, focused = false) {
  const next = scroll.nextBottomNavHidden({
    anchorY: state.anchorY,
    currentY,
    hidden: state.hidden,
    focused
  });
  return next;
}

let navScroll = { hidden: false, anchorY: 0 };
navScroll = scrollStep(navScroll, 8);
assert.equal(navScroll.hidden, false, "near the top the bottom nav stays visible");
navScroll = scrollStep(navScroll, 80);
assert.equal(navScroll.hidden, true, "scrolling down hides the bottom nav");
navScroll = scrollStep(navScroll, 86);
assert.equal(navScroll.hidden, true, "a small downward jitter does not show the nav again");
navScroll = scrollStep(navScroll, 40);
assert.equal(navScroll.hidden, false, "scrolling up shows the bottom nav");
navScroll = scrollStep(navScroll, 120);
assert.equal(navScroll.hidden, true, "scrolling down hides it again");
navScroll = scrollStep(navScroll, 200, true);
assert.equal(navScroll.hidden, false, "keyboard focus inside the nav keeps it available");
navScroll = scrollStep({ hidden: true, anchorY: 400 }, 0);
assert.equal(navScroll.hidden, false, "returning to the top shows the bottom nav");

console.log("Roamly traveler package checks passed.");
