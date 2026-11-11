// EGRESS DIET (2026-11-02, F5) — simulated-day byte proof.
//
// Runs three simulated days against a root (baseline/ or tree/) with
// the instrumented fake Supabase client counting requests + response
// body bytes. Usage:
//   EGRESS_ROOT=<abs path to root> node scripts/roamly-egress-diet-simulated-day.mjs
//
// What is EXECUTED (the root's real code): the generation status
// route, the Live Companion lifecycle, the pack store, and — on the
// diet root — every new work gate (generation sweeper, booking
// monitor, notifications queue, ops worker, lifecycle sweep, pack
// refresh) via the real cron routes with their processors stubbed.
// What is PATTERN-MODELLED (queries issued by this harness in the
// exact shape the code issues them, named at each site): the
// baseline cron lanes' first scans (their processors are too deep
// to execute wholesale), the protected generation worker's per-wake
// reads, and finalization's itinerary load. Untouched lanes (social
// autopost, keeper, FYI digest, patterns, signals, exec reports,
// post-trip ask, daily notifications) enter as one stated constant,
// identical for both roots, so the DELTA is exact for touched lanes.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { FakeDb } from "./roamly-egress-diet-fake.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = process.env.EGRESS_ROOT || path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

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

const NOW = new Date("2026-11-02T15:00:00.000Z");
const iso = (d) => d.toISOString();
const dayDate = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const pad = (n, ch = "x") => ch.repeat(n);

/* ------------------------------ fleet ------------------------------ */
function generationMetadata(kb) {
  // A realistic staged-generation metadata blob: state + per-day
  // records. Sized to ~kb KB, the shape production trips carry.
  const day = { dayNumber: 1, date: "2026-11-10", status: "complete", itinerary: { title: "Day", activities: pad(Math.max(200, kb * 200)) } };
  return {
    generation: { tripId: "t", status: "generating_day", completedDayCount: 1, totalDayCount: 4, generatedDays: [day, day, day, day] },
    generationEmail: { tripId: "t", email_me_when_ready: true }
  };
}
function baseTrip(overrides = {}) {
  return {
    id: "trip-x", user_id: "user-1", title: "Trip", destination: "Montreal", destination_name: "Montreal",
    destination_country: "Canada", destination_region: "Quebec", destination_city: "Montreal",
    start_date: dayDate(20), end_date: dayDate(23), days_count: 4, status: "planned",
    is_activated: false, activated_at: null, itinerary_status: "draft", itinerary_locked: false,
    itinerary_generated_at: null, tracking_unlocked: false, live_companion_unlocked: false,
    trip_companion_status: null, metadata: {}, updated_at: iso(NOW), created_at: iso(NOW),
    ...overrides
  };
}
function buildFleet({ travel = false } = {}) {
  const trips = [];
  for (let i = 0; i < 5; i += 1) {
    trips.push(baseTrip({
      id: `legacy-${i}`, status: "generated", itinerary_status: "generated",
      start_date: dayDate(-40 - i), end_date: dayDate(-37 - i), metadata: generationMetadata(8)
    }));
  }
  for (let i = 0; i < 4; i += 1) {
    trips.push(baseTrip({
      id: `future-${i}`, status: "locked", itinerary_status: "locked", itinerary_locked: true,
      tracking_unlocked: true, start_date: dayDate(18 + i * 5), end_date: dayDate(21 + i * 5),
      metadata: { planning: { timezone: "America/Toronto" }, note: pad(1200) }
    }));
  }
  if (travel) {
    trips.push(baseTrip({
      id: "travel-1", status: "locked", itinerary_status: "locked", itinerary_locked: true,
      tracking_unlocked: true, activated_at: iso(NOW), start_date: dayDate(-1), end_date: dayDate(2),
      metadata: { planning: { timezone: "America/Toronto" }, note: pad(1200) }
    }));
  }
  trips.push(baseTrip({ id: "draft-1", status: "draft" }));
  return {
    roamly_trips: trips,
    roamly_activities: travel ? Array.from({ length: 6 }, (_, i) => ({
      id: `act-${i}`, trip_id: "travel-1", trip_day_id: null, title: `Activity ${i}`, description: pad(120),
      category: "see", address: "1 Main St", city: "Montreal", region: "Quebec", country: "Canada",
      latitude: 45.5, longitude: -73.5, radius_meters: 200,
      scheduled_start: iso(new Date(NOW.getTime() + (5 + i) * 3_600_000)), scheduled_end: iso(new Date(NOW.getTime() + (6 + i) * 3_600_000)),
      sort_order: i, status: "planned", checked_in_at: null, completed_at: null, metadata: {}
    })) : [],
    roamly_trip_generation_jobs: [],
    roamly_trip_generation_layers: [],
    roamly_itineraries: [],
    email_connections: Array.from({ length: 8 }, (_, i) => ({
      id: `conn-${i}`, user_id: `user-${i}`, provider: "gmail", connection_status: "connected",
      last_synced_at: iso(new Date(NOW.getTime() - 5 * 60_000))
    })),
    email_watch_subscriptions: [],
    roamly_bookings: [],
    roamly_ops_jobs: Array.from({ length: 30 }, (_, i) => ({
      id: `ops-${i}`, role: "GAP_AUDIT_QA", initiating_signal: "schedule", objective: pad(300), subsystem: "web",
      priority: "normal", risk: "low", authority_level: "LEVEL_1_OBSERVE", status: "COMPLETED",
      scope_json: { note: pad(200) }, allowed_files: [], created_at: iso(NOW), updated_at: iso(NOW)
    })),
    roamly_destination_pack_builds: Array.from({ length: 15 }, (_, i) => ({
      id: `build-${i}`, job_id: `job-${i}`, destination_id: `dest-${i}`, reason: "cold", status: i % 2 ? "done" : "failed",
      requested_at: iso(NOW), started_at: iso(NOW), finished_at: iso(NOW), lease_worker_id: null, lease_id: null,
      lease_epoch: null, lease_expires_at: null, coalesced_requests: 1, result_pack_id: null, error: null, updated_at: iso(NOW)
    })),
    roamly_trip_lifecycle: [{ trip_id: "old-1", user_id: "user-1", state: "PURGED", trip_timezone: "UTC", trip_start_date: dayDate(-60), trip_end_date: dayDate(-57), review_window_days: 7, review_window_ends_at: null, ended_at: null, review_sent_at: null, review_submitted: false, review_submitted_at: null, closed_at: null, close_reason: null, archived_at: null, archived_itinerary_ref: null, purged_at: iso(NOW), tombstone_acknowledged_at: null, history: [] }],
    roamly_communication_ledger: Array.from({ length: 12 }, (_, i) => ({
      id: `led-${i}`, status: "sent", scheduled_for: iso(new Date(NOW.getTime() - 86_400_000)), useful_until: null,
      attempt_count: 1, max_attempts: 3, retryable: false, next_retry_at: null, claimed_at: null, sent_at: iso(NOW),
      suppression_reason: null, last_error_code: null, metadata: { note: pad(400) }, updated_at: iso(NOW)
    })),
    roamly_trip_companion_events: [],
    roamly_companion_notification_deliveries: [],
    roamly_background_health: [{ system_key: "booking_monitor", monitoring_started_at: iso(NOW), last_successful_at: iso(NOW) }],
    roamly_booking_monitor_runs: Array.from({ length: 5 }, (_, i) => ({ id: `run-${i}`, status: "completed", started_at: iso(NOW), completed_at: iso(NOW), failures: 0 })),
    roamly_operational_incidents: [],
    roamly_app_events: [],
    roamly_destination_packs: [{
      id: "pack-row-1", pack_version_id: "packv-montreal", destination_id: "montreal", version: 3, schema_version: 1,
      classifier_version: "v1", status: "ready", built_at: iso(NOW), candidate_count: 3511, counts_by_kind: {},
      content_hash: "hash-mtl-3", supersedes_pack_version_id: null, build_job_id: null, provenance: { source: "osm" }
    }],
    roamly_destination_candidates: Array.from({ length: 3511 }, (_, i) => ({
      candidate_key: `cand-${i}`, osm_key: `node/${1000 + i}`, kind: "see", name: `Place ${i} ${pad(24)}`, name_en: null,
      lat: 45.5, lon: -73.5, hours_raw: null, tags: { amenity: "cafe", name: pad(160) }, url: null, enrichment: null, pack_id: "pack-row-1"
    })),
    roamly_admin_settings: []
  };
}

/* --------------------- shared compiled modules --------------------- */
const tripTimezone = compileTs("lib/roamly/tripTimezone.ts", { "@/lib/roamly/places": { recommendedPlaces: [] } });
const liveEligibility = compileTs("lib/roamly/liveEligibility.ts", { "@/lib/roamly/tripTimezone": tripTimezone });
const liveCompanion = compileTs("lib/roamly/liveCompanion.ts", {
  "@/lib/roamly/tripTimezone": tripTimezone, "@/lib/roamly/liveEligibility": liveEligibility
});
const backgroundTz = compileTs("lib/roamly/backgroundNotificationTimezone.ts", {
  "@/lib/roamly/tripTimezoneServer": { resolveTripTimezoneServer: () => ({ zone: "America/Toronto", source: "stub", known: true }) }
});
const workGate = exists("lib/roamly/workGate.ts") ? compileTs("lib/roamly/workGate.ts", {}) : null;

let currentFake = null;
const lifecycle = compileTs("lib/roamly/liveCompanionLifecycle.ts", {
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => currentFake },
  "@/lib/roamly/companionPreferences": { getCompanionPreferences: async () => ({ liveCompanionEnabled: true, liveCompanionPausedUntil: null }) },
  "@/lib/roamly/liveCompanion": liveCompanion,
  "@/lib/roamly/backgroundNotificationTimezone": backgroundTz,
  "@/lib/roamly/companionNotifications": {
    liveCompanionNotificationIdentity: () => "ident-1",
    queueCompanionNotification: async () => ({ ok: true, delivery: { id: "d1" }, deduplicated: true }),
    sendCompanionNotificationDelivery: async () => ({ ok: true })
  },
  "@/lib/roamly/locationLifecycle": { clearLastLocationIfNoOperationalTrip: async () => {} },
  // During-trip scheduling (2026-11-11): the lifecycle now reconciles
  // scheduled companion events in-window; stubbed to a no-op here so
  // this suite keeps counting only the lifecycle's own queries (the
  // real reconcile is pinned by test:live-companion-during-trip).
  "@/lib/roamly/tripCompanion": { scheduleCompanionEvents: async () => ({ ok: true, count: 0 }) },
  ...(workGate ? { "@/lib/roamly/workGate": workGate } : {})
});

const packTypes = compileTs("lib/roamly/engine/packs/types.ts", {});
function makePackStore(fake) {
  const storeModule = compileTs("lib/roamly/engine/packs/supabaseStore.ts", {
    "@/lib/roamly/engine/ids": { contentId: (...parts) => `id-${parts.join("-")}` },
    "@/lib/roamly/engine/packs/store": { candidateContentHash: () => "unused" },
    "@/lib/roamly/engine/packs/destinations": { PRODUCTION_DESTINATION_SEEDS: [] },
    "@/lib/roamly/engine/packs/types": packTypes
  });
  return new storeModule.SupabasePackStore(fake);
}

/* ------------------------- status route ------------------------- */
const finalizeStub = { calls: 0 };
const statusRoute = compileTs("app/api/trips/[id]/generation/status/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
  "@/lib/roamly/auth": { requireUser: async () => ({ ok: true, supabase: currentFake, user: { id: "user-1" } }) },
  "@/lib/roamly/stagedItineraryGeneration": {
    publicStagedGenerationProgress: (metadata, tripId) => {
      const state = metadata?.generation;
      if (!state) return null;
      return { tripId, status: state.status, currentStage: state.status, completedDayCount: state.completedDayCount, totalDayCount: state.totalDayCount, percent: 25, completedAt: null, days: [], batches: [] };
    }
  },
  "@/lib/roamly/generationFinalization": {
    finalizeCompletedStagedGeneration: async () => { finalizeStub.calls += 1; return { ok: true, progress: null }; },
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
  // GAP-CLOSURE 5a: state-first reads in the status route — stubbed
  // to "no admin / no row" so the simulated day keeps measuring the
  // metadata path it was calibrated on (test:gap-5a proves the
  // table-wins path).
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/generationStateStore": { readGenerationStateRow: async () => null }
});

function bigItineraryDoc(note) {
  return {
    trip_title: "Montreal in 4 days", generation_note: note,
    daily_itinerary: Array.from({ length: 4 }, (_, i) => ({
      day_number: i + 1, date: "2026-11-10", title: `Day ${i + 1}`,
      morning: pad(2600), afternoon: pad(2600), evening: pad(2600),
      food: [pad(120), pad(120)], transport_notes: pad(300), estimated_cost: "$120",
      map_queries: [pad(60), pad(60)],
      live_timeline: Array.from({ length: 5 }, (_, j) => ({ title: `Stop ${j}`, description: pad(700), location_name: pad(60), estimated_cost: "$20", category: "see", map_query: pad(50), time_label: "09:00" }))
    }))
  };
}

/* --------------------------- lane runs --------------------------- */
async function companionRuns(fake, runs) {
  currentFake = fake;
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    if (workGate) await lifecycle.processLiveCompanionTimeLifecycle({ now: NOW, admin: fake });
    else await lifecycle.processLiveCompanionTimeLifecycle({ now: NOW });
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function generationCronRuns(fake, runs) {
  // Baseline pattern: the first scans processGenerationQueue + the
  // three detectors issue on an idle wake (generationWorker.ts claim
  // RPC + enqueueLegacyTripJobs trip scan; silentFailureDetectors
  // job/trip scans; packWaitTerminalTransition job scan;
  // communicationStuckDetector ledger scan; bookingMonitorHealth
  // small reads). Diet: the real gate (3 head/counts) decides.
  if (workGate) {
    const gate = compileTs("lib/roamly/generationWorkGate.ts", { "@/lib/roamly/workGate": workGate });
    let bytes = 0; let queries = 0;
    for (let i = 0; i < runs; i += 1) {
      fake.resetLog();
      await gate.generationSweeperHasWork(fake, NOW);
      bytes += fake.totalBytes(); queries += fake.totalQueries();
    }
    return { bytes, queries };
  }
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    await fake.rpc("roamly_claim_generation_jobs", {});
    await fake.from("roamly_trips").select("id,user_id,metadata,itinerary_status,status,updated_at")
      .in("itinerary_status", ["generating", "generated", "locked"]).order("updated_at", { ascending: true }).limit(5);
    await fake.from("roamly_trip_generation_jobs").select("id,trip_id,user_id,status,retry_count,next_attempt_at,lease_expires_at,completed_at,dead_lettered_at,updated_at")
      .in("status", ["queued", "waiting", "running", "failed"]).limit(200);
    await fake.from("roamly_communication_ledger").select("id,status,scheduled_for,useful_until,attempt_count,max_attempts,retryable,next_retry_at,claimed_at,sent_at,suppression_reason,last_error_code,metadata,updated_at")
      .in("status", ["pending", "claimed", "failed", "sent", "suppressed"]).gte("scheduled_for", iso(new Date(NOW.getTime() - 30 * 86_400_000))).limit(200);
    await fake.from("roamly_booking_monitor_runs").select("id,status,started_at,completed_at,failures").limit(10);
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function bookingMonitorRuns(fake, runs) {
  if (workGate) {
    const monitor = compileTs("lib/roamly/bookingMonitor.ts", {
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
    let bytes = 0; let queries = 0;
    for (let i = 0; i < runs; i += 1) {
      fake.resetLog();
      await monitor.bookingMonitorHasWork(fake, NOW);
      bytes += fake.totalBytes(); queries += fake.totalQueries();
    }
    return { bytes, queries };
  }
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    await fake.from("email_watch_subscriptions").select("id,email_connection_id").eq("provider", "gmail")
      .in("status", ["active", "renewal_due", "expired", "error"]).not("expiration_time", "is", null)
      .lte("expiration_time", iso(new Date(NOW.getTime() + 86_400_000))).limit(25);
    await fake.from("email_connections").select("id,user_id,provider,last_synced_at")
      .in("connection_status", ["connected", "error"]).eq("provider", "gmail")
      .or(`last_synced_at.is.null,last_synced_at.lte.${iso(new Date(NOW.getTime() - 600_000))}`).limit(25);
    await fake.from("roamly_bookings").select("id,user_id,trip_id,title,flight_number,booking_status,start_at,end_at,origin,destination,gate,terminal,updated_at")
      .eq("booking_type", "flight").in("booking_status", ["booked", "paid", "reserved"]).not("trip_id", "is", null)
      .is("superseded_by_booking_id", null).not("flight_number", "is", null)
      .gte("start_at", iso(new Date(NOW.getTime() - 8 * 3_600_000))).lte("start_at", iso(new Date(NOW.getTime() + 72 * 3_600_000))).limit(40);
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function simpleCountRuns(fake, runs, predicates) {
  // Diet lanes whose routes gate on countWorkRows with the route's
  // own predicates (copied from the route source; the routes
  // themselves are proven in roamly-egress-diet-checks.mjs style
  // tests for the two lib-level gates).
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    for (const predicate of predicates) await predicate(fake);
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function emailSyncRuns(fake, runs) {
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    if (workGate) {
      const cutoff = iso(new Date(NOW.getTime() - 20 * 60_000));
      await fake.from("email_connections").select("user_id,provider,last_synced_at")
        .neq("connection_status", "disconnected")
        .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
        .order("last_synced_at", { ascending: true }).limit(50);
    } else {
      await fake.from("email_connections").select("user_id,provider,last_synced_at")
        .neq("connection_status", "disconnected")
        .order("last_synced_at", { ascending: true }).limit(500);
    }
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function opsWorkerRuns(fake, runs) {
  if (workGate) {
    return simpleCountRuns(fake, runs, [
      (f) => workGate.countWorkRows(f, "roamly_ops_jobs", (q) => q.eq("status", "QUEUED"))
    ]);
  }
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    await fake.from("roamly_ops_jobs").select("id,role,initiating_signal,objective,subsystem,priority,risk,authority_level,status,scope_json,allowed_files,created_at,updated_at")
      .order("created_at", { ascending: false }).limit(100);
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function lifecycleRuns(fake, runs) {
  const columns = "trip_id, user_id, state, trip_timezone, trip_start_date, trip_end_date, review_window_days, review_window_ends_at, ended_at, review_sent_at, review_submitted, review_submitted_at, closed_at, close_reason, archived_at, archived_itinerary_ref, purged_at, tombstone_acknowledged_at, history";
  if (workGate) {
    return simpleCountRuns(fake, runs, [
      (f) => workGate.countWorkRows(f, "roamly_trip_lifecycle", (q) => q.in("state", ["ACTIVE", "TRIP_ENDED", "POST_TRIP_PENDING"]), "trip_id")
    ]);
  }
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    await fake.from("roamly_trip_lifecycle").select(columns).in("state", ["ACTIVE", "TRIP_ENDED", "POST_TRIP_PENDING", "CLOSED"]);
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function packRefreshRuns(fake, runs) {
  if (workGate) {
    return simpleCountRuns(fake, runs, [
      (f) => workGate.countWorkRows(f, "roamly_destination_pack_builds", (q) => q.eq("status", "queued"))
    ]);
  }
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    await fake.from("roamly_destination_pack_builds").select("*").order("requested_at", { ascending: true });
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

async function notificationQueueRuns(fake, runs) {
  const nowIso = iso(NOW);
  if (workGate) {
    const stale = iso(new Date(NOW.getTime() - 15 * 60_000));
    return simpleCountRuns(fake, runs, [
      (f) => workGate.countWorkRows(f, "roamly_trip_companion_events", (q) => q.eq("status", "scheduled").lte("scheduled_for", nowIso)),
      (f) => workGate.countWorkRows(f, "roamly_trip_companion_events", (q) => q.or("metadata->>emailDeliveryState.eq.claimed,metadata->>emailDeliveryState.eq.in_flight,metadata->>emailDeliveryState.eq.ambiguous")),
      (f) => workGate.countWorkRows(f, "roamly_companion_notification_deliveries", (q) => q.or(`and(status.in.(queued,retrying),scheduled_for.lte.${nowIso},next_attempt_at.lte.${nowIso}),and(status.eq.sending,updated_at.lt.${stale})`))
    ]);
  }
  let bytes = 0; let queries = 0;
  for (let i = 0; i < runs; i += 1) {
    fake.resetLog();
    for (const state of ["claimed", "in_flight", "ambiguous"]) {
      await fake.from("roamly_trip_companion_events").select("id,user_id,trip_id,status,created_at,scheduled_for,metadata")
        .filter("metadata->>emailDeliveryState", "eq", state).limit(50);
    }
    await fake.from("roamly_trip_companion_events").select("*").eq("status", "scheduled").lte("scheduled_for", nowIso).limit(50);
    await fake.from("roamly_companion_notification_deliveries").select("id").in("status", ["queued", "retrying"])
      .lte("scheduled_for", nowIso).lte("next_attempt_at", nowIso).limit(25);
    bytes += fake.totalBytes(); queries += fake.totalQueries();
  }
  return { bytes, queries };
}

/* ------------------------- simulated days ------------------------- */
// Untouched lanes, one stated constant (identical both roots):
// social autopost 48 runs x ~9 KB, keeper 24 x ~18 KB, FYI digest
// 24 x ~25 KB, patterns ~60 KB/day, ops signals ~8 KB/day, exec
// reports ~4 KB/day, post-trip ask ~6 KB/day, daily notifications
// ~12 KB/day. Estimate from their projected/limited first reads.
const UNTOUCHED_LANES_BYTES = 48 * 9_000 + 24 * 18_000 + 24 * 25_000 + 60_000 + 8_000 + 4_000 + 6_000 + 12_000;

async function idleBackground() {
  const fake = new FakeDb(buildFleet());
  const lanes = {};
  lanes.liveCompanion = await companionRuns(fake, 288);
  lanes.generationCron = await generationCronRuns(fake, 288);
  lanes.bookingMonitor = await bookingMonitorRuns(fake, 144);
  lanes.notificationsQueue = await notificationQueueRuns(fake, 96);
  lanes.emailSync = await emailSyncRuns(fake, 48);
  lanes.opsWorker = await opsWorkerRuns(fake, 96);
  lanes.lifecycle = await lifecycleRuns(fake, 24);
  lanes.packRefresh = await packRefreshRuns(fake, 24);
  const touched = Object.values(lanes).reduce((sum, lane) => sum + lane.bytes, 0);
  return { lanes, touchedBytes: touched, totalBytes: touched + UNTOUCHED_LANES_BYTES };
}

async function travelCompanion() {
  const fake = new FakeDb(buildFleet({ travel: true }));
  return companionRuns(fake, 288);
}

async function perGeneration() {
  // Status polling at the real client cadence. Baseline: ~60 s at
  // 1.8 s (33 polls, 0 days complete) + ~180 s at 5 s (36 polls) =
  // 69 polls. Diet: the unchanged-progress backoff stretches the
  // 0-days phase (outline/research produce no day completions) to
  // ~8 polls; the moving phase keeps 36. Server bytes per poll are
  // measured by executing the real route.
  const doc = bigItineraryDoc("Generated through Roamly staged AI generation (partial preview).");
  const fake = new FakeDb({
    roamly_trips: [{
      id: "trip-1", user_id: "user-1", itinerary_status: "generating", status: "generating", itinerary_locked: false,
      metadata: generationMetadata(8)
    }],
    roamly_trip_generation_jobs: [{ id: "job-1", trip_id: "trip-1", user_id: "user-1", status: "running", error_message: null, completed_at: null, updated_at: iso(NOW), created_at: iso(NOW), payload: { note: pad(200) } }],
    roamly_trip_generation_layers: Array.from({ length: 8 }, (_, i) => ({ id: `layer-${i}`, job_id: "job-1", trip_id: "trip-1", user_id: "user-1", status: i < 2 ? "completed" : "pending", completed_at: null, updated_at: iso(NOW), created_at: iso(NOW), layer_sequence: i })),
    roamly_itineraries: [
      { id: "itin-1", trip_id: "trip-1", user_id: "user-1", source: "staged", created_at: iso(NOW), updated_at: iso(NOW), full_json: doc },
      { id: "itin-0", trip_id: "trip-1", user_id: "user-1", source: "staged", created_at: iso(NOW), updated_at: iso(NOW), full_json: doc },
      { id: "itin-2", trip_id: "trip-1", user_id: "user-1", source: "staged", created_at: iso(NOW), updated_at: iso(NOW), full_json: bigItineraryDoc("Generated through Roamly staged AI generation.") }
    ],
    roamly_destination_packs: buildFleet().roamly_destination_packs,
    roamly_destination_candidates: buildFleet().roamly_destination_candidates,
    roamly_admin_settings: []
  });
  currentFake = fake;
  const polls = workGate ? 44 : 69;
  let statusBytes = 0;
  for (let i = 0; i < polls; i += 1) {
    fake.resetLog();
    await statusRoute.GET(new Request("http://local/api/trips/trip-1/generation/status"), { params: Promise.resolve({ id: "trip-1" }) });
    statusBytes += fake.totalBytes();
  }
  // Worker wakes: 6 per generation. Per-wake pattern (protected
  // worker, unchanged shape): claim RPC, job + layers loads, two
  // trip loads, one pack readPinned (real store: baseline pulls the
  // pack per wake; diet pulls once per process + identity reads).
  const store = makePackStore(fake);
  let workerBytes = 0;
  for (let wake = 0; wake < 6; wake += 1) {
    fake.resetLog();
    await fake.rpc("roamly_claim_generation_jobs", {});
    await fake.from("roamly_trip_generation_jobs").select("*").eq("trip_id", "trip-1").eq("user_id", "user-1").limit(1);
    await fake.from("roamly_trip_generation_layers").select("*").eq("job_id", "job-1").eq("user_id", "user-1");
    await fake.from("roamly_trips").select("id,user_id,metadata,itinerary_status,status,updated_at").eq("id", "trip-1");
    await fake.from("roamly_trips").select("id,user_id,metadata,itinerary_status,status,updated_at").eq("id", "trip-1");
    await store.readPinned("packv-montreal");
    workerBytes += fake.totalBytes();
  }
  // Finalization itinerary load x1: baseline pulls the 5 newest docs
  // (here 3 rows); diet's note-filtered load returns only the final.
  fake.resetLog();
  if (workGate) {
    await fake.from("roamly_itineraries").select("id,full_json,updated_at,source").eq("trip_id", "trip-1")
      .eq("full_json->>generation_note", "Generated through Roamly staged AI generation.").limit(5);
    await fake.from("roamly_itineraries").select("id,full_json,updated_at,source").eq("trip_id", "trip-1")
      .eq("source", "zero-engine").eq("full_json->>generation_note", "Generated by Roamly's deterministic zero-engine from recorded place data — no AI model calls were used.").limit(5);
  } else {
    await fake.from("roamly_itineraries").select("id,full_json,updated_at,source").eq("trip_id", "trip-1")
      .not("full_json", "is", null).order("updated_at", { ascending: false }).limit(5);
  }
  const finalizationBytes = fake.totalBytes();
  return { statusBytes, workerBytes, finalizationBytes, totalBytes: statusBytes + workerBytes + finalizationBytes, polls };
}

/* ------------------------------ main ------------------------------ */
const idle = await idleBackground();
const travel = await travelCompanion();
const generation = await perGeneration();
const generationDay = idle.totalBytes + 3 * generation.totalBytes;
const travelDay = idle.totalBytes - idle.lanes.liveCompanion.bytes + travel.bytes;
const cycle = 20 * idle.totalBytes + 7 * generationDay + 3 * travelDay;
const mb = (b) => Math.round((b / 1_000_000) * 100) / 100;
console.log(JSON.stringify({
  root: ROOT,
  diet: Boolean(workGate),
  lanesIdle: Object.fromEntries(Object.entries(idle.lanes).map(([k, v]) => [k, { mb: mb(v.bytes), queries: v.queries }])),
  untouchedLanesMb: mb(UNTOUCHED_LANES_BYTES),
  idleDayMb: mb(idle.totalBytes),
  perGeneration: { statusMb: mb(generation.statusBytes), workerMb: mb(generation.workerBytes), finalizationMb: mb(generation.finalizationBytes), totalMb: mb(generation.totalBytes), polls: generation.polls },
  travelCompanionDayMb: mb(travel.bytes),
  generationDayMb: mb(generationDay),
  travelDayMb: mb(travelDay),
  cycleProjectionMb: mb(cycle),
  prewarmOneOffMb: mb(24 * 1_420_000)
}, null, 2));
