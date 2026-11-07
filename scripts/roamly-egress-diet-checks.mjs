// EGRESS DIET (2026-11-02) — behavioral proof for F1/F2/F3/F4.
// Real diet sources compiled via the repo's vm harness; every query
// runs against the instrumented fake (roamly-egress-diet-fake.mjs),
// which counts queries + response body bytes. Each gate is proven
// both ways: (a) no work -> exit after the cheap checks with zero
// heavy reads, (b) work present -> the lane proceeds normally.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { FakeDb } from "./roamly-egress-diet-fake.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function compileTs(rel, stubs) {
  const compiled = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sandbox = {
    exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map, structuredClone,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
      return require(id);
    }
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: rel });
  return sandbox.module.exports;
}

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed += 1; console.log(`ok - ${name}`); }
function eq(name, a, b) { assert.equal(a, b, `${name} (got ${JSON.stringify(a)})`); passed += 1; console.log(`ok - ${name}`); }

const NOW = new Date("2026-11-02T15:00:00.000Z");
const iso = (d) => d.toISOString();
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

/* ---------------- F2: workGate primitives ---------------- */
const workGate = compileTs("lib/roamly/workGate.ts", {});
{
  const db = new FakeDb({ roamly_trips: [{ id: "t1" }, { id: "t2" }] });
  eq("gate: counts rows", await workGate.countWorkRows(db, "roamly_trips", (q) => q.eq("id", "t1")), 1);
  eq("gate: zero when empty", await workGate.countWorkRows(db, "roamly_trips", (q) => q.eq("id", "nope")), 0);
  const failing = { from: () => ({ select: () => ({ then: (res) => res({ count: null, error: { message: "boom" } }) }) }) };
  eq("gate: error -> null (fail-open signal)", await workGate.countWorkRows(failing, "roamly_trips", (q) => q), null);
  eq("gate: anyWorkPresent treats null as work", workGate.anyWorkPresent([0, null]), true);
  eq("gate: anyWorkPresent all zero -> no work", workGate.anyWorkPresent([0, 0]), false);
  eq("gate: count queries carry no body bytes", db.totalBytes(), 0);
}

/* ---------------- F2: generation sweeper gate ---------------- */
const generationWorkGate = compileTs("lib/roamly/generationWorkGate.ts", {
  "@/lib/roamly/workGate": workGate
});
{
  const empty = new FakeDb({ roamly_trip_generation_jobs: [], roamly_trips: [], roamly_communication_ledger: [] });
  eq("gen gate: idle fleet -> no work", await generationWorkGate.generationSweeperHasWork(empty, NOW), false);
  eq("gen gate: idle exit used only count queries", empty.log.every((e) => e.kind === "count"), true);
  eq("gen gate: idle exit zero heavy reads", empty.heavyReads().length, 0);

  const dueWaiting = new FakeDb({
    roamly_trip_generation_jobs: [{ id: "j1", status: "waiting", next_attempt_at: iso(new Date(NOW.getTime() - 60_000)) }],
    roamly_trips: [], roamly_communication_ledger: []
  });
  eq("gen gate: due waiting job -> work", await generationWorkGate.generationSweeperHasWork(dueWaiting, NOW), true);

  const futureWaiting = new FakeDb({
    roamly_trip_generation_jobs: [{ id: "j1", status: "waiting", next_attempt_at: iso(new Date(NOW.getTime() + 3_600_000)) }],
    roamly_trips: [], roamly_communication_ledger: []
  });
  eq("gen gate: waiting job inside backoff -> not work yet", await generationWorkGate.generationSweeperHasWork(futureWaiting, NOW), false);

  const stranded = new FakeDb({
    roamly_trip_generation_jobs: [],
    roamly_trips: [{ id: "t1", status: "generating", itinerary_status: "generating" }],
    roamly_communication_ledger: []
  });
  eq("gen gate: stranded generating trip (KF-2 shape) -> work", await generationWorkGate.generationSweeperHasWork(stranded, NOW), true);

  const ledger = new FakeDb({
    roamly_trip_generation_jobs: [], roamly_trips: [],
    roamly_communication_ledger: [{ id: "c1", status: "pending", scheduled_for: iso(NOW) }]
  });
  eq("gen gate: pending ledger row -> work", await generationWorkGate.generationSweeperHasWork(ledger, NOW), true);
}

/* ---------------- F2: booking monitor gate ---------------- */
const bookingMonitor = compileTs("lib/roamly/bookingMonitor.ts", {
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/emailConnections": { syncGmailConnection: async () => ({}), renewDueGmailWatches: async () => ({}) },
  "@/lib/roamly/liveProviderAdapters": { airportGateAdapter: {}, liveFlightStatusAdapter: {}, recordLiveProviderSnapshot: async () => {} },
  "@/lib/roamly/companionOrchestrator": { processCompanionBookingChange: async () => {} },
  "@/lib/roamly/itineraryBookingOverrides": { applyStoredItineraryBookingOverride: async () => {} },
  "@/lib/roamly/bookingNotificationWithdrawal": { markBookingNotificationsWithdrawn: async () => {} },
  "@/lib/roamly/gmailStalenessDetector": { runGmailStalenessDetector: async () => ({}) },
  "@/lib/roamly/observabilityDetectorDiagnostics": { detectorFailureResult: () => ({}), recordBackgroundDetectorFailure: async () => {} },
  "@/lib/roamly/workGate": workGate
});
{
  const empty = new FakeDb({ email_connections: [], email_watch_subscriptions: [], roamly_bookings: [] });
  eq("booking gate: nothing due -> no work", await bookingMonitor.bookingMonitorHasWork(empty, NOW), false);
  eq("booking gate: only count queries", empty.log.every((e) => e.kind === "count"), true);

  const dueConnection = new FakeDb({
    email_connections: [{ id: "e1", provider: "gmail", connection_status: "connected", last_synced_at: iso(new Date(NOW.getTime() - 3_600_000)) }],
    email_watch_subscriptions: [], roamly_bookings: []
  });
  eq("booking gate: due gmail connection -> work", await bookingMonitor.bookingMonitorHasWork(dueConnection, NOW), true);

  const freshConnection = new FakeDb({
    email_connections: [{ id: "e1", provider: "gmail", connection_status: "connected", last_synced_at: iso(new Date(NOW.getTime() - 60_000)) }],
    email_watch_subscriptions: [], roamly_bookings: []
  });
  eq("booking gate: freshly synced connection -> no work", await bookingMonitor.bookingMonitorHasWork(freshConnection, NOW), false);

  const flight = new FakeDb({
    email_connections: [], email_watch_subscriptions: [],
    roamly_bookings: [{ id: "b1", booking_type: "flight", booking_status: "booked", trip_id: "t1", superseded_by_booking_id: null, flight_number: "AC123", start_at: iso(new Date(NOW.getTime() + 24 * 3_600_000)) }]
  });
  eq("booking gate: flight inside window -> work", await bookingMonitor.bookingMonitorHasWork(flight, NOW), true);

  const farFlight = new FakeDb({
    email_connections: [], email_watch_subscriptions: [],
    roamly_bookings: [{ id: "b1", booking_type: "flight", booking_status: "booked", trip_id: "t1", superseded_by_booking_id: null, flight_number: "AC123", start_at: iso(new Date(NOW.getTime() + 10 * 86_400_000)) }]
  });
  eq("booking gate: flight outside window -> no work", await bookingMonitor.bookingMonitorHasWork(farFlight, NOW), false);

  const watch = new FakeDb({
    email_connections: [],
    email_watch_subscriptions: [{ id: "w1", provider: "gmail", status: "active", expiration_time: iso(new Date(NOW.getTime() + 3_600_000)) }],
    roamly_bookings: []
  });
  eq("booking gate: watch expiring within horizon -> work", await bookingMonitor.bookingMonitorHasWork(watch, NOW), true);
}

/* ---------------- F2+F4: live companion gate + projections + single read ---------------- */
const tripTimezone = compileTs("lib/roamly/tripTimezone.ts", {
  "@/lib/roamly/places": { recommendedPlaces: [] }
});
const liveEligibility = compileTs("lib/roamly/liveEligibility.ts", {
  "@/lib/roamly/tripTimezone": tripTimezone
});
const liveCompanion = compileTs("lib/roamly/liveCompanion.ts", {
  "@/lib/roamly/tripTimezone": tripTimezone,
  "@/lib/roamly/liveEligibility": liveEligibility
});
const backgroundTz = compileTs("lib/roamly/backgroundNotificationTimezone.ts", {
  "@/lib/roamly/tripTimezoneServer": { resolveTripTimezoneServer: () => ({ zone: "America/Toronto", source: "stub", known: true }) }
});
const lifecycle = compileTs("lib/roamly/liveCompanionLifecycle.ts", {
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/companionPreferences": { getCompanionPreferences: async () => ({ liveCompanionEnabled: true, liveCompanionPausedUntil: null }) },
  "@/lib/roamly/liveCompanion": liveCompanion,
  "@/lib/roamly/backgroundNotificationTimezone": backgroundTz,
  "@/lib/roamly/companionNotifications": {
    liveCompanionNotificationIdentity: () => "ident-1",
    queueCompanionNotification: async () => ({ ok: true, delivery: { id: "d1" }, deduplicated: true }),
    sendCompanionNotificationDelivery: async () => ({ ok: true })
  },
  "@/lib/roamly/locationLifecycle": { clearLastLocationIfNoOperationalTrip: async () => {} },
  "@/lib/roamly/workGate": workGate
});
function companionTrip(overrides = {}) {
  return {
    id: "trip-1", user_id: "user-1", title: "Montreal", destination: "Montreal", destination_name: "Montreal",
    destination_country: "Canada", destination_region: "Quebec", destination_city: "Montreal",
    start_date: daysFromNow(-1), end_date: daysFromNow(2), status: "locked", activated_at: iso(NOW),
    itinerary_status: "locked", itinerary_locked: true, itinerary_generated_at: iso(NOW),
    tracking_unlocked: true, live_companion_unlocked: false, trip_companion_status: null, metadata: {},
    ...overrides
  };
}
{
  // (a) no work: every trip is far outside any possible window.
  const idleDb = new FakeDb({
    roamly_trips: [companionTrip({ id: "future", start_date: daysFromNow(30), end_date: daysFromNow(33) })],
    roamly_activities: []
  });
  const idleResult = await lifecycle.processLiveCompanionTimeLifecycle({ now: NOW, admin: idleDb });
  eq("companion gate: idle -> gated exit", idleResult.gated, true);
  eq("companion gate: idle -> zero processed", idleResult.processed, 0);
  eq("companion gate: idle -> only the count query ran", idleDb.log.length, 1);
  eq("companion gate: idle -> zero heavy reads", idleDb.heavyReads().length, 0);

  // (b) work present: an in-window trip is scanned and processed.
  const travelDb = new FakeDb({
    roamly_trips: [companionTrip()],
    roamly_activities: [{
      id: "act-1", trip_id: "trip-1", title: "Museum", scheduled_start: iso(new Date(NOW.getTime() + 5 * 3_600_000)),
      scheduled_end: iso(new Date(NOW.getTime() + 6 * 3_600_000)), sort_order: 1, status: "planned",
      description: null, address: null, city: "Montreal", region: "Quebec", country: "Canada",
      latitude: null, longitude: null, radius_meters: null
    }]
  });
  const travelResult = await lifecycle.processLiveCompanionTimeLifecycle({ now: NOW, admin: travelDb });
  eq("companion gate: in-window trip -> processed", travelResult.processed, 1);
  const tripScan = travelDb.log.find((e) => e.table === "roamly_trips" && e.kind === "select");
  check("companion F4: trip scan uses the projection, not select(*)", tripScan && tripScan.select !== "*" && tripScan.select.includes("metadata"));
  const activityReads = travelDb.log.filter((e) => e.table === "roamly_activities" && e.kind === "select");
  eq("companion F4: activities read once when nothing expired", activityReads.length, 1);
  check("companion F4: activity read uses the projection", activityReads[0].select !== "*");
}

/* ---------------- F1: generation status route goes light ---------------- */
const finalizeCalls = [];
const statusRoute = compileTs("app/api/trips/[id]/generation/status/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
  "@/lib/roamly/auth": { requireUser: async () => ({ ok: true, supabase: globalThis.__statusFake, user: { id: "user-1" } }) },
  "@/lib/roamly/stagedItineraryGeneration": {
    publicStagedGenerationProgress: (metadata, tripId) => {
      const state = metadata?.generation;
      if (!state) return null;
      return { tripId, status: state.status, currentStage: state.status, completedDayCount: state.completedDayCount, totalDayCount: state.totalDayCount, percent: 25, completedAt: null, days: [], batches: [] };
    }
  },
  "@/lib/roamly/generationFinalization": {
    finalizeCompletedStagedGeneration: async (params) => { finalizeCalls.push(params); return { ok: true, progress: { tripId: params.tripId, status: "complete", completedDayCount: 4, totalDayCount: 4, completedAt: iso(NOW) } }; },
    hasFinalStoredItineraryInMetadata: (metadata) => {
      const doc = metadata?.generatedItinerary?.full_json;
      return Boolean(doc && Array.isArray(doc.daily_itinerary) && doc.daily_itinerary.length && doc.generation_note === "Generated through Roamly staged AI generation.");
    },
    isFinalStoredItinerary: (value, source) => Boolean(value && Array.isArray(value.daily_itinerary) && value.daily_itinerary.length && (value.generation_note === "Generated through Roamly staged AI generation." || (source === "zero-engine" && /zero-engine/i.test(value.generation_note || ""))))
  },
  "@/lib/roamly/generationQueue": {
    getGenerationQueueForTrip: async ({ supabase, tripId, userId }) => {
      const jobResult = await supabase.from("roamly_trip_generation_jobs").select("*").eq("trip_id", tripId).eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (jobResult.error || !jobResult.data) return { job: null, layers: [], error: jobResult.error?.message || null };
      const layersResult = await supabase.from("roamly_trip_generation_layers").select("*").eq("job_id", jobResult.data.id).eq("user_id", userId).order("layer_sequence", { ascending: true });
      return { job: jobResult.data, layers: layersResult.data || [], error: null };
    },
    publicQueueProgress: (queue) => ({ status: queue.job?.status || "queued", totalLayerCount: 8, completedLayerCount: 2, job: { status: queue.job?.status || "queued", completed_at: null }, layers: queue.layers || [] }),
    queueTableMissing: () => false
  },
  "@/lib/roamly/itineraryGenerationEmail": {
    getGenerationEmailStatus: () => ({ email_me_when_ready: false, completion_email_sent_at: null, completion_email_status: null, delivery_status: null })
  },
  "@/lib/roamly/generationStatus": compileTs("lib/roamly/generationStatus.ts", {}),
  "@/lib/roamly/engine/generate": {
    ZERO_ENGINE_GENERATION_NOTE: "Generated by Roamly's deterministic zero-engine from recorded place data — no AI model calls were used.",
    ZERO_ENGINE_SOURCE: "zero-engine"
  },
  // GAP-CLOSURE 5a: the status route gained state-first reads via
  // these two imports. Stubbed to "no admin / no row" so this suite
  // keeps proving the exact pre-5a metadata path it was written for;
  // the table-wins behaviour is proven in test:gap-5a.
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/generationStateStore": { readGenerationStateRow: async () => null }
});
{
  const bigDoc = {
    trip_title: "Montreal in 4 days",
    generation_note: "Generated through Roamly staged AI generation (partial preview).",
    daily_itinerary: Array.from({ length: 4 }, (_, i) => ({
      day_number: i + 1, date: "2026-11-10", title: `Day ${i + 1}`, morning: "x".repeat(900), afternoon: "y".repeat(900), evening: "z".repeat(900),
      live_timeline: [{ title: "A", description: "d".repeat(300) }]
    }))
  };
  const db = new FakeDb({
    roamly_trips: [{
      id: "trip-1", user_id: "user-1", itinerary_status: "generating", status: "generating", itinerary_locked: false,
      metadata: { generation: { tripId: "trip-1", status: "generating_day", completedDayCount: 1, totalDayCount: 4 } }
    }],
    roamly_trip_generation_jobs: [{ id: "job-1", trip_id: "trip-1", user_id: "user-1", status: "running", error_message: null, completed_at: null, updated_at: iso(NOW), created_at: iso(NOW), payload: { note: "p".repeat(200) } }],
    roamly_trip_generation_layers: Array.from({ length: 8 }, (_, i) => ({ id: `layer-${i}`, job_id: "job-1", trip_id: "trip-1", user_id: "user-1", status: i < 2 ? "completed" : "pending", completed_at: null, updated_at: iso(NOW), created_at: iso(NOW), layer_sequence: i })),
    roamly_itineraries: [{ id: "itin-1", trip_id: "trip-1", user_id: "user-1", source: "staged", created_at: iso(NOW), updated_at: iso(NOW), full_json: bigDoc }]
  });
  globalThis.__statusFake = db;
  const response = await statusRoute.GET(new Request("http://local/api/trips/trip-1/generation/status"), { params: Promise.resolve({ id: "trip-1" }) });
  eq("status F1: response ok", response.body.ok, true);
  const itineraryReads = db.log.filter((e) => e.table === "roamly_itineraries");
  check("status F1: itinerary reads never select full_json", itineraryReads.length > 0 && itineraryReads.every((e) => !(e.select || "").includes("full_json")));
  check("status F1: per-poll bytes are a fraction of the old document pull", db.totalBytes() < JSON.stringify(bigDoc).length);
  eq("status F1: no recovery while only a preview exists", finalizeCalls.length, 0);
  eq("status F1: hasFullItinerary false for preview", response.body.stagedGeneration.hasFullItinerary, false);

  // A final staged row lands -> the poller must see it and recovery must fire.
  db.tables.roamly_itineraries.push({
    id: "itin-2", trip_id: "trip-1", user_id: "user-1", source: "staged", created_at: iso(NOW), updated_at: iso(NOW),
    full_json: { ...bigDoc, generation_note: "Generated through Roamly staged AI generation." }
  });
  db.resetLog();
  const response2 = await statusRoute.GET(new Request("http://local/api/trips/trip-1/generation/status"), { params: Promise.resolve({ id: "trip-1" }) });
  eq("status F1: final row -> hasFullItinerary true", response2.body.stagedGeneration.hasFullItinerary, true);
  eq("status F1: final row -> stored-itinerary recovery still fires", finalizeCalls.length, 1);
}

/* ---------------- F3: pack candidate cache by content_hash ---------------- */
const packTypes = compileTs("lib/roamly/engine/packs/types.ts", {});
const supabaseStore = compileTs("lib/roamly/engine/packs/supabaseStore.ts", {
  "@/lib/roamly/engine/ids": { contentId: (...parts) => `id-${parts.join("-")}` },
  "@/lib/roamly/engine/packs/store": { candidateContentHash: () => "unused" },
  "@/lib/roamly/engine/packs/destinations": { PRODUCTION_DESTINATION_SEEDS: [] },
  "@/lib/roamly/engine/packs/types": packTypes
});
{
  const packRow = {
    id: "pack-row-1", pack_version_id: "packv-test", destination_id: "montreal", version: 1, schema_version: 1,
    classifier_version: "v1", status: "ready", built_at: iso(NOW), candidate_count: 3, counts_by_kind: {},
    content_hash: "hash-1", supersedes_pack_version_id: null, build_job_id: null, provenance: {}
  };
  const candidateRows = Array.from({ length: 3 }, (_, i) => ({
    candidate_key: `cand-${i}`, osm_key: `node/${i}`, kind: "see", name: `Place ${i}`, name_en: null,
    lat: 45.5, lon: -73.5, hours_raw: null, tags: {}, url: null, enrichment: null, pack_id: "pack-row-1"
  }));
  const db = new FakeDb({ roamly_destination_packs: [packRow], roamly_destination_candidates: candidateRows });
  // A "heavy pull" = a select returning the whole candidate set
  // (all 3 rows); the enrichment writer's own single-row read is not
  // a pull.
  const candidatePulls = () => db.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select" && e.rows >= 3).length;

  const storeA = new supabaseStore.SupabasePackStore(db);
  const first = await storeA.getVersionCandidates("packv-test");
  eq("pack F3: first load returns candidates", first.length, 3);
  eq("pack F3: first load = one heavy pull", candidatePulls(), 1);

  const storeB = new supabaseStore.SupabasePackStore(db); // fresh instance, same process
  const second = await storeB.getVersionCandidates("packv-test");
  eq("pack F3: second load (new instance) returns candidates", second.length, 3);
  eq("pack F3: unchanged hash -> still one heavy pull", candidatePulls(), 1);
  check("pack F3: cached return is a fresh copy, not the same reference", second !== first && second[0] !== first[0]);

  db.tables.roamly_destination_packs[0].content_hash = "hash-2";
  const third = await new supabaseStore.SupabasePackStore(db).getVersionCandidates("packv-test");
  eq("pack F3: changed hash -> fresh pull", candidatePulls(), 2);
  eq("pack F3: changed hash returns candidates", third.length, 3);

  await new supabaseStore.SupabasePackStore(db).putCandidateEnrichment("packv-test", "cand-0", { note: "enriched" });
  await new supabaseStore.SupabasePackStore(db).getVersionCandidates("packv-test");
  eq("pack F3: enrichment write invalidates the cache", candidatePulls(), 3);
}

console.log(`\nEGRESS DIET CHECKS: ${passed} passed`);
