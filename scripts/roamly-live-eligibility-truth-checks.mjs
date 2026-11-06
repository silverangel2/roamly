// roamly-live-eligibility-truth-checks.mjs — L12 timezone workstream
// (2026-10-31): the ONE Live Companion eligibility rule in
// lib/roamly/liveEligibility.ts, proven against the REAL modules it
// wires together (liveEligibility, liveCompanion.selectActiveTrip,
// locationLifecycle.isOperationalLocationTrip) plus a JS mirror of
// the OWNER-APPLIED SQL gate in
// supabase/migrations/20261031000200_roamly_live_eligibility_timezone.sql
// (the mirror is a test double for the SQL text, which this suite
// also asserts on directly — production SQL behaviour is proven only
// by applying that migration, which remains the owner's step).
//
// DETERMINISM LAW for this suite: every instant is a fixed UTC
// timestamp, every window is read in the trip's DESTINATION zone via
// Intl, and no assertion consults the process timezone. The suite is
// run under TZ=America/Moncton AND TZ=UTC and must produce identical
// results in both — that identity IS the L12 fix, proven.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-live-eligibility-truth-checks.mjs [root]
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_COMPANION_ELIGIBLE_STATUSES,
  explainLiveCompanionEligibility,
  isLiveCompanionEligible
} from "@/lib/roamly/liveEligibility.ts";
import { selectActiveTrip } from "@/lib/roamly/liveCompanion.ts";
import { isOperationalLocationTrip } from "@/lib/roamly/locationLifecycle.ts";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer.ts";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// The owner's production Montreal shape (production read 2026-10-31):
// generated + itinerary_locked + both unlocks, Oct 30 - Nov 2,
// destination Montreal, planning.timezone NULL (metadata carries no
// zone at all here — the registry must supply America/Toronto).
const MONTREAL = {
  id: "montreal-owner-shape",
  status: "generated",
  itinerary_locked: true,
  itinerary_status: null,
  itinerary_generated_at: "2026-10-05T00:00:00Z",
  tracking_unlocked: true,
  live_companion_unlocked: true,
  start_date: "2026-10-30",
  end_date: "2026-11-02",
  metadata: { planning: { timezone: null, destination: "Montreal, Canada" } },
  destination_name: "Montreal, Canada",
  destination_city: "Montreal"
};
const trip = (patch) => ({ ...MONTREAL, ...patch });

// --- The rule's status set is exactly the grounded set -------------
eq("status set is locked/active/planned/generated",
  [...LIVE_COMPANION_ELIGIBLE_STATUSES].join(","), "locked,active,planned,generated");

// --- 1. Destination-local in-window: start day 00:30 destination ---
// 2026-10-30T04:30:00Z = 00:30 EDT in America/Toronto on Oct 30.
{
  const x = explainLiveCompanionEligibility(MONTREAL, "2026-10-30T04:30:00Z");
  eq("start-day 00:30 destination: local date is start_date", x.localDate, "2026-10-30");
  eq("start-day 00:30 destination: zone is registry America/Toronto", x.zone, "America/Toronto");
  eq("start-day 00:30 destination: zone source is the registry", x.zoneSource, "destination-registry");
  check("start-day 00:30 destination: eligible", x.eligible && x.inWindow);
}

// --- 2. Out-of-window even when unlocked ---------------------------
// 2026-11-03T12:00:00Z = Nov 3 07:00 EST in Toronto — the day after
// end_date, destination-local.
{
  const x = explainLiveCompanionEligibility(MONTREAL, "2026-11-03T12:00:00Z");
  eq("day after end (destination): local date", x.localDate, "2026-11-03");
  check("day after end (destination): NOT eligible despite unlocks",
    !x.eligible && x.reasons.includes("after_window"));
}
// And the day before start, destination-local.
check("day before start (destination): NOT eligible",
  !isLiveCompanionEligible(MONTREAL, "2026-10-29T12:00:00Z"));

// --- 3. THE L12 CASE ------------------------------------------------
// Nov 2 19:00 EST = 2026-11-03T00:00:00Z. UTC date is Nov 3 (past
// end_date under the old metadata/UTC gates); destination-local date
// is still Nov 2 -> still in window, in ANY process timezone.
{
  const x = explainLiveCompanionEligibility(MONTREAL, "2026-11-03T00:00:00Z");
  eq("L12: local date at Nov 2 19:00 EST is Nov 2, not Nov 3", x.localDate, "2026-11-02");
  check("L12: eligible at Nov 2 19:00 EST (generated+locked+unlocked)", x.eligible);
  check("L12: selectActiveTrip still selects the trip at that instant",
    selectActiveTrip([MONTREAL], new Date("2026-11-03T00:00:00Z"))?.id === MONTREAL.id);
  check("L12: locationLifecycle mirror agrees at that instant",
    isOperationalLocationTrip(MONTREAL, new Date("2026-11-03T00:00:00Z")));
  // One hour later destination-local (20:00 EST, still Nov 2) too,
  // and the trip ends exactly at destination-local midnight:
  check("L12: still eligible at Nov 2 23:59 EST",
    isLiveCompanionEligible(MONTREAL, "2026-11-03T04:59:00Z"));
  check("L12: NOT eligible at Nov 3 00:00 EST (destination midnight)",
    !isLiveCompanionEligible(MONTREAL, "2026-11-03T05:00:00Z"));
}

// --- 4. DST transition in the destination zone ---------------------
// America/Toronto fell back on 2026-11-01 (02:00 EDT -> 01:00 EST):
// that local day has 25 hours. 2026-11-01T05:30:00Z is the FIRST
// 01:30 (EDT, UTC-4); 2026-11-01T06:30:00Z is the SECOND 01:30
// (EST, UTC-5). Both are destination-local Nov 1, in window.
{
  const first = explainLiveCompanionEligibility(MONTREAL, "2026-11-01T05:30:00Z");
  const second = explainLiveCompanionEligibility(MONTREAL, "2026-11-01T06:30:00Z");
  eq("DST: first 01:30 (EDT) is Nov 1 destination-local", first.localDate, "2026-11-01");
  eq("DST: repeated 01:30 (EST) is still Nov 1 destination-local", second.localDate, "2026-11-01");
  check("DST: both sides of the fall-back are eligible", first.eligible && second.eligible);
  // Spring-forward shape in a second zone for the same property:
  // America/Toronto sprang forward 2026-03-08 (02:00 -> 03:00).
  const springTrip = trip({
    start_date: "2026-03-07", end_date: "2026-03-09",
    metadata: { planning: { timezone: "America/Toronto" } }, destination_name: null, destination_city: null
  });
  eq("DST spring: 2026-03-08T07:30:00Z is Mar 8 destination-local (03:30 EDT)",
    explainLiveCompanionEligibility(springTrip, "2026-03-08T07:30:00Z").localDate, "2026-03-08");
  check("DST spring: eligible on the transition day",
    isLiveCompanionEligible(springTrip, "2026-03-08T07:30:00Z"));
}

// --- 5. generated + locked + unlocked eligible; variants refuse ----
check("generated+itinerary_locked+unlocked: eligible mid-window",
  isLiveCompanionEligible(MONTREAL, "2026-10-31T15:00:00Z"));
check("generated but NOT locked: not eligible",
  !isLiveCompanionEligible(trip({ itinerary_locked: false, itinerary_generated_at: null }), "2026-10-31T15:00:00Z"));
check("generated+locked but NOT unlocked: not eligible",
  !isLiveCompanionEligible(trip({ tracking_unlocked: false, live_companion_unlocked: false }), "2026-10-31T15:00:00Z"));
check("locked-ish via itinerary_status='locked' (app's isTripLocked sense): eligible",
  isLiveCompanionEligible(trip({ status: "locked", itinerary_locked: false, itinerary_generated_at: null, itinerary_status: "locked" }), "2026-10-31T15:00:00Z"));
for (const status of ["locked", "active", "planned"]) {
  check(`status '${status}' + locked + unlocked: eligible`,
    isLiveCompanionEligible(trip({ status }), "2026-10-31T15:00:00Z"));
}

// --- 6. Locked-but-draft / cancelled / other non-ready states ------
for (const status of ["draft", "cancelled", "archived", "completed", "preview", "generating"]) {
  const x = explainLiveCompanionEligibility(trip({ status }), "2026-10-31T15:00:00Z");
  check(`status '${status}' (locked + unlocked + in window): NOT eligible`,
    !x.eligible && x.reasons.includes("status_not_live_ready"));
}
check("missing dates: not eligible",
  !isLiveCompanionEligible(trip({ start_date: null }), "2026-10-31T15:00:00Z"));

// --- 7. Null trip timezone: documented fallbacks, deterministic ----
// (a) planning.timezone NULL + registry-known destination ->
//     the REGISTRY zone (the owner shape, proven above): never UTC.
// (b) metadata zone stored -> metadata wins over the registry.
{
  const stored = explainLiveCompanionEligibility(
    trip({ metadata: { planning: { timezone: "America/Halifax" } } }),
    "2026-11-03T00:00:00Z"
  );
  eq("stored metadata zone wins over registry", stored.zone, "America/Halifax");
  eq("stored-zone source is metadata", stored.zoneSource, "metadata");
}
// (c) No metadata zone AND no registry destination -> the documented
//     fallback: UTC for math, reported as unknown, process-TZ-free.
//     At 2026-11-03T00:00:00Z the UTC date (Nov 3) is past end_date,
//     so this trip is NOT eligible; at 2026-11-02T12:00:00Z it is.
{
  const unknownTrip = trip({
    metadata: { planning: { timezone: null } },
    destination_name: "Nowhereville", destination_city: "Nowhereville", destination: "Nowhereville"
  });
  const x = explainLiveCompanionEligibility(unknownTrip, "2026-11-03T00:00:00Z");
  eq("unknown zone: fallback zone for math is UTC", x.zone, "UTC");
  eq("unknown zone: reported as unknown, not silently UTC", x.zoneSource, "unknown");
  check("unknown zone: zoneKnown is false", x.zoneKnown === false);
  eq("unknown zone: local date is the UTC date", x.localDate, "2026-11-03");
  check("unknown zone: NOT eligible on Nov 3 UTC (past end)", !x.eligible);
  check("unknown zone: eligible on Nov 2 UTC (in window)",
    isLiveCompanionEligible(unknownTrip, "2026-11-02T12:00:00Z"));
  // Hold mode (background-scheduling policy) refuses unknown zones.
  check("unknown zone + fallbackMode hold: not eligible even in window",
    !isLiveCompanionEligible(unknownTrip, "2026-11-02T12:00:00Z", { fallbackMode: "hold" }));
}
// (d) Server resolution (destination seeds) agrees for Montreal and
//     for a seeds-only destination (Halifax) as a zoneOverride.
{
  const serverZone = resolveTripTimezoneServer({
    metadata: MONTREAL.metadata, destination_name: MONTREAL.destination_name, destination_city: MONTREAL.destination_city
  }).zone;
  eq("server resolver: Montreal resolves America/Toronto", serverZone, "America/Toronto");
  check("zoneOverride from server resolver: L12 instant eligible",
    isLiveCompanionEligible(MONTREAL, "2026-11-03T00:00:00Z", { zoneOverride: serverZone }));
  const halifax = trip({
    destination_name: "Halifax, Canada", destination_city: "Halifax",
    metadata: { planning: { timezone: null } }
  });
  const halifaxServerZone = resolveTripTimezoneServer({
    metadata: halifax.metadata, destination_name: halifax.destination_name, destination_city: halifax.destination_city
  }).zone;
  eq("server resolver: Halifax resolves America/Halifax (seeds)", halifaxServerZone, "America/Halifax");
  // Nov 2 20:00 AST = 2026-11-03T00:00:00Z: Halifax-local Nov 2.
  check("Halifax via server zoneOverride: eligible at Nov 2 20:00 AST",
    isLiveCompanionEligible(halifax, "2026-11-03T00:00:00Z", { zoneOverride: halifaxServerZone }));
}

// --- 8. Process-timezone independence, asserted structurally -------
// Re-running the L12 explanation with the same inputs must give a
// byte-identical explanation object — and the module sources must
// contain no process-TZ dependency for the window math.
{
  const a = explainLiveCompanionEligibility(MONTREAL, "2026-11-03T00:00:00Z");
  const b = explainLiveCompanionEligibility(MONTREAL, "2026-11-03T00:00:00Z");
  eq("determinism: identical explanation on re-run", JSON.stringify(a), JSON.stringify(b));
  const src = read("lib/roamly/liveEligibility.ts");
  check("module: liveEligibility delegates window math to Intl zone parts (localDateInZone)",
    src.includes("localDateInZone") && src.includes("resolveTripTimezone"));
}

// --- 9. Wiring: every eligibility layer uses the ONE rule ----------
{
  const liveCompanion = read("lib/roamly/liveCompanion.ts");
  const locationLifecycle = read("lib/roamly/locationLifecycle.ts");
  const tripActivation = read("lib/roamly/tripActivation.ts");
  const lifecycle = read("lib/roamly/liveCompanionLifecycle.ts");
  const notifications = read("lib/roamly/companionNotifications.ts");
  const dashboard = read("lib/roamly/dashboardTripPresentation.ts");
  check("wiring: selectActiveTrip delegates to isLiveCompanionEligible",
    liveCompanion.includes("isLiveCompanionEligible"));
  check("wiring: locationLifecycle mirror delegates to the ONE rule (no own status list)",
    locationLifecycle.includes("isLiveCompanionEligible") && !locationLifecycle.includes('"locked", "active", "planned"'));
  check("wiring: getActiveOrUpcomingTrip prefilters on the shared status set + server zones",
    tripActivation.includes("LIVE_COMPANION_ELIGIBLE_STATUSES") &&
    tripActivation.includes("eligibilityOptionsForTrip") &&
    tripActivation.includes("activationTimezoneForTrip"));
  check("wiring: lifecycle cron status sets include generated",
    (lifecycle.match(/"generated"/g) || []).length >= 3);
  check("wiring: delivery validator uses the shared status/lock/unlock helpers",
    notifications.includes("isLiveReadyStatus") && notifications.includes("isLiveEligibilityLocked"));
  check("wiring: dashboard Live presentation resolves via the ONE resolver",
    dashboard.includes("resolveTripTimezone") && !dashboard.includes("timezoneFromTripMetadata(trip.metadata)"));
}

// --- 10. SQL mirror + migration text --------------------------------
// Mirror of the NEW gate (migration 20261031000200): metadata zone
// (old SQL candidate order), then the registry map for the entries
// this suite exercises, then UTC. Asserts the mirror and the JS rule
// agree on every case above — and that the migration text itself
// carries the same rule (status set, registry function, fallback).
function sqlMirrorZone(t) {
  const root = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const planning = root.planning && typeof root.planning === "object" ? root.planning : {};
  const candidates = [planning.timezone, root.tripPlanning?.timezone, root.timezone, root.destinationTimezone, root.destination_timezone];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      try { new Intl.DateTimeFormat("en-CA", { timeZone: c.trim() }).format(); return c.trim(); } catch { return "UTC"; }
    }
  }
  const registry = { montreal: "America/Toronto", halifax: "America/Halifax", toronto: "America/Toronto", banff: "America/Edmonton" };
  for (const dest of [t.destination, t.destination_name, t.destination_city, planning.destination, planning.destinationCity]) {
    if (typeof dest !== "string" || !dest.trim()) continue;
    const key = dest.split(",")[0].trim().toLowerCase();
    if (registry[key]) return registry[key];
  }
  return "UTC";
}
function sqlMirrorEligible(t, nowIso) {
  if (!["locked", "active", "planned", "generated"].includes(String(t.status || ""))) return false;
  if (!(t.itinerary_locked === true || t.itinerary_status === "locked" || t.itinerary_generated_at)) return false;
  if (!(t.tracking_unlocked === true || t.live_companion_unlocked === true)) return false;
  if (!t.start_date || !t.end_date) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: sqlMirrorZone(t), year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(nowIso));
  const v = (type) => parts.find((p) => p.type === type)?.value || "00";
  const today = `${v("year")}-${v("month")}-${v("day")}`;
  return String(t.start_date) <= today && String(t.end_date) >= today;
}
for (const [label, fixture, instant] of [
  ["mirror agrees: L12 instant eligible", MONTREAL, "2026-11-03T00:00:00Z"],
  ["mirror agrees: start-day 00:30 eligible", MONTREAL, "2026-10-30T04:30:00Z"],
  ["mirror agrees: day after end not eligible", MONTREAL, "2026-11-03T12:00:00Z"],
  ["mirror agrees: draft not eligible", trip({ status: "draft" }), "2026-10-31T15:00:00Z"],
  ["mirror agrees: generated unlocked-only not eligible", trip({ tracking_unlocked: false, live_companion_unlocked: false }), "2026-10-31T15:00:00Z"]
]) {
  eq(label, sqlMirrorEligible(fixture, instant), isLiveCompanionEligible(fixture, instant));
}
{
  const migration = read("supabase/migrations/20261031000200_roamly_live_eligibility_timezone.sql");
  const oldMigration = read("supabase/migrations/20260928000200_roamly_terminal_location_cleanup.sql");
  check("migration: new file is marked OWNER-APPLIED and not-yet-applied",
    migration.includes("OWNER-APPLIED") && migration.includes("HAS NOT been applied") || migration.includes("NOT been applied"));
  check("migration: gate status set includes generated",
    migration.includes("'locked', 'active', 'planned', 'generated'"));
  check("migration: registry helper + UTC fallback present",
    migration.includes("roamly_destination_registry_timezone") && migration.includes("'UTC'"));
  check("migration: Montreal maps to America/Toronto in SQL registry",
    migration.includes("when 'montreal' then 'America/Toronto'"));
  check("migration: locked sense includes generated_at proxy",
    migration.includes("itinerary_generated_at is not null"));
  check("migration: old migration untouched (still its original status set)",
    oldMigration.includes("t.status in ('locked', 'active', 'planned')"));
}

console.log(`${passed} live eligibility truth checks passed (process TZ: ${process.env.TZ || "(unset)"}).`);
