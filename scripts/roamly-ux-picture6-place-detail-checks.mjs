// roamly-ux-picture6-place-detail-checks.mjs — PICTURE 6 PLACE DETAIL
// (owner mock correct-4-pages-part2.jpg, 2nd panel), literal overhaul.
// Runtime checks import the tree's own TS via the alias loader; STATIC
// checks prove the page/panel follow the picture and nothing else.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-picture6-place-detail-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlaceDetail,
  fallbackPlaceId
} from "@/lib/roamly/placeDetail.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const TRIP = { destination: "Montreal, Canada", origin: "Saint John", start_date: "2026-10-26", end_date: "2026-10-30" };
const DAY = { day_number: 1, date: "2026-10-26", live_timeline: [] };
const MAIN = {
  item_id: "item-main",
  title: "Harbor Test Museum",
  description: "A test museum on the harbor.",
  location_name: "Old Port district",
  map_query: "Harbor Test Museum, Montreal",
  startTime: "13:00",
  endTime: "15:00",
  category: "activity",
  coordinates: { latitude: 45.508, longitude: -73.553 }
};
const SIB1 = { item_id: "sib-1", title: "Nearby Test Gallery", category: "activity", coordinates: { latitude: 45.5045, longitude: -73.5561 } };
const SIB2 = { item_id: "sib-2", title: "Second Test Hall", category: "activity", coordinates: { latitude: 45.51, longitude: -73.55 } };
const SIB3 = { item_id: "sib-3", title: "Third Test Hall", category: "activity", coordinates: { latitude: 45.512, longitude: -73.548 } };
const TRAVEL = { item_id: "sib-travel", title: "Travel to the venue", item_type: "transfer", category: "transfer" };

function detailFor(siblings, overrides = {}) {
  return buildPlaceDetail({
    item: MAIN,
    day: { ...DAY, live_timeline: [MAIN, ...siblings] },
    siblings: siblings.map((sibling, i) => ({ item: sibling, id: sibling.item_id || fallbackPlaceId(1, i + 1) })),
    trip: TRIP,
    tripTips: overrides.tripTips ?? [],
    confirmedBookings: overrides.confirmedBookings ?? [],
    photo: overrides.photo ?? null,
    siblingPhotos: overrides.siblingPhotos ?? {}
  });
}

// ---- Nearby capped at 2, in picture order, with real sibling photos ----
{
  const d = detailFor([SIB1, SIB2, SIB3, TRAVEL], {
    siblingPhotos: { "sib-1": { imageUrl: "https://example.invalid/sib1.jpg", credit: "Tester", pageUrl: null } }
  });
  check("nearby capped at 2 (picture shows two cards)", d?.nearby.length === 2, JSON.stringify((d?.nearby || []).map((n) => n.title)));
  check("nearby keeps first two eligible siblings, travel leg excluded", (d?.nearby || []).map((n) => n.title).join("|") === "Nearby Test Gallery|Second Test Hall");
  check("sibling photo attached from the caller map only", d?.nearby[0]?.photo?.imageUrl === "https://example.invalid/sib1.jpg" && d?.nearby[1]?.photo === null, JSON.stringify(d?.nearby[0]?.photo));
  check("walk labels still labeled (est.)", (d?.nearby || []).every((n) => n.walkLabel === null || n.walkLabel.includes("(est.)")));
  const noPhotos = detailFor([SIB1, SIB2]);
  check("no sibling photo -> photo null, never a broken image slot", noPhotos?.nearby.every((n) => n.photo === null) === true);
}

// ---- Header / title / chips stay on real plan data ----
{
  const d = detailFor([]);
  check("day label is the picture header form", d?.dayLabel === "Day 1 · Mon, Oct 26", d?.dayLabel || "null");
  check("title is the plan item's own title, never rewritten", d?.title === "Harbor Test Museum");
  check("chips from the real window", d?.timeRangeLabel === "1:00 PM – 3:00 PM" && d?.durationLabel === "2h" && d?.badge === "Planned", `${d?.timeRangeLabel} / ${d?.durationLabel} / ${d?.badge}`);
  check("no mock sample string in built output", !JSON.stringify(d).includes("Sainte-Anne") && !JSON.stringify(d).includes("Place Jacques-Cartier") && !JSON.stringify(d).includes("Notre-Dame Basilica") && !JSON.stringify(d).includes("1/6"));
}

// ---- Static: panel follows the picture literally ----
{
  // Strip block comments: the header comment NAMES the removed blocks,
  // so literal string checks must run on code, not on that comment.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const panel = stripComments(read("components/roamly/PlaceDetailPanel.tsx"));
  check("panel header is back chevron + centered day + destination only", panel.includes("Back to itinerary") && panel.includes("detail.dayLabel") && panel.includes("detail.tripHeader.destination") && !panel.includes("headerIdentity") && !panel.includes("dateRangeLabel") && !panel.includes("From ${"));
  check("panel renders no location line under the title", !panel.includes("detail.locationLabel"));
  check("panel renders no See the full itinerary button", !panel.includes("See the full itinerary"));
  check("About is one card: subtitle + chevron button, rows only when expanded", panel.includes("About this place") && panel.includes("Address, photos, opening hours, ticket info, and helpful tips.") && panel.includes("aria-expanded") && panel.includes("aboutOpen ?"));
  check("About rows still carry per-field unavailable states", panel.includes("AboutRow") && panel.includes("Not available"));
  check("Nearby cards carry no heart (no saved-places store)", !panel.includes("♡") && !panel.includes("♥") && !panel.toLowerCase().includes("heart"));
  check("Nearby cards render a sibling photo only when one exists", panel.includes("place.photo") && panel.includes("place.photo.imageUrl"));
  const tipsHeading = panel.indexOf(">Tips for your visit<");
  const tipsSectionTag = panel.slice(0, tipsHeading).lastIndexOf("<section");
  const tipsSectionOpen = panel.slice(tipsSectionTag, tipsHeading);
  check("Tips section is plain (no card background) and keeps green checks", tipsSectionOpen.includes('className="mt-6"') && !tipsSectionOpen.includes("bg-white") && panel.includes("text-cgreen"));
  check("actions row is plain (no white card) and calendar/save stay disabled", panel.includes('className="mt-5 grid grid-cols-3 gap-2"') && panel.includes("Add to calendar") && panel.includes("Save") && panel.includes("disabled") && panel.includes("not available yet"));
  check("content ends at Tips: no element renders after the Tips section", tipsHeading > panel.indexOf("Nearby") && !panel.slice(tipsHeading).includes("See the full itinerary"));
}

// ---- Static: page wiring ----
{
  const page = read("app/trip/[id]/place/[placeId]/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  check("page fetches sibling photos via the pipeline, coords-gated", page.includes("getDestinationPhoto") && page.includes("siblingPhotos") && page.includes("itemCoordinates(sibling.item)"));
  check("page caps sibling photo candidates at 2", page.includes("slice(0, 2)"));
  check("page has no See the full itinerary button anywhere", !page.includes("See the full itinerary"));
  check("page back route is this trip's itinerary home only", page.includes("`/trip/${tripId}`") && page.includes("resolvePlaceInItinerary"));
  check("page supplies no invented hours/tickets", !page.includes("openingHours") && !page.includes("ticketInfo"));
  const forbidden = read("lib/itinerary.ts").includes("PlaceDetailPanel") || read("lib/roamly/socialReelGenerator.ts").includes("PlaceDetailPanel");
  check("forbidden files untouched by this panel (no references)", forbidden === false);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILURES: ${failed.map((f) => f.name).join("; ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
