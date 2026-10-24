// House Ads Engine (Phase 1) — Roamly checks.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-house-ads-checks.mjs
// Functional tests cover the client-safe catalog module; route/recorder
// wiring is asserted at the source level (routes import next/server and
// the server-only Amazon gate, which plain node cannot load).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const houseAds = await import(path.join(root, "lib/houseAds.ts"));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL - ${name}: ${error.message}`);
  }
}

check("catalog: every creative is complete, labeled, and has a real photo on disk", () => {
  assert.ok(houseAds.HOUSE_AD_CREATIVES.length >= 4);
  for (const creative of houseAds.HOUSE_AD_CREATIVES) {
    assert.ok(creative.id && creative.headline && creative.sponsorLabel, creative.id);
    assert.ok(creative.ctaLabel && creative.imageAlt, creative.id);
    assert.ok(["hotel", "gadget", "trip", "house"].includes(creative.category), creative.id);
    assert.ok(creative.image.startsWith("/ads/"), creative.id);
    assert.ok(fs.existsSync(path.join(root, "public", creative.image)), `missing photo for ${creative.id}`);
    assert.ok(houseAds.resolveHouseAdLanding(creative.id), `no landing for ${creative.id}`);
    assert.equal(houseAds.houseAdClickPath(creative.id), `/api/ads/click/${creative.id}`);
  }
});

check("landings: hotels are plain Booking.com search; gadget + house cards cross-promote ReviewIntel", () => {
  const kyoto = new URL(houseAds.resolveHouseAdLanding("hotel-kyoto"));
  assert.equal(kyoto.hostname, "www.booking.com");
  assert.equal(kyoto.searchParams.get("ss"), "Kyoto");
  assert.equal(kyoto.searchParams.get("aid"), null, "no fabricated Booking affiliate id");
  const lisbon = new URL(houseAds.resolveHouseAdLanding("hotel-lisbon"));
  assert.equal(lisbon.searchParams.get("ss"), "Lisbon");
  assert.equal(houseAds.resolveHouseAdLanding("gadget-earbuds"), "https://getreviewintel.com/analyze");
  assert.equal(houseAds.resolveHouseAdLanding("ri-check"), "https://getreviewintel.com/analyze");
  assert.equal(houseAds.resolveHouseAdLanding("nope"), null);
});

check("selection: even rotation covers the family; trip pages lead with hotels", () => {
  for (const context of ["home", "trip"]) {
    const candidates = houseAds.houseAdCandidates(context);
    const seen = new Set();
    for (let seed = 0; seed < candidates.length; seed++) seen.add(houseAds.pickHouseAd(context, seed).id);
    assert.equal(seen.size, candidates.length, `${context} rotation must cover every candidate`);
  }
  assert.equal(houseAds.pickHouseAd("trip", 0).category, "hotel");
});

check("event parsing: only known creatives and impressions pass; paths clipped", () => {
  const ok = houseAds.parseHouseAdEvent({
    creativeId: "ri-check",
    eventType: "impression",
    pagePath: "/" + "x".repeat(400),
  });
  assert.equal(ok.pagePath.length, 300);
  assert.equal(houseAds.parseHouseAdEvent({ creativeId: "ri-check", eventType: "click" }), null);
  assert.equal(houseAds.parseHouseAdEvent({ creativeId: "ghost", eventType: "impression" }), null);
  assert.equal(houseAds.parseHouseAdEvent(null), null);
});

check("wiring: routes record through the shared writer and resolve landings server-side", () => {
  const eventRoute = read("app/api/ads/event/route.ts");
  assert.match(eventRoute, /parseHouseAdEvent/);
  assert.match(eventRoute, /recordHouseAdEvent/);
  const clickRoute = read("app/api/ads/click/[creativeId]/route.ts");
  assert.match(clickRoute, /resolveHouseAdClickLanding/);
  assert.match(clickRoute, /recordHouseAdEvent/);
  assert.match(clickRoute, /NextResponse\.redirect\(landing, 302\)/);
  const server = read("lib/houseAdServer.ts");
  assert.match(server, /getAmazonAffiliateConfig/);
  assert.match(server, /buildAmazonSearchUrl/);
  const recorder = read("lib/houseAdEvents.ts");
  assert.match(recorder, /house_ad_events/);
  assert.match(recorder, /createSupabaseAdminClient/);
});

check("wiring: card is labeled, view-counted, dismissible; placements exist", () => {
  const card = read("components/roamly/HouseAdCard.tsx");
  assert.match(card, /Sponsored/);
  assert.match(card, /IntersectionObserver/);
  assert.match(card, /sessionStorage/);
  assert.match(card, /\/api\/ads\/event/);
  assert.match(read("app/page.tsx"), /HouseAdSlot context="home"/);
  assert.match(read("app/trip/[id]/page.tsx"), /HouseAdSlot context="trip"/);
});

check("migration: house_ad_events table, service-role only, present but unapplied by this lane", () => {
  const sql = read("supabase/migrations/20261023_roamly_house_ad_events.sql");
  assert.match(sql, /create table if not exists public\.house_ad_events/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /to service_role/);
});

if (failures) {
  console.error(`\n${failures} house-ads check(s) failed`);
  process.exit(1);
}
console.log("\nAll house-ads checks passed");
