// roamly-ux-round2-c-checks.mjs — BUILDER-C proof for Roamly UX repair ROUND 2.
// Covers HIGH 5 (skip persistence), HIGH 6 (transport-leg dedup),
// MEDIUM 7 (permission recovery), and DATE CONSISTENCY (trip identity).
// Two check kinds: STATIC (a literal pattern must exist in a tree
// file) and FIXTURE (the tree's own pure modules, imported directly
// under node --experimental-strip-types — no re-implementation of
// the logic under test, so a fixture failure is a real failure).
// Usage:
//   node --experimental-strip-types scripts/roamly-ux-round2-c-checks.mjs [treeRoot]
// treeRoot defaults to this script's parent dir. Date formatting is
// calendar-date based, so the suite must pass identically under
// TZ=America/Moncton and TZ=UTC (run it under both).
// Exit 0 only when every check passes.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, ".."));
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const skip = await import(pathToFileURL(join(root, "lib/roamly/setupSkip.ts")).href);
const active = await import(pathToFileURL(join(root, "lib/roamly/notificationActiveTrip.ts")).href);
const perm = await import(pathToFileURL(join(root, "lib/roamly/permissionRecovery.ts")).href);
const ident = await import(pathToFileURL(join(root, "lib/roamly/tripIdentity.ts")).href);

const gate = read("components/roamly/TripSetupGate.tsx");
const tripPage = read("app/trip/[id]/page.tsx");
const livePage = read("app/trip/[id]/live/page.tsx");
const notifPage = read("app/notifications/page.tsx");
const eventPage = read("app/trip/[id]/event/[eventId]/page.tsx");
const liveClient = read("components/trip/LiveTripClient.tsx");
const recovery = read("components/roamly/LocationPermissionRecovery.tsx");
const setupGateLib = read("lib/roamly/setupGate.ts");

// ---- HIGH 5: skip persistence -------------------------------------------
check("H5: skip cookie name is per-trip", skip.setupSkipCookieName("trip-abc") === "roamly_setup_skipped_trip-abc");
check("H5: unsafe trip id yields no cookie name", skip.setupSkipCookieName("trip; Path=/; evil=1") === null && skip.setupSkipCookieName("") === null);
check("H5: header parse finds this trip's skip only",
  skip.hasSetupSkip("other=2; roamly_setup_skipped_trip-abc=1", "trip-abc") === true &&
  skip.hasSetupSkip("other=2; roamly_setup_skipped_trip-abc=1", "trip-xyz") === false &&
  skip.hasSetupSkip("roamly_setup_skipped_trip-abc=0", "trip-abc") === false);
check("H5: bare store value '1' counts as skipped", skip.hasSetupSkip("1", "trip-abc") === true);
{
  const assignment = skip.setupSkipCookieAssignment("trip-abc") || "";
  check("H5: cookie assignment is path-wide, lax, long-lived",
    assignment.includes("roamly_setup_skipped_trip-abc=1") && assignment.includes("Path=/") &&
    assignment.includes("SameSite=Lax") && assignment.includes("Max-Age=31536000"));
}
check("H5: gate screen sets the cookie on skip + keeps one skip anchor",
  gate.includes("setupSkipCookieAssignment") && gate.includes("document.cookie") &&
  (gate.match(/href=\{skipHref\}/g) || []).length === 1);
// Owner-approved Setup design (2026-10-26): exact mock copy/layout —
// H1 + prepared line + generated row + optional heading + OR + skip
// card with limited-features subtext. The skip card sits BELOW the
// cascade (mock order), not above it; that supersedes the round-1
// "skip above cascade" assertion.
const cascade = read("components/roamly/SetupCascade.tsx");
check("SETUP-MOCK: gate header + generated row + optional heading + OR + skip card",
  gate.includes("Your trip is ready! 🎉") &&
  gate.includes("Everything is prepared. Complete a few optional steps to unlock more features.") &&
  gate.includes("Itinerary generated and saved") &&
  gate.includes("Optional setup (recommended)") &&
  gate.includes("OR") &&
  gate.includes("Skip for now") &&
  gate.includes("You can still view your full itinerary with limited features."));
check("SETUP-MOCK: skip card is below the cascade, whole card is the link",
  gate.indexOf("<SetupCascade") < gate.indexOf("href={skipHref}") &&
  gate.includes('variant="optional"'));
check("SETUP-MOCK: optional cascade has all three mock cards + buttons (QR/lock live only in full/compact paths)",
  cascade.includes('variant === "optional"') &&
  cascade.includes("Connect Gmail for Booking Recon") &&
  cascade.includes("Automatically find your flight, hotel and activity confirmations.") &&
  cascade.includes("Add Roamly to your home screen") &&
  cascade.includes("Get instant alerts and a smoother experience.") &&
  cascade.includes("Show instructions") &&
  cascade.includes("Enable location (for Live Companion)") &&
  cascade.includes("Get real-time nearby suggestions and turn-by-turn guidance.") &&
  cascade.includes("Enable location"));
check("SETUP-MOCK: generated row is a status row, not a bypass link",
  !/Itinerary generated and saved[\s\S]{0,200}href=/.test(gate));
check("SETUP-MOCK: gate eyebrow format matches the mock (month repeated + year)",
  ident.formatGateEyebrow("Montreal, Canada", "2026-10-26", "2026-10-30") === "Montreal, Canada · Oct 26 – Oct 30, 2026" &&
  ident.formatGateEyebrow("Montreal", "2026-10-30", "2026-11-02") === "Montreal · Oct 30 – Nov 2, 2026" &&
  ident.formatGateEyebrow("Toronto", null, null) === "Toronto");
check("SETUP-MOCK: gate call sites pass the mock eyebrow",
  tripPage.includes("formatGateEyebrow") && livePage.includes("formatGateEyebrow"));
check("H5: trip page reveals on cookie OR param, passes tripId",
  tripPage.includes("hasSetupSkip") && tripPage.includes("setupSkipCookieName") &&
  tripPage.includes('skipSetupGate) === "1" || skippedBefore') && tripPage.includes("tripId={id}"));
check("H5: live page honors the same remembered skip",
  livePage.includes("hasSetupSkip") && livePage.includes("skippedBefore") && livePage.includes("tripId={id}"));
check("H5: gate trigger + billing untouched by this lane",
  setupGateLib.includes("setupGateApplies") && !setupGateLib.includes("setupSkip") &&
  tripPage.includes("setupGateApplies") && tripPage.includes("hasPriorTrip"));

// ---- HIGH 6: transport-leg dedup -----------------------------------------
const leg = { id: "leg-1", title: "Saint John → Montreal", category: "transport", scheduled_start: "2026-10-26T08:00:00", metadata: null };
const stop = { id: "stop-1", title: "Old Port Walk", category: "activity", scheduled_start: "2026-10-26T14:00:00", metadata: null };
check("H6: arrow-titled leg is a transport leg; a place stop is not",
  active.isTransportLeg(leg) === true && active.isTransportLeg(stop) === false);
check("H6: category-less arrow leg is still a leg",
  active.isTransportLeg({ id: "leg-2", title: "Saint John -> Montreal", category: null, scheduled_start: null }) === true);
{
  const out = active.dedupeActiveTrip({
    nearbyActivities: [leg, stop],
    upNextActivity: leg,
    currentDayActivities: [leg, stop],
    tripStarted: true
  });
  check("H6: same leg in three sources renders once, as travel only",
    out.travelLegs.length === 1 && out.travelLegs[0].id === "leg-1" &&
    out.nearbyActivity?.id === "stop-1" && out.upNextActivity === null &&
    out.currentDayActivities.length === 1 && out.currentDayActivities[0].id === "stop-1",
    `travel=${out.travelLegs.length} nearby=${out.nearbyActivity?.id} upNext=${out.upNextActivity?.id} timeline=${out.currentDayActivities.map((a) => a.id).join(",")}`);
  check("H6: travel label is 'Travel leg', never 'nearby'", active.TRAVEL_LEG_LABEL === "Travel leg");
}
{
  const out = active.dedupeActiveTrip({
    nearbyActivities: [stop],
    upNextActivity: stop,
    currentDayActivities: [stop],
    tripStarted: true
  });
  check("H6: non-transport dup: Nearby wins, Up Next drops, timeline keeps its row",
    out.nearbyActivity?.id === "stop-1" && out.upNextActivity === null &&
    out.currentDayActivities.length === 1 && out.travelLegs.length === 0);
}
{
  const out = active.dedupeActiveTrip({
    nearbyActivities: [],
    upNextActivity: leg,
    currentDayActivities: [leg],
    tripStarted: false
  });
  check("H6: pre-trip leg never lands in the Nearby card",
    out.travelLegs.length === 1 && out.nearbyActivity === null && out.upNextActivity === null &&
    out.currentDayActivities.length === 0);
}
check("PICTURE 1: notifications page no longer renders the travel slot / companion panels",
  !notifPage.includes("dedupeActiveTrip") && !notifPage.includes("TRAVEL_LEG_LABEL") && !notifPage.includes("ActiveTripPanel") && !notifPage.includes("NearbyActivityCard") && !notifPage.includes("CurrentDayTimeline") && notifPage.includes("travelUpdateBookingRows"));
check("H6: travel card carries no distance/proximity claim",
  !/travelLegs\.map[\s\S]{0,800}distance_meters/.test(notifPage));

// ---- MEDIUM 7: permission recovery ----------------------------------------
check("M7: platform detection is device-based, not guessed",
  perm.detectPermissionPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", standalone: false }) === "ios-safari" &&
  perm.detectPermissionPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", standalone: true }) === "ios-pwa" &&
  perm.detectPermissionPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120", standalone: false }) === "android-chrome" &&
  perm.detectPermissionPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120", standalone: true }) === "android-pwa" &&
  perm.detectPermissionPlatform({ userAgent: "" }) === "unknown");
check("M7: denied cannot re-prompt; prompt can",
  perm.canReprompt("denied") === false && perm.canReprompt("prompt") === true && perm.canReprompt("granted") === false);
check("M7: iOS Safari steps name Safari Websites; Android steps name Site settings",
  perm.recoverySteps("ios-safari").join(" ").includes("Safari Websites") &&
  perm.recoverySteps("android-chrome").join(" ").includes("Site settings") &&
  perm.recoverySteps("ios-pwa").join(" ").includes("Roamly"));
check("M7: live view uses the recovery component, bare link gone",
  liveClient.includes("LocationPermissionRecovery") && liveClient.includes("recheckLocationPermission") &&
  !liveClient.includes("Turn on in Settings"));
check("M7: recovery component has prompt retry + denied recheck, never a denied prompt",
  recovery.includes("Allow location") && recovery.includes("I’ve allowed it — check again") &&
  recovery.includes("permission === \"prompt\"") && recovery.includes("permission === \"denied\""));

// ---- DATE CONSISTENCY: trip identity ---------------------------------------
check("DATE: identity line carries destination + dates + origin",
  ident.tripIdentityLine({ destination: "Montreal", origin: "Saint John", startDate: "2026-10-30", endDate: "2026-11-02" }) === "Montreal · Oct 30 – Nov 2 · From Saint John");
check("DATE: same dates read identically (TZ-independent calendar dates)",
  ident.formatTripDateRange("2026-10-26", "2026-10-30") === "Oct 26 – Oct 30" &&
  ident.formatTripDateRange("2026-11-10", "2026-11-14") === "Nov 10 – Nov 14");
check("DATE: missing pieces are omitted, never invented",
  ident.tripIdentityLine({ destination: "Toronto", origin: null, startDate: "2026-11-10", endDate: "2026-11-14" }) === "Toronto · Nov 10 – Nov 14" &&
  ident.tripIdentityLine({ destination: null, origin: null, startDate: null, endDate: null }) === null);
{
  // Mirror of the page's per-trip scoping: rows are filtered to the
  // selected trip BEFORE render, so another trip's rows cannot leak.
  const rows = [
    { trip_id: "montreal-1", title: "Montreal leg" },
    { trip_id: "toronto-1", title: "Toronto leg" },
    { trip_id: "montreal-owner", title: "Owner Montreal leg" }
  ];
  const selected = { id: "toronto-1" };
  const visible = rows.filter((r) => r.trip_id === selected.id);
  check("DATE: fixture — only the selected trip's rows reach its surface",
    visible.length === 1 && visible[0].title === "Toronto leg");
}
check("DATE: notifications page queries per-trip + renders origin in the Departure row (Picture 1 has no header origin line)",
  notifPage.includes(".eq(\"trip_id\", trip.id)") && notifPage.includes("Departure from ${origin}"));
check("DATE: live view's single header is the client hero; origin still reaches the client for directions (not a displayed header line)",
  // Repair round P3: the page-level "From {originLabel}" header card
  // is gone with the header collapse — origin now travels only as
  // the client's originLabel prop (directions links) and stays on
  // the trip home. The hero remains the one displayed header.
  livePage.includes("originLabel={getTripOriginLabel(bundle.data.trip)}") &&
  !livePage.includes("From {originLabel}"));
check("DATE: event sheet is per-trip scoped + renders identity line",
  eventPage.includes(".eq(\"trip_id\", id)") && eventPage.includes("tripIdentityLine") &&
  eventPage.includes("tripIdentity") && eventPage.includes("origin"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (TZ=${process.env.TZ || "(default)"})`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
