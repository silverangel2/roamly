// roamly-ux-round2-e-checks.mjs — BUILDER E proof (Round 2 UX repair).
// Panel 6 PLACE DETAIL (owner mock correct-4-pages-part2.jpg, 2nd panel):
// real-data-only rendering, unavailable states, walk-time labeling,
// per-trip isolation. Fixture values below are synthetic test data,
// NOT the mock's sample values — the suite also asserts no mock sample
// string leaks into any built output.
// Runtime checks import the tree's own TS via the alias loader; STATIC
// checks prove the page/panel actually use the view-model.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-round2-e-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlaceDetail,
  resolvePlaceInItinerary,
  fallbackPlaceId,
  formatDayLabel,
  formatTripDateRange,
  estimateWalk,
  buildDirectionsUrl,
  findConfirmedBookingForPlace,
  parseClockMinutes,
  formatClockMinutes,
  formatDurationMinutes
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

function detailFor(item, overrides = {}) {
  return buildPlaceDetail({
    item,
    day: { ...DAY, live_timeline: [item, ...(overrides.siblingItems || [])] },
    siblings: (overrides.siblingItems || []).map((sibling, i) => ({
      item: sibling,
      id: sibling.item_id || fallbackPlaceId(1, i + 1)
    })),
    trip: TRIP,
    tripTips: overrides.tripTips ?? [],
    confirmedBookings: overrides.confirmedBookings ?? [],
    photo: overrides.photo ?? null
  });
}

const MAIN = {
  item_id: "item-main",
  title: "Harbor Test Museum",
  description: "A test museum on the harbor.",
  location_name: "Old Port district",
  map_query: "Harbor Test Museum, Montreal",
  startTime: "10:00",
  endTime: "12:00",
  durationMinutes: 120,
  category: "activity",
  coordinates: { latitude: 45.508, longitude: -73.553 }
};

// ---- Time range + duration (real plan data only) ----
{
  const d = detailFor(MAIN);
  check("time range from start/end wall-clock strings", d?.timeRangeLabel === "10:00 AM – 12:00 PM", d?.timeRangeLabel || "null");
  check("duration from durationMinutes", d?.durationLabel === "2h", d?.durationLabel || "null");
  check("badge is Planned for a plain plan item", d?.badge === "Planned");
  check("timeKnown true when a real window exists", d?.evidence.timeKnown === true);
  check("locationKnown true with map query", d?.evidence.locationKnown === true);
}
{
  const d = detailFor({ item_id: "x1", title: "Label Range Stop", time_label: "1:00 PM – 3:00 PM", category: "activity" });
  check("time range from a parseable time_label", d?.timeRangeLabel === "1:00 PM – 3:00 PM", d?.timeRangeLabel || "null");
  check("duration derived from the time_label window", d?.durationLabel === "2h", d?.durationLabel || "null");
}
{
  const d = detailFor({ item_id: "x2", title: "Flexible Stop", description: "No times yet.", category: "activity" });
  check("no times -> no time range, no invented clocks", d?.timeRangeLabel === null && d?.durationLabel === null);
  check("no times -> timeKnown false, badge still Planned", d?.evidence.timeKnown === false && d?.badge === "Planned");
}
{
  check("clock parse/format round-trips", parseClockMinutes("1:00 PM") === 780 && formatClockMinutes(780) === "1:00 PM" && parseClockMinutes("13:00") === 780);
  check("duration formats match the mock style", formatDurationMinutes(120) === "2h" && formatDurationMinutes(45) === "45m" && formatDurationMinutes(75) === "1h 15m");
}

// ---- Description / about unavailable states ----
{
  const d = detailFor({ item_id: "x3", title: "Undescribed Stop", category: "activity" });
  check("missing description stays null, never invented", d?.description === null);
  check("opening hours + ticket info always unavailable (no source)", d?.about.openingHours === null && d?.about.ticketInfo === null);
  check("address unavailable without a confirmed booking", d?.about.address === null);
  check("location equal to title is not duplicated", detailFor({ item_id: "x4", title: "Same Name Stop", location_name: "Same Name Stop" })?.locationLabel === null);
  check("distinct location label is kept", detailFor(MAIN)?.locationLabel === "Old Port district");
}

// ---- Photos: pipeline single photo only, never 1/6 ----
{
  const withPhoto = detailFor(MAIN, { photo: { imageUrl: "https://example.invalid/photo.jpg", credit: "Tester · CC BY-SA 4.0", pageUrl: "https://example.invalid/page" } });
  check("photo present -> count is 1/1", withPhoto?.photo?.countLabel === "1/1", withPhoto?.photo?.countLabel || "null");
  const bare = detailFor(MAIN);
  check("no photo -> bare treatment (photo null, no count)", bare?.photo === null);
  const json = JSON.stringify(detailFor(MAIN, { photo: { imageUrl: "https://example.invalid/p.jpg" } }));
  check("no 1/6 count anywhere in built output", !json.includes("1/6"));
}

// ---- Directions: always a valid Maps link from the item's own data ----
{
  const d = detailFor(MAIN);
  check("directions with coords uses lat,lon + walking", (d?.directionsUrl || "").startsWith("https://www.google.com/maps/dir/?api=1&destination=45.508%2C-73.553&travelmode=walking"), d?.directionsUrl || "null");
  const noCoords = detailFor({ item_id: "x5", title: "Query Stop", map_query: "Query Stop, Montreal" });
  check("directions without coords falls back to the map query", (noCoords?.directionsUrl || "").includes("destination=Query%20Stop%2C%20Montreal"), noCoords?.directionsUrl || "null");
  check("directions does not duplicate a city already in the map query", !(noCoords?.directionsUrl || "").includes("Montreal%2C%20Montreal") && !(noCoords?.directionsUrl || "").includes("Montreal%2C%20Canada"), noCoords?.directionsUrl || "null");
  check("directions builder never returns an empty link for a titled item", buildDirectionsUrl({ title: "Only Title" }, null) !== null);
}

// ---- Confirmed boundary: exact title match only ----
{
  const booking = { title: "Harbor Test Museum", address: "1 Test Quay, Montreal", traveler_confirmed: true, booking_status: "confirmed" };
  const d = detailFor(MAIN, { confirmedBookings: [booking] });
  check("exact-title confirmed booking -> Confirmed badge + booking address", d?.badge === "Confirmed" && d?.about.address === "1 Test Quay, Montreal", `${d?.badge} / ${d?.about.address}`);
  const fuzzy = detailFor(MAIN, { confirmedBookings: [{ title: "Harbor Test Museum Shop", address: "9 Elsewhere St", traveler_confirmed: true }] });
  check("similar-but-different booking title -> NOT confirmed, no address", fuzzy?.badge === "Planned" && fuzzy?.about.address === null);
  const superseded = detailFor(MAIN, { confirmedBookings: [{ ...booking, superseded_by_booking_id: "other" }] });
  check("superseded booking -> NOT confirmed", superseded?.badge === "Planned");
  check("matcher itself: exact match only", findConfirmedBookingForPlace([booking], "Harbor Test Museum") !== null && findConfirmedBookingForPlace([booking], "Another Museum") === null);
}

// ---- Nearby: same-day siblings only, walk = (est.) or unavailable ----
{
  const siblingNear = { item_id: "sib-near", title: "Nearby Test Gallery", category: "activity", coordinates: { latitude: 45.5045, longitude: -73.5561 } };
  const siblingFar = { item_id: "sib-far", title: "Far Test Hall", category: "activity" };
  const travelLeg = { item_id: "sib-travel", title: "Travel to the venue", item_type: "transfer", category: "transfer" };
  const generic = { item_id: "sib-generic", title: "Unresolved place", category: "activity" };
  const d = detailFor(MAIN, { siblingItems: [siblingNear, siblingFar, travelLeg, generic] });
  const titles = (d?.nearby || []).map((n) => n.title);
  check("nearby keeps real same-day stops", titles.includes("Nearby Test Gallery") && titles.includes("Far Test Hall"), JSON.stringify(titles));
  check("nearby excludes travel legs and generic stops", !titles.includes("Travel to the venue") && !titles.includes("Unresolved place"));
  check("nearby excludes the place itself", !titles.includes("Harbor Test Museum"));
  const near = (d?.nearby || []).find((n) => n.title === "Nearby Test Gallery");
  check("walk time with both coords is labeled (est.)", (near?.walkLabel || "").endsWith("min walk (est.)"), near?.walkLabel || "null");
  check("walk distance is a real haversine number", typeof near?.distanceKm === "number" && near.distanceKm > 0.3 && near.distanceKm < 0.6, String(near?.distanceKm));
  const far = (d?.nearby || []).find((n) => n.title === "Far Test Hall");
  check("walk time without coords is unavailable, not guessed", far?.walkLabel === null && far?.distanceKm === null);
  check("estimateWalk null without coords", estimateWalk({ latitude: 45.5, longitude: -73.5 }, null) === null);
}

// ---- Tips: trip's own local_tips only, with provenance ----
{
  const d = detailFor(MAIN, { tripTips: ["  Pack light. ", "Pack light.", "Bring water."] });
  check("tips are the trip's own, deduped + trimmed", JSON.stringify(d?.tips) === JSON.stringify(["Pack light.", "Bring water."]), JSON.stringify(d?.tips));
  check("tips carry trip-plan provenance", d?.tipsProvenance === "From this trip's plan");
  const empty = detailFor(MAIN, { tripTips: [] });
  check("no trip tips -> empty list, no provenance, no invented tips", empty?.tips.length === 0 && empty?.tipsProvenance === null);
}

// ---- Per-trip isolation + resolver ----
{
  const tripA = { daily_itinerary: [{ day_number: 1, date: "2026-10-26", live_timeline: [MAIN, { item_id: "a2", title: "Second Stop" }] }] };
  const tripB = { daily_itinerary: [{ day_number: 1, date: "2026-10-26", live_timeline: [{ item_id: "b1", title: "Other Trip Stop" }] }] };
  check("resolver finds the item in its own trip", resolvePlaceInItinerary(tripA, "item-main")?.item.title === "Harbor Test Museum");
  check("resolver finds by fallback id", resolvePlaceInItinerary(tripA, "d1-1")?.item.title === "Second Stop");
  check("resolver refuses another trip's id", resolvePlaceInItinerary(tripB, "item-main") === null);
  check("resolver refuses an unknown id", resolvePlaceInItinerary(tripA, "nope") === null);
  check("resolver refuses an unusable title", resolvePlaceInItinerary({ daily_itinerary: [{ day_number: 1, date: "2026-10-26", live_timeline: [{ item_id: "u1", title: "Unresolved place" }] }] }, "u1") === null);
}

// ---- Trip header identity + TZ-invariant day labels ----
{
  check("day label is Day 1 · Mon, Oct 26", formatDayLabel("2026-10-26", 1) === "Day 1 · Mon, Oct 26", formatDayLabel("2026-10-26", 1));
  check("trip date range drops the shared start year", formatTripDateRange("2026-10-26", "2026-10-30") === "Oct 26 – Oct 30, 2026", formatTripDateRange("2026-10-26", "2026-10-30"));
  const d = detailFor(MAIN);
  check("header carries destination + origin + date range", d?.tripHeader.destination === "Montreal, Canada" && d?.tripHeader.origin === "Saint John" && d?.tripHeader.dateRangeLabel === "Oct 26 – Oct 30, 2026", JSON.stringify(d?.tripHeader));
}

// ---- No mock sample values leak into built output ----
{
  const d = detailFor(MAIN, { siblingItems: [{ item_id: "s1", title: "Nearby Test Gallery", category: "activity" }], tripTips: ["Bring water."] });
  const json = JSON.stringify(d);
  const leaks = ["Sainte-Anne", "Place Jacques-Cartier", "Notre-Dame Basilica", "8 min walk", "12 min walk", "Check opening hours before you go", "Wear comfortable shoes"];
  check("no mock sample string appears in built output", leaks.every((s) => !json.includes(s)), leaks.filter((s) => json.includes(s)).join(", ") || "clean");
  check("every walk label present is labeled (est.)", (d?.nearby || []).every((n) => n.walkLabel === null || n.walkLabel.includes("(est.)")));
}

// ---- Static wiring: page + panel + timeline link actually exist ----
{
  const page = read("app/trip/[id]/place/[placeId]/page.tsx");
  check("page resolves via this trip's bundle only", page.includes("getTripBundle") && page.includes("resolvePlaceInItinerary") && !page.includes("fetch("));
  check("page uses the destination-photo pipeline for photos", page.includes("getDestinationPhoto"));
  check("page supplies no invented hours/tickets (view-model owns the nulls)", page.includes("buildPlaceDetail") && !page.includes("openingHours") && !page.includes("ticketInfo"));
  const panel = read("components/roamly/PlaceDetailPanel.tsx");
  check("panel renders Directions as a real link", panel.includes("detail.directionsUrl") && panel.includes('target="_blank"'));
  check("panel renders Add to calendar + Save disabled, never as working buttons", panel.includes("Add to calendar") && panel.includes("Save") && panel.includes("disabled") && panel.includes("not available yet"));
  check("panel shows per-field unavailable states", panel.includes("Not available"));
  check("panel uses navy-slate ink, light grouped bg, never black-dominant", panel.includes("text-chead") && read("app/trip/[id]/place/[placeId]/page.tsx").includes("bg-cbg") && !panel.includes("text-black") && !panel.includes("bg-black ") && !panel.includes("bg-black\""));
  const timeline = read("components/trip/ItineraryDayPlan.tsx");
  check("timeline links to place detail only with a stable id", timeline.includes("/trip/${tripId}/place/${item.itemId}") && timeline.includes("item.itemId ?"));
  const vm = read("lib/roamly/placeDetail.ts");
  check("view-model imports nothing server-side", !vm.includes("from \"@/lib/supabase") && !vm.includes("fetch("));
  const forbidden = read("lib/itinerary.ts").includes("PlaceDetailPanel") || read("lib/roamly/socialReelGenerator.ts").includes("PlaceDetailPanel");
  check("forbidden files untouched by this panel (no references)", forbidden === false);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILURES: ${failed.map((f) => f.name).join("; ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
