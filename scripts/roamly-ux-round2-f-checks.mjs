// roamly-ux-round2-f-checks.mjs — BUILDER F proof (Round 2 UX repair).
// Panel 7 DIRECTIONS ("Getting to your next stop"): header + day,
// map-slot honest state (no embedded map exists), walk summary from
// real sources only, Open in Maps from real destination data, location-
// gated steps, Show-all control, per-trip / per-leg isolation.
// Runtime checks import the tree's own TS via the alias loader; STATIC
// checks prove the component and the LiveTripClient wiring use it.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-round2-f-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC (day labels are
// TZ-stable by construction: noon-UTC parsing).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDirectionsMapsLinks,
  formatDirectionsDayLabel,
  formatDistanceMeters,
  formatDurationMinutes,
  formatTripIdentity,
  resolveDirectionsLocationGate,
  resolveDirectionsSteps,
  resolveWalkSummary
} from "@/lib/roamly/directionsPanel.ts";

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
const NOW = Date.now();
const freshAt = new Date(NOW - 60_000).toISOString();
const staleAt = new Date(NOW - 61 * 60_000).toISOString();
const destination = {
  id: "stop-next",
  title: "Test Market Hall",
  placeName: "Test Market Hall",
  address: "1 Test Square",
  latitude: 45.508,
  longitude: -73.553,
  radiusMeters: null
};
const nearLocation = { latitude: 45.509, longitude: -73.554, accuracy: 12, capturedAt: freshAt };
const farLocation = { latitude: 45.273, longitude: -66.063, accuracy: 12, capturedAt: freshAt };
const verifiedGate = resolveDirectionsLocationGate({
  permission: "granted", location: nearLocation, destination, nowMs: NOW
});
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

// ---- Day label + trip identity ----
check("day label matches mock form (Day 1 · Mon, Oct 26)", "FIXTURE",
  formatDirectionsDayLabel(1, "2026-10-26") === "Day 1 · Mon, Oct 26",
  formatDirectionsDayLabel(1, "2026-10-26"));
check("day label degrades on bad date, never guesses", "FIXTURE",
  formatDirectionsDayLabel(1, "not-a-date") === "Day 1" && formatDirectionsDayLabel(null, null) === "Day");
check("trip identity carries destination + dates + origin", "FIXTURE",
  formatTripIdentity({ destinationLabel: "Montreal, Canada", startDate: "2026-10-26", endDate: "2026-10-30", originLabel: "Saint John" }) ===
    "Montreal, Canada · Oct 26, 2026 – Oct 30, 2026 · From Saint John");
check("trip identity omits unknown origin, never prints undefined/null", "FIXTURE",
  (() => { const s = formatTripIdentity({ destinationLabel: "Montreal, Canada", startDate: "2026-10-26", endDate: null, originLabel: null }); return s === "Montreal, Canada · Oct 26, 2026" && !/undefined|null/.test(s); })());

// ---- Location gate (boundary 3) ----
check("gate verifies granted + fresh + near location", "FIXTURE",
  verifiedGate.state === "verified" && verifiedGate.origin === nearLocation,
  JSON.stringify({ state: verifiedGate.state }));
check("gate refuses denied permission and returns no origin", "FIXTURE",
  (() => { const g = resolveDirectionsLocationGate({ permission: "denied", location: nearLocation, destination, nowMs: NOW }); return g.state === "location_needed" && g.reason === "permission" && !("origin" in g); })());
check("gate refuses stale reading (61 min old)", "FIXTURE",
  resolveDirectionsLocationGate({ permission: "granted", location: { ...nearLocation, capturedAt: staleAt }, destination, nowMs: NOW }).reason === "stale");
check("gate refuses missing location", "FIXTURE",
  resolveDirectionsLocationGate({ permission: "granted", location: null, destination, nowMs: NOW }).reason === "unavailable");
check("gate refuses destination without coordinates", "FIXTURE",
  resolveDirectionsLocationGate({ permission: "granted", location: nearLocation, destination: { ...destination, latitude: null, longitude: null }, nowMs: NOW }).reason === "destination_coordinates_missing");
check("gate refuses far location (outside destination area)", "FIXTURE",
  resolveDirectionsLocationGate({ permission: "granted", location: farLocation, destination, nowMs: NOW }).reason === "too_far");
check("gate accepts 9-min-old reading, refuses 11-min-old reading", "FIXTURE",
  resolveDirectionsLocationGate({ permission: "granted", location: { ...nearLocation, capturedAt: new Date(NOW - 9 * 60_000).toISOString() }, destination, nowMs: NOW }).state === "verified" &&
  resolveDirectionsLocationGate({ permission: "granted", location: { ...nearLocation, capturedAt: new Date(NOW - 11 * 60_000).toISOString() }, destination, nowMs: NOW }).state === "location_needed");

// ---- Walk summary: real sources only ----
check("live verified duration wins, rendered without (est.)", "FIXTURE",
  (() => { const s = resolveWalkSummary({ mode: "walking", liveRoute: { status: "verified", provider: "google_distance_matrix", mode: "walking", durationMinutes: 12, retrievedAt: new Date().toISOString(), mapsUrl: "" }, destinationId: "stop-next" }); return s.durationMinutes === 12 && s.durationLabel === "12 min" && s.durationKind === "live"; })());
check("grounded estimate duration renders as estimated (est. in UI)", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: groundedEstimate, originItemId: "stop-prev", destinationId: "stop-next" }); return s.durationMinutes === 25 && s.durationKind === "estimated" && s.distanceMeters === 800 && s.distanceLabel === "800 m"; })(),
  JSON.stringify(resolveWalkSummary({ routeEvidence: groundedEstimate, originItemId: "stop-prev", destinationId: "stop-next" })));
check("authoritative evidence renders verified, not estimated", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: { ...groundedEstimate, authority: "AUTHORITATIVE_ROUTE" }, originItemId: "stop-prev", destinationId: "stop-next" }); return s.durationKind === "verified"; })());
check("mismatched evidence ignored (per-leg isolation)", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: groundedEstimate, originItemId: "stop-other", destinationId: "stop-next" }); return s.durationMinutes === null && s.distanceMeters === null; })());
check("evidence without a known origin leg is ignored", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: groundedEstimate, originItemId: null, destinationId: "stop-next" }); return s.durationMinutes === null; })());
check("ungrounded evidence (no duration source) gives no duration", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: { ...groundedEstimate, durationSource: null }, originItemId: "stop-prev", destinationId: "stop-next" }); return s.durationMinutes === null && s.durationKind === null; })());
check("geodesic straight line is NEVER shown as walking distance", "FIXTURE",
  (() => { const s = resolveWalkSummary({ routeEvidence: geodesicOnly, originItemId: "stop-prev", destinationId: "stop-next" }); return s.distanceMeters === null && s.distanceLabel === null && s.distanceExcludedAsStraightLine === true && s.durationMinutes === 25; })());
check("no sources gives unavailable duration and distance", "FIXTURE",
  (() => { const s = resolveWalkSummary({ destinationId: "stop-next" }); return s.durationMinutes === null && s.distanceMeters === null; })());
check("duration formatting: 45 min / 1 hr / 1 hr 30 min", "FIXTURE",
  formatDurationMinutes(45) === "45 min" && formatDurationMinutes(60) === "1 hr" && formatDurationMinutes(90) === "1 hr 30 min");
check("distance formatting: 850 m / 1.5 km / 12 km", "FIXTURE",
  formatDistanceMeters(850) === "850 m" && formatDistanceMeters(1500) === "1.5 km" && formatDistanceMeters(12000) === "12 km");

// ---- Open in Maps: real destination only; origin only when verified ----
check("maps links use real destination coords, no origin when unverified", "FIXTURE",
  (() => { const l = buildDirectionsMapsLinks({ destination, verifiedOrigin: null, mode: "walking" }); return l.available && l.google.includes("destination=45.508%2C-73.553") && l.google.includes("travelmode=walking") && !l.google.includes("origin=") && !l.apple.includes("saddr=") && !l.citymapper.includes("startcoord="); })());
check("maps links add origin ONLY from a verified gate", "FIXTURE",
  (() => { const l = buildDirectionsMapsLinks({ destination, verifiedOrigin: verifiedGate.state === "verified" ? verifiedGate.origin : null, mode: "walking" }); return l.google.includes("origin=45.509%2C-73.554") && l.apple.includes("saddr=45.509%2C-73.554") && l.citymapper.includes("startcoord=45.509%2C-73.554"); })(),
  buildDirectionsMapsLinks({ destination, verifiedOrigin: verifiedGate.state === "verified" ? verifiedGate.origin : null, mode: "walking" }).google);
check("maps links fall back to place name when coords missing", "FIXTURE",
  (() => { const l = buildDirectionsMapsLinks({ destination: { id: "x", title: "Test Market Hall", latitude: null, longitude: null }, verifiedOrigin: null, mode: "walking" }); return l.available && l.google.includes("destination=Test+Market+Hall") && l.citymapper.includes("endaddress=Test+Market+Hall"); })());
check("maps links unavailable when destination carries nothing", "FIXTURE",
  (() => { const l = buildDirectionsMapsLinks({ destination: { id: "x", title: "", latitude: null, longitude: null }, verifiedOrigin: null }); return !l.available && l.primary === ""; })());
check("per-trip isolation: two trips get different Maps URLs, no cross-leak", "FIXTURE",
  (() => {
    const a = buildDirectionsMapsLinks({ destination, verifiedOrigin: null });
    const b = buildDirectionsMapsLinks({ destination: { id: "other", title: "Other Place", placeName: "Other Place", latitude: 48.8566, longitude: 2.3522 }, verifiedOrigin: null });
    return a.google !== b.google && !a.google.includes("Other") && !b.google.includes("Test%20Market") && !b.google.includes("45.508");
  })());

// ---- Steps: location-gated, producer-only ----
const sampleSteps = [
  { instruction: "Head east on Test Street", distanceMeters: 200 },
  { instruction: "Turn right onto Second Street", distanceMeters: 300 }
];
check("steps blocked without verified location, even when steps exist", "FIXTURE",
  (() => { const s = resolveDirectionsSteps({ gate: resolveDirectionsLocationGate({ permission: "prompt", location: null, destination, nowMs: NOW }), steps: sampleSteps }); return s.state === "location_needed" && s.steps.length === 0; })());
check("steps unavailable when verified but no producer exists (today's state)", "FIXTURE",
  (() => { const s = resolveDirectionsSteps({ gate: verifiedGate, steps: null }); return s.state === "steps_unavailable" && s.steps.length === 0; })());
check("steps render verbatim from a real producer when verified", "FIXTURE",
  (() => { const s = resolveDirectionsSteps({ gate: verifiedGate, steps: sampleSteps }); return s.state === "ready" && s.steps[0].instruction === "Head east on Test Street" && s.steps[0].distanceMeters === 200; })());
check("empty instructions dropped, negative distances nulled — never repaired", "FIXTURE",
  (() => { const s = resolveDirectionsSteps({ gate: verifiedGate, steps: [{ instruction: "  ", distanceMeters: 5 }, { instruction: "Keep going", distanceMeters: -10 }] }); return s.state === "ready" && s.steps.length === 1 && s.steps[0].distanceMeters === null; })());

// ---- STATIC: component structure + honesty ----
const panel = read("components/trip/DirectionsPanel.tsx");
const lib = read("lib/roamly/directionsPanel.ts");
const live = read("components/trip/LiveTripClient.tsx");
check("panel renders mock structure: header + day + steps + show-all + Open in Maps", "STATIC",
  panel.includes("Getting to your next stop") && panel.includes("Step-by-step directions") &&
  panel.includes("Show all directions") && panel.includes("Show fewer directions") && panel.includes("Open in Maps"));
check("panel renders honest map-unavailable state, never a map", "STATIC",
  // Repair round P3: the old "Map preview unavailable" banner is
  // gone — the honest state is now the summary Route row ("Live
  // routing opens in your maps app") plus the single Open in Maps
  // action. Still never a map element, image, or tile URL.
  panel.includes("Live routing opens in your maps app") &&
  !panel.includes("<img") && !panel.includes("staticmap") && !panel.includes("tile.openstreetmap"));
check("panel renders location-needed state with a retry action", "STATIC",
  panel.includes("Location needed for directions") && panel.includes("Use my current location"));
check("panel renders steps-unavailable state pointing at Maps", "STATIC",
  panel.includes("aren") && panel.includes("turn-by-turn directions"));
check("panel never asserts terrain/sidewalk claims", "STATIC",
  panel.includes("Terrain and sidewalk details aren") && !panel.includes("Mostly flat") && !panel.includes("Sidewalks available"));
check("panel carries trip identity (data-trip-id) and uses calm tokens, no black", "STATIC",
  panel.includes("data-trip-id") && panel.includes("bg-cbg") && panel.includes("text-chead") &&
  panel.includes("bg-cblue") && !panel.includes("bg-black") && !panel.includes("text-black"));
check("panel show-all renders only when it acts (no dead button)", "STATIC",
  // Conditional-acceptance item 5: the disabled Show-all control is
  // gone; the toggle renders only when it acts. The 4-step initial
  // view rule is unchanged.
  !panel.includes("disabled={!hasMoreSteps") &&
  panel.includes("hasMoreSteps || showAll") &&
  panel.includes("INITIAL_VISIBLE_STEPS = 4"));
// Acceptance-review round (2026-10-28), consequential to the item-2
// unverified fix ONLY: the Arrive row now renders {displayTitle}
// instead of {placeTitle}. Intent UNCHANGED — this still proves the
// start/arrive rows exist only in the ready branch (after
// steps_unavailable). displayTitle equals placeTitle for every
// verified stop and "Unverified stop" only for unverified stops, so
// no verified-stop rendering changes; the literal is updated to the
// new rendering variable, not dropped.
check("panel start/arrive rows exist only in the ready branch", "STATIC",
  panel.includes("Start from your current location") && panel.includes("Arrive at {displayTitle}") &&
  panel.includes('const displayTitle = props.unverified ? "Unverified stop" : placeTitle') &&
  panel.indexOf("Start from your current location") > panel.indexOf("steps_unavailable"));
check("NO mock literals in the new files (no copied mock values)", "STATIC",
  !/Rue Saint-Paul|Rue Berri|Marché Sainte-Anne|Sainte-Anne|Mostly flat|Sidewalks available|600 m|8 min/.test(lib + panel));
check("forbidden files untouched by this panel (no DirectionsPanel import)", "STATIC",
  !read("lib/itinerary.ts").includes("DirectionsPanel") && !read("lib/roamly/socialReelGenerator.ts").includes("DirectionsPanel"));
check("LiveTripClient mounts the panel additively for the next stop only", "STATIC",
  live.includes("DirectionsPanel") && live.includes("Getting to your next stop") &&
  live.includes("location={usableLocation}") && live.includes("liveRoute={model.route}") &&
  live.includes("steps={null}") && live.includes("routeEvidence={null}") &&
  live.includes("showDirectionsPanel"));
check("LiveTripClient keeps its existing Directions link row untouched", "STATIC",
  live.includes("hasDirectionLinks && directionsHref") && live.includes(">Directions<"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name} — ${f.detail}`);
  process.exit(1);
}
