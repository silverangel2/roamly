// roamly-ux-round2a-evidence-checks.mjs — ROUND 2 builder A proof:
// the four evidence boundaries for false proximity (C1) and timing
// honesty (C2). Run under both TZ=America/Moncton and TZ=UTC; every
// assertion uses explicit timestamps, so the result is timezone-free.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-round2a-evidence-checks.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateLocationEvidence, locationEvidenceFromSettingsRow, containsAffirmativeNearClaim } from "../lib/roamly/locationEvidence.ts";
import { notificationProximityCopy } from "../lib/roamly/itineraryPresentation.ts";
import { timingDisplay } from "../lib/roamly/liveTimingDisplay.ts";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- C1: one location-evidence source ----------
const NOW = Date.parse("2026-10-26T15:00:00Z");
const FRESH = new Date(NOW - 5 * 60_000).toISOString();
const STALE = new Date(NOW - 60 * 60_000).toISOString();
const MONTREAL = { lat: 45.5045, lon: -73.5561 };

// No coordinates → no "near", across every reason path.
for (const input of [
  { tripActive: true, travelerLatitude: null, travelerLongitude: null, travelerObservedAt: FRESH, destinationLatitude: MONTREAL.lat, destinationLongitude: MONTREAL.lon },
  { tripActive: true, travelerLatitude: 45.5, travelerLongitude: -73.55, travelerObservedAt: null, destinationLatitude: MONTREAL.lat, destinationLongitude: MONTREAL.lon },
  { tripActive: false, travelerLatitude: 45.5, travelerLongitude: -73.55, travelerObservedAt: FRESH, destinationLatitude: MONTREAL.lat, destinationLongitude: MONTREAL.lon },
  { tripActive: true, travelerLatitude: 45.5, travelerLongitude: -73.55, travelerObservedAt: FRESH, destinationLatitude: null, destinationLongitude: null }
]) {
  const evidence = evaluateLocationEvidence({ ...input, now: NOW });
  assert.equal(evidence.verified, false, `no near without full evidence: ${evidence.reason}`);
  const copy = notificationProximityCopy("You are near a planned activity. Check in when you arrive.", evidence);
  assert.equal(containsAffirmativeNearClaim(copy), false, `banner never passes a near claim through unverified: ${copy}`);
  assert.equal(notificationProximityCopy("", evidence).includes("near your first planned area"), false);
}
// Stale fix → not verified (10-minute freshness window).
assert.equal(
  evaluateLocationEvidence({ tripActive: true, travelerLatitude: 45.5045, travelerLongitude: -73.5561, travelerObservedAt: STALE, destinationLatitude: MONTREAL.lat, destinationLongitude: MONTREAL.lon, now: NOW }).reason,
  "stale_location"
);
// Too far → not verified, even with fresh coordinates.
assert.equal(
  evaluateLocationEvidence({ tripActive: true, travelerLatitude: 45.0, travelerLongitude: -73.0, travelerObservedAt: FRESH, destinationLatitude: MONTREAL.lat, destinationLongitude: MONTREAL.lon, now: NOW }).reason,
  "too_far"
);
// Verified only when everything holds: active + fresh + within radius.
const verified = evaluateLocationEvidence({ tripActive: true, travelerLatitude: 45.5045, travelerLongitude: -73.5561, travelerObservedAt: FRESH, destinationLatitude: MONTREAL.lat, destinationLongitude: MONTREAL.lon, now: NOW });
assert.equal(verified.verified, true);
assert.equal(verified.reason, "verified");
assert.ok(verified.distanceMeters != null && verified.distanceMeters <= 250);
// Persisted-row mapping: a null row is no evidence, not an error.
assert.equal(locationEvidenceFromSettingsRow(null, { latitude: MONTREAL.lat, longitude: MONTREAL.lon }, true, NOW).verified, false);
assert.equal(
  locationEvidenceFromSettingsRow({ last_seen_latitude: 45.5045, last_seen_longitude: -73.5561, last_seen_at: FRESH }, { latitude: MONTREAL.lat, longitude: MONTREAL.lon }, true, NOW).verified,
  true
);
// Negations are not claims; affirmatives are.
assert.equal(containsAffirmativeNearClaim("Not nearby yet"), false);
assert.equal(containsAffirmativeNearClaim("A planned stop is not nearby, and these are not today’s activities."), false);
assert.equal(containsAffirmativeNearClaim("Your nearby activities are now live."), true);
assert.equal(containsAffirmativeNearClaim("You are near a planned activity."), true);
// Verified evidence may carry the near copy (the claim is now supported).
assert.match(notificationProximityCopy("", { verified: true, reason: "verified" }), /near your first planned area/);
// Pre-trip evidence keeps the honest pre-trip copy.
assert.match(
  notificationProximityCopy("You are near your first planned area.", { verified: false, reason: "trip_not_active" }),
  /Trip has not started/
);

// Both surfaces read the same source (static: the wiring itself).
const notifPage = await read("app/notifications/page.tsx");
const banner = await read("components/roamly/TripActivationBanner.tsx");
const nearbyCard = await read("components/roamly/NearbyActivityCard.tsx");
const upNextCard = await read("components/roamly/UpNextActivityCard.tsx");
const timeline = await read("components/roamly/CurrentDayTimeline.tsx");
const livePage = await read("app/trip/[id]/live/page.tsx");
const liveClient = await read("components/trip/LiveTripClient.tsx");
assert.doesNotMatch(notifPage, /locationEvidenceFromSettingsRow/, "PICTURE 1: Alerts no longer computes proximity evidence (no Nearby card on this screen)");
assert.doesNotMatch(notifPage, /last_seen_latitude,last_seen_longitude,last_seen_at/, "PICTURE 1: Alerts no longer reads traveler coordinates; Live still does (see Live assertions below)");
assert.match(banner, /notificationProximityCopy\(notification\?\.body, locationEvidence\)/, "banner body is gated on evidence, not the calendar");
assert.doesNotMatch(banner, /notificationProximityCopy\(notification\?\.body, tripStarted\)/, "old calendar-only banner call is gone");
assert.match(nearbyCard, /tripStarted && locationVerified/, "Nearby card requires evidence, not just a started trip");
assert.match(upNextCard, /tripStarted && locationVerified/, "Up next eyebrow requires evidence");
assert.match(upNextCard, /tripStarted && locationVerified && activity\.distance_meters/, "distance badge requires evidence");
assert.match(timeline, /activity\.status === "nearby" && !locationVerified \? "planned"/, "timeline badge downgrades stale nearby rows");
assert.match(livePage, /last_seen_latitude,last_seen_longitude,last_seen_at/, "Live reads the same persisted row");
assert.match(livePage, /initialLocation=\{initialLocation\}/, "Live passes the persisted fix to the client");
assert.match(liveClient, /displayStatusFor\(activity\)/, "Live day list gates nearby on evidence");
assert.match(liveClient, /evaluateLocationEvidence\(\{/, "Live uses the shared evidence function");

// ---------- C2: timing honesty ----------
const PLANNED_452 = { countdownMinutes: 452, nextStart: new Date("2026-10-26T17:00:00Z"), timingStatus: "PLANNED", routeVerified: false };
const planned = timingDisplay(PLANNED_452);
assert.equal(planned.main, "About 7h 32m", "planned countdown is labeled estimated (the owner's exact 7h 32m)");
assert.match(planned.basis || "", /Estimated from the planned schedule/);
assert.equal(/\d/.test(planned.travel), false, "unverified travel row shows NO number");
assert.match(planned.travel, /not verified yet/);
const factual = timingDisplay({ countdownMinutes: 452, nextStart: new Date("2026-10-26T17:00:00Z"), timingStatus: "FACTUAL", routeVerified: true, routeDurationMinutes: 12, routeMode: "walking" });
assert.equal(factual.main, "7h 32m", "verified start renders verbatim");
assert.equal(factual.basis, "Verified start time");
assert.equal(factual.travel, "12 min walking from your location", "verified travel time is labeled as travel time");
const absent = timingDisplay({ countdownMinutes: null, nextStart: null, timingStatus: "UNKNOWN", routeVerified: false });
assert.equal(absent.main, "No start time");
assert.equal(absent.hasDuration, false);
assert.equal(/\d/.test(absent.travel), false, "absent start + unverified route: no number anywhere");
const absentVerifiedRoute = timingDisplay({ countdownMinutes: null, nextStart: null, timingStatus: null, routeVerified: true, routeDurationMinutes: 8, routeMode: "transit" });
assert.equal(absentVerifiedRoute.travel, "8 min transit from your location", "a verified route duration may still show, labeled as travel time");
// Conditional-acceptance round, item 1 — the timing helper now carries
// the shared provenance kind, and the Live/Home surfaces render it.
// This REPLACES (does not delete) the old integration assertion that
// the Live client calls timingDisplay({: Picture 4 removed the old NOW
// card that called it, so that assertion has failed ever since — the
// new assertion is stricter, because it requires a provenance label on
// every rendered time, not just a helper call on one row.
assert.equal(planned.provenance, "estimated", "schedule-derived countdown is Estimated provenance");
assert.equal(factual.provenance, "confirmed", "FACTUAL (booking-anchored) countdown is Confirmed provenance");
assert.equal(absent.provenance, null, "no start time carries no provenance label");
const provenance = await read("lib/roamly/timeProvenance.ts");
const homePanel = await read("components/trip/ItineraryHomePanel.tsx");
assert.match(provenance, /planned: "Planned"/, "Planned label defined");
assert.match(provenance, /estimated: "Estimated"/, "Estimated label defined");
assert.match(provenance, /live: "Live-updated"/, "Live-updated label defined");
assert.match(provenance, /confirmed: "Confirmed"/, "Confirmed label defined");
assert.doesNotMatch(liveClient, /Times below are your planned times/, "the banner no longer claims the rows are planned times");
assert.match(liveClient, /Times below are estimates unless labeled otherwise/, "banner states the corrected truth: estimates unless labeled otherwise");
assert.match(liveClient, /Live-updated only with a fresh location fix or check-in/, "banner names the evidence gate for Live-updated");
assert.match(liveClient, /TimeProvenanceLabel kind=\{provenanceForPreTripRow\(row\.planned\)\}/, "pre-trip rows label each time Planned or Confirmed");
assert.match(liveClient, /liveDayProvenanceFor\(featuredActivity\)/, "featured row goes through the evidence gate");
assert.match(liveClient, /liveDayProvenanceFor\(activity\)/, "upcoming rows go through the evidence gate");
assert.doesNotMatch(liveClient, /TimeProvenanceLabel kind=\{provenanceForLiveDayRow\(\)\}/, "no unconditional Live-updated label remains on in-progress rows");
assert.match(homePanel, /TimeProvenanceLabel/, "home timeline rows carry a provenance label");
assert.match(homePanel, /provenanceForHomeRow\(row\)/, "home label follows the booked/planned/retimed mapping");
assert.match(homePanel, /isClockTime\(row\.time\)/, "Flexible rows carry no time and no label");
// The old confusion is structurally gone from the Live client.
assert.doesNotMatch(liveClient, /Travel time from your location is still uncertain/, "uncertain-travel copy next to a precise number is gone");
assert.doesNotMatch(liveClient, /timingCopy\(model\.countdownMinutes/, "bare countdown under a Timing label is gone");
// NOTE (was: "countdown row is labeled Next start" / "travel time has
// its own row"): those rows belonged to the Picture-4-removed NOW card
// and have been unassertable since that rebuild — the earlier crash
// used to mask them. The provenance-label assertions above are their
// replacement: no time on Live or Home renders without its kind.

console.log("Roamly UX Round 2A evidence checks passed (C1 false proximity + C2 timing honesty).");
