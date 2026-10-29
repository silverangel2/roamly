// roamly-ux-picture7-directions-checks.mjs — PICTURE 7 proof
// (owner mock correct-4-pages-part2.jpg, 3rd panel: "Getting to your
// next stop" as a STANDALONE screen). The route did not exist before
// this picture (Picture 4's named gap); this suite proves the route,
// its entry points, its per-trip/per-leg isolation, the photo strip
// position + real-photo-only rule, the opt-in haversine estimate,
// the Show-all behavior, and that no mock value is copied anywhere.
// Runtime checks import the tree's own TS via the alias loader;
// STATIC checks prove the page/panel/screen/shell wiring.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-picture7-directions-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDirectionsMapsLinks,
  resolveWalkSummary
} from "@/lib/roamly/directionsPanel.ts";
import { mapsUrlForActivity } from "@/lib/roamly/liveCompanion.ts";
import { buildDirectionsUrl } from "@/lib/roamly/placeDetail.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, kind, ok, detail = "") {
  results.push({ name, kind, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${kind}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- Fixtures (synthetic coordinates only; no mock values anywhere) ----
const groundedEstimate = {
  fromItemId: "stop-prev", toItemId: "stop-next", mode: "WALK",
  distanceKm: 0.8, distanceKind: "ROUTE_DISTANCE",
  durationMinutes: 25, durationSource: "itinerary evidence", authority: "GROUNDED_ESTIMATE"
};
const geodesicOnly = {
  fromItemId: "stop-prev", toItemId: "stop-next", mode: "WALK",
  distanceKm: 0.8, distanceKind: "GEODESIC_STRAIGHT_LINE",
  durationMinutes: 25, durationSource: "itinerary evidence", authority: "GROUNDED_ESTIMATE"
};
const mismatchedEvidence = { ...groundedEstimate, fromItemId: "stop-other" };
const fallback = { durationMinutes: 10, distanceMeters: 800 };
const liveRoute = {
  status: "verified", provider: "google_distance_matrix", mode: "walking",
  durationMinutes: 12, retrievedAt: new Date().toISOString(), mapsUrl: ""
};

// ---- Fallback estimate rules (lib) ----
check("fallback fills a fully-unavailable summary as an (est.) pair", "FIXTURE",
  (() => { const s = resolveWalkSummary({ destinationId: "stop-next", fallbackEstimate: fallback }); return s.durationMinutes === 10 && s.durationKind === "estimated" && s.distanceMeters === 800 && s.distanceLabel === "800 m" && s.fallbackEstimateUsed === true; })(),
  JSON.stringify(resolveWalkSummary({ destinationId: "stop-next", fallbackEstimate: fallback })));
check("fallback never overrides a verified live route", "FIXTURE",
  (() => { const s = resolveWalkSummary({ destinationId: "stop-next", liveRoute, fallbackEstimate: fallback }); return s.durationMinutes === 12 && s.durationKind === "live" && s.distanceMeters === null && s.fallbackEstimateUsed === false; })());
check("fallback never overrides grounded evidence", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: groundedEstimate, originItemId: "stop-prev", destinationId: "stop-next", fallbackEstimate: fallback }); return s.durationMinutes === 25 && s.distanceMeters === 800 && s.fallbackEstimateUsed === false; })());
check("fallback never fills a gap beside grounded evidence (duration-only evidence keeps distance unavailable)", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: geodesicOnly, originItemId: "stop-prev", destinationId: "stop-next", fallbackEstimate: fallback }); return s.durationMinutes === 25 && s.distanceMeters === null && s.fallbackEstimateUsed === false; })());
check("mismatched evidence is ignored, so the fallback may serve the leg", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: mismatchedEvidence, originItemId: "stop-prev", destinationId: "stop-next", fallbackEstimate: fallback }); return s.durationMinutes === 10 && s.distanceMeters === 800 && s.fallbackEstimateUsed === true; })());
check("partial fallback (duration only) is not applied", "FIXTURE",
  (() => { const s = resolveWalkSummary({ destinationId: "stop-next", fallbackEstimate: { durationMinutes: 10, distanceMeters: null } }); return s.durationMinutes === null && s.distanceMeters === null && s.fallbackEstimateUsed === false; })());
check("no fallback passed keeps the old unavailable behavior", "FIXTURE",
  (() => { const s = resolveWalkSummary({ destinationId: "stop-next" }); return s.durationMinutes === null && s.distanceMeters === null && s.fallbackEstimateUsed === false; })());

// ---- STATIC: route page ----
const page = read("app/trip/[id]/directions/[placeId]/page.tsx");
check("standalone route file exists and is a server page", "STATIC",
  existsSync(join(root, "app/trip/[id]/directions/[placeId]/page.tsx")) && page.includes("export default async function TripDirectionsPage"));
check("route resolves the stop inside THIS trip's bundle only", "STATIC",
  page.includes("getTripBundle(supabase, current.user.id, id)") && page.includes("resolvePlaceInItinerary(itinerary, placeId)"));
check("route renders a not-found state for unknown / foreign stops, never a guessed place", "STATIC",
  page.includes("This stop is not in this trip's plan.") && page.includes("dashboard?tripAccess=denied"));
check("route evidence is this leg's own route_evidence, matched on from/to ids", "STATIC",
  page.includes("route_evidence") && page.includes("fromItemId === originItemId") && page.includes("toItemId === selfId"));
check("route back action returns to the entry page (place vs live)", "STATIC",
  page.includes('from === "place"') && page.includes("/place/${placeId}") && page.includes("/live"));
check("route fetches the strip photo through the pipeline, coords-gated", "STATIC",
  page.includes("getDestinationPhoto") && page.includes("coords") && page.includes("photo={photo ?"));

// ---- STATIC: standalone screen host ----
const screen = read("components/trip/DirectionsScreen.tsx");
const safePhotoImg = read("components/roamly/SafePhotoImg.tsx");
check("screen hosts the panel with walking mode, no location state, and the opt-in estimate", "STATIC",
  screen.includes("DirectionsPanel") && screen.includes('mode="walking"') && screen.includes("location={null}") &&
  screen.includes("allowWalkEstimate") && screen.includes('permission') && screen.includes('"prompt"'));
check("screen never links to itself (no standaloneHref on the standalone screen)", "STATIC",
  !screen.includes("standaloneHref"));
check("screen passes the real photo as the strip, or no strip at all", "STATIC",
  screen.includes("photoStrip={props.photo ?") && screen.includes("DirectionsPhotoStrip"));
check("strip photo unmounts on load error (no broken image, ever)", "STATIC",
  // Conditional-acceptance item 7 (AUTHORIZED rewrite): the old inline
  // pattern (onError + "if (failed) return null" in DirectionsScreen)
  // no longer exists — the strip delegates to SafePhotoImg. The safety
  // assertion is NOT weakened: it is now asserted in BOTH places, at
  // full strength. (1) The strip renders SafePhotoImg for its photo.
  // (2) SafePhotoImg itself carries the no-broken-image behavior:
  // failed → null, an error handler, invisible-until-loaded, and the
  // mount check for images that settled before hydration.
  screen.includes("SafePhotoImg") &&
  screen.includes("<SafePhotoImg") &&
  safePhotoImg.includes('if (state === "failed") return null') &&
  safePhotoImg.includes("onError={() => setState(\"failed\")}") &&
  safePhotoImg.includes("onLoad={() => setState(\"loaded\")}") &&
  safePhotoImg.includes("invisible") &&
  safePhotoImg.includes("img.complete") &&
  safePhotoImg.includes("naturalWidth > 0"));
check("screen starts from the panel's location-needed state, not a fake origin", "STATIC",
  screen.includes("location-needed state") && !screen.includes("current location\", \""));

// ---- STATIC: panel additions (live host behavior otherwise unchanged) ----
const panel = read("components/trip/DirectionsPanel.tsx");
check("panel renders the photo strip between the steps and Show-all", "STATIC",
  panel.includes("props.photoStrip") &&
  panel.indexOf("props.photoStrip") > panel.indexOf("Step-by-step directions") &&
  panel.indexOf("props.photoStrip") < panel.indexOf("Show fewer directions"));
check("panel renders the standalone link only when the host passes one", "STATIC",
  panel.includes("props.standaloneHref") && panel.includes("Open full directions screen"));
check("panel estimate is opt-in and haversine at walking speed from the verified origin", "STATIC",
  panel.includes("allowWalkEstimate") && panel.includes("calculateDistanceMeters") && panel.includes("4800"));
check("panel estimate distance carries (est.) beside the (est.) duration", "STATIC",
  panel.includes("fallbackEstimateUsed") && panel.includes('(est.)'));
check("panel still has no map element and no terrain/sidewalk claim", "STATIC",
  // Repair round P3: the technical "Map preview unavailable /
  // doesn't embed a map yet" block is GONE — the Route row's single
  // routing sentence is the screen's only routing explanation.
  !panel.includes("<iframe") && !panel.includes("Map preview unavailable") &&
  !panel.includes("embed a map yet") &&
  !panel.includes("Mostly flat") && !panel.includes("Sidewalks available"));
check("panel explains routing exactly once (summary Route row only)", "STATIC",
  panel.includes('"Live routing opens in your maps app"') &&
  !panel.includes("live routing opens in your maps app below") &&
  !panel.includes("tap Open in Maps above for turn-by-turn directions."));
check("panel has exactly one primary Open in Maps action (button slot + provider links)", "STATIC",
  panel.includes("Open in Maps") &&
  !panel.includes("inline-flex min-h-11 items-center px-2 text-[15px] font-semibold text-cblue") &&
  panel.includes("Google Maps") && panel.includes("Apple Maps") && panel.includes("Citymapper"));
check("Show-all renders only when it acts (no dead button)", "STATIC",
  // Conditional-acceptance item 5: the disabled Show-all control is
  // gone. The toggle renders only when it acts (more steps, or shown
  // steps to collapse); otherwise a plain-words note says so. Repair
  // round P3 removed the old bottom duplicate Open in Maps link +
  // repeated routing note from the non-ready branch entirely.
  !panel.includes("disabled={!hasMoreSteps") &&
  panel.includes("hasMoreSteps || showAll") &&
  panel.includes("All directions are shown above.") &&
  panel.includes("Show all directions") && panel.includes("Show fewer directions"));

// ---- STATIC: entry points ----
const live = read("components/trip/LiveTripClient.tsx");
check("Live entry: embedded panel links out to the standalone screen for its next stop", "STATIC",
  live.includes("standaloneHref={`/trip/${tripId}/directions/${nextActivity.id}?from=live`}"));
check("Live toggle behavior untouched (panel still toggles, still mounts)", "STATIC",
  live.includes("setShowDirectionsPanel((value) => !value)") && live.includes("showDirectionsPanel ? (") && live.includes("DirectionsPanel"));
const placePage = read("app/trip/[id]/place/[placeId]/page.tsx");
const placePanel = read("components/roamly/PlaceDetailPanel.tsx");
check("Place entry: place page passes the standalone URL for its place", "STATIC",
  placePage.includes("directionsScreenHref={`/trip/${id}/directions/${placeId}?from=place`}"));
check("Place panel renders Directions to the standalone screen, external link kept as fallback", "STATIC",
  placePanel.includes("directionsScreenHref") && placePanel.includes("detail.directionsUrl") && placePanel.includes('target="_blank"'));

// ---- STATIC: shell tab bar ----
const shell = read("components/AppShellClient.tsx");
check("shell app surface includes the directions route, so the tab bar renders", "STATIC",
  shell.includes("directions(?:\\/[^/]+)?"));
check("shell marks Itinerary active on the directions route (as in the picture)", "STATIC",
  shell.includes("/directions(\\/|$)/"));

// ---- STATIC: honesty across the new/edited files ----
const combined = page + screen + panel;
check("NO mock literals in the new screen files (no copied mock values)", "STATIC",
  !/Rue Saint-Paul|Rue Berri|Marché Sainte-Anne|Mostly flat|Sidewalks available/.test(combined));
check("forbidden files untouched by this picture", "STATIC",
  !read("lib/itinerary.ts").includes("Directions") && !read("lib/roamly/socialReelGenerator.ts").includes("Directions"));

// ---- ACCEPTANCE REVIEW (2026-10-28): WIP / unverified-stop honesty ----
// Finding: before this round BOTH directions views dropped the
// "Unverified stop" context — the standalone screen rendered the raw
// stored title ("WIP") as a normal destination and the embedded Live
// panel did the same for its next stop — while home, day card, Live
// timeline, and place detail all flagged it. Fix (display layer
// only): DirectionsPanel gains unverified/planTitle props and shows
// "Unverified stop" + "Plan title: <stored>"; the standalone page
// computes the flag with placeDetail's own rule and the Live host
// with its own timeline rule; maps destinations (coordinates) are
// untouched. These checks pin the fix and the coords-first routing.
check("DirectionsPanel renders Unverified stop + plan title, never the raw title, when unverified", "STATIC",
  panel.includes('const displayTitle = props.unverified ? "Unverified stop" : placeTitle') &&
  panel.includes("{displayTitle}") &&
  panel.includes("Plan title: {props.planTitle}") &&
  !panel.includes("To: </span>\n              {placeTitle}"));
check("DirectionsPanel maps links still use the destination object (coords untouched by the label fix)", "STATIC",
  panel.includes("destination: props.destination") && panel.includes("buildDirectionsMapsLinks"));
check("DirectionsScreen threads unverified + planTitle to the panel", "STATIC",
  screen.includes("unverified?: boolean") && screen.includes("planTitle?: string | null") &&
  screen.includes("unverified={props.unverified ?? false}") && screen.includes("planTitle={props.planTitle ?? null}"));
check("Standalone directions page computes unverified with placeDetail's rule and passes it through", "STATIC",
  page.includes("stripPlaceTitleEcho") && page.includes('/^[A-Z0-9]{2,4}$/.test(title)') &&
  page.includes("unverified={unverified}") && page.includes("planTitle={unverified ? title : null}"));
check("Standalone directions page never alts a venue photo with the raw unverified title", "STATIC",
  page.includes('alt: unverified ? "Unverified stop" : title'));
check("Live embedded panel passes its next stop's unverified flag + plan title", "STATIC",
  live.includes("nextUnverified") && live.includes("isUnverifiedLiveStop(nextActivity.title") &&
  live.includes("unverified={nextUnverified}") && live.includes("planTitle={nextUnverified ? nextActivity.title : null}"));
check("No verified-attraction / recommended wording attaches to a stop in the directions or place-detail views", "STATIC",
  !/verified attraction|recommended attraction|recommended stop/i.test(panel + screen + placePanel));
// Runtime: a WIP-shaped stop carrying the real OSM node coordinates
// routes by those coordinates in every maps builder — never by a
// name query for "WIP". (JS numbers drop the trailing zero, so
// -73.5705140 serializes as -73.570514; same coordinate value.)
const wipCoords = { latitude: 45.5131326, longitude: -73.5705140 };
check("WIP maps links resolve to the OSM node coordinates, not a name match (live, place, panel)", "FIXTURE",
  mapsUrlForActivity({ title: "WIP", placeName: "WIP", address: "WIP", ...wipCoords }).includes("destination=45.5131326%2C-73.570514") &&
  (buildDirectionsUrl({ title: "WIP", location_name: "WIP", map_query: "WIP", ...wipCoords }, "Montreal, Canada") || "").includes("destination=45.5131326%2C-73.570514") &&
  buildDirectionsMapsLinks({ destination: { id: "wip", title: "WIP", placeName: "WIP", ...wipCoords, address: null, radiusMeters: null } }).google.includes("destination=45.5131326%2C-73.570514"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name} — ${f.detail}`);
  process.exit(1);
}
