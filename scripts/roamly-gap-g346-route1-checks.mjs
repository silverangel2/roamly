// GAP-CLOSURE WAVE 3 — G3+G4: end-to-end queue-worker over REAL RPCs.
//
// ══════════════════════════════════════════════════════════════
// ROUTE ACHIEVED: ROUTE 1 — THE REAL STACK. No emulation is used
// anywhere in this suite. It self-provisions, per run:
//   * a vanilla PostgreSQL 16 cluster (initdb under
//     harness/g346-suite-pgdata, port 55452, stopped at teardown);
//   * the tree's OWN schema: supabase/roamly-full-production-schema.sql
//     + the full queue/pack migration chain, applied with psql in
//     order (a stub auth schema + anon/authenticated/service_role
//     roles stand in for the Supabase-provided objects);
//   * PostgREST 12.2.3 (static binary at harness/bin/postgrest,
//     port 55453) with an in-process /rest/v1 prefix proxy (55454)
//     so a stock supabase-js client talks to it;
//   * the REAL processGenerationQueue from
//     lib/roamly/generationWorker.ts, entered exactly as the cron
//     route enters it. The only fakes in the process are the two
//     documented loader redirects: the admin client factory (which
//     returns the real-stack supabase-js client above — same seam
//     as the roamly-409 rig) and the generation-email module
//     (sends captured in-process; email transport is not the
//     system under test).
// All queue RPCs (get_or_create, claim, claim_by_trip, renew,
// release, retry scheduling, complete/finalize, reconcile, cost)
// execute as the tree's actual plpgsql against the real tables.
//
// The sibling suite test:gap-g346 (roamly-gap-g346-checks.mjs) is
// ROUTE 2 — faithful JS emulations of the same RPCs over the diet
// FakeDb (scripts/roamly-gap-queue-fake.mjs), which passes the
// same drive in-process and serves as G6's backend. The two
// routes are kept as separate suites so neither blurs the other.
// ══════════════════════════════════════════════════════════════
//
// PROOF SHAPE (mirrors kf2's, one level up the real stack):
//   T1  Charlottetown (3 days, recorded pack seeded through the
//       REAL SupabasePackStore over PostgREST) is driven from
//       queued → complete ONLY by repeated processGenerationQueue
//       calls. Assertions: exactly one job row throughout (the
//       real get_or_create RPC), stage progression in the real
//       layers table, final itinerary stored + production-valid
//       with source "zero-engine", exactly one prediction row,
//       exactly one captured completion email, aiCallCount 0.
//   T2  A second trip whose job is left in the crashed-worker
//       shape (status running, dead worker's lock, lease expired
//       60 s ago) is reclaimed by later queue calls — the real
//       claim_by_trip RPC's expired-lease eligibility — and
//       completes with the same single-job / single-itinerary /
//       single-email invariants.
//
// Run via: npm run test:gap-g346-route1 (from the repo root).

import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

let assertions = 0;
const failures = [];
function check(label, cond, detail) {
  assertions += 1;
  if (cond) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label} — ${detail}`);
    failures.push(`${label}: ${detail}`);
  }
}

/* ─────────────── provisioning ─────────────── */
const TREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(TREE_ROOT, "..");
const HARNESS = path.join(ROOT, "harness");
const POSTGREST_BIN = path.join(HARNESS, "bin", "postgrest");
const PGDATA = path.join(HARNESS, "g346-suite-pgdata");
const RUN_DIR = path.join(HARNESS, "g346-suite-run");
const PG_PORT = 55452;
const PGRST_PORT = 55453;
const PROXY_PORT = 55454;
const DB = "g346suite";
const JWT_SECRET = "gap-g346-route1-test-secret-0123456789abcdef";
const PG_BIN = "/usr/lib/postgresql/16/bin";

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const asPostgres = (cmd, args, opts) => run("runuser", ["-u", "postgres", "--", cmd, ...args], opts);
const psql = (args) =>
  run("psql", ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=0", "-q", ...args]);

let postgrest = null;
let proxy = null;
let pgStartedBySuite = false;

async function provision() {
  if (!existsSync(POSTGREST_BIN)) {
    throw new Error(`PostgREST binary missing at ${POSTGREST_BIN} — Route 1 cannot run (see GAP-D-CHANGELOG.md)`);
  }
  mkdirSync(RUN_DIR, { recursive: true });
  run("chown", ["postgres:postgres", RUN_DIR]);
  if (!existsSync(path.join(PGDATA, "PG_VERSION"))) {
    mkdirSync(PGDATA, { recursive: true });
    run("chown", ["postgres:postgres", PGDATA]);
    const init = asPostgres(`${PG_BIN}/initdb`, ["-D", PGDATA, "-U", "postgres", "--auth=trust"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr?.slice(-500)}`);
  }
  const status = asPostgres(`${PG_BIN}/pg_ctl`, ["-D", PGDATA, "status"]);
  if (status.status !== 0) {
    const start = asPostgres(`${PG_BIN}/pg_ctl`, [
      "-D", PGDATA, "-l", path.join(RUN_DIR, "postgres.log"),
      "-o", `-k /tmp -p ${PG_PORT} -h 127.0.0.1`, "-w", "start"
    ]);
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stdout} ${start.stderr}`);
    pgStartedBySuite = true;
  }
  // fresh database per run
  run("psql", ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "postgres", "-d", "postgres", "-q",
    "-c", `drop database if exists ${DB};`, "-c", `create database ${DB};`]);

  const stubSql = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;`;
  writeFileSync(path.join(RUN_DIR, "stub.sql"), stubSql);
  const files = [
    "supabase/roamly-full-production-schema.sql",
    "supabase/migrations/20260705_roamly_itinerary_locking.sql",
    "supabase/migrations/20260714_roamly_completion_email_delivery.sql",
    "supabase/migrations/20260715_roamly_generation_queue.sql",
    "supabase/migrations/20260715_roamly_generation_scalability.sql",
    "supabase/migrations/20260715_roamly_generation_worker.sql",
    "supabase/migrations/20260715_roamly_traveler_memory.sql",
    "supabase/migrations/20260731_roamly_generation_queue_non_null_next_attempt.sql",
    "supabase/migrations/20260731_roamly_generation_queue_postgrest_finalization.sql",
    "supabase/migrations/20260731_roamly_generation_worker_handoff.sql",
    "supabase/migrations/20260731_roamly_generation_worker_resume.sql",
    "supabase/migrations/20260916_roamly_planning_repairs.sql",
    "supabase/migrations/20261001000100_roamly_terminal_trip_generation_guards.sql",
    "supabase/migrations/20261022_roamly_destination_packs.sql",
    "supabase/migrations/20261022_roamly_itineraries_source.sql",
    "supabase/migrations/20261022_roamly_places_ledger.sql",
    "supabase/migrations/20261022_roamly_trip_predictions.sql",
    "supabase/migrations/20261029000100_roamly_generation_job_get_or_create.sql",
    "supabase/migrations/20261102000100_roamly_trip_generation_states.sql",
    // Stage 4 harness repair (2026-11-10): the apply list was frozen at
    // 2026-11-02; the pack-leg-matrix migration (2026-11-06) ships with
    // the code that writes the column, and SupabasePackStore.publish
    // fails without it ("Could not find the 'leg_matrix' column").
    "supabase/migrations/20261106000300_roamly_pack_leg_matrix.sql"
  ];
  let sqlErrors = 0;
  const applyOne = (file) => {
    const r = psql(["-f", file]);
    const errs = ((r.stdout || "") + (r.stderr || "")).match(/^psql:.*ERROR/gm) || [];
    sqlErrors += errs.length;
    if (errs.length) console.log(`    sql errors in ${path.basename(file)}: ${errs[0]}`);
  };
  applyOne(path.join(RUN_DIR, "stub.sql"));
  for (const f of files) applyOne(path.join(TREE_ROOT, f));
  check("schema + full queue migration chain applied with zero SQL errors", sqlErrors === 0, `${sqlErrors} errors`);

  const { stdout: fnList } = psql(["-At", "-c",
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"]);
  const expectedFns = [
    "roamly_get_or_create_generation_job", "roamly_claim_generation_jobs", "roamly_claim_generation_job_by_trip",
    "roamly_renew_generation_lease", "roamly_release_generation_job", "roamly_release_generation_layer",
    "roamly_skip_remaining_generation_layers", "roamly_invalidate_generation_layers", "roamly_requeue_invalidated_layers",
    "roamly_claim_generation_layer", "roamly_complete_generation_layer", "roamly_complete_generation_job",
    "roamly_schedule_generation_job_retry", "roamly_schedule_generation_layer_retry",
    "roamly_finalize_generation_trip", "roamly_finalize_generation_completion",
    "roamly_reconcile_completed_generation_jobs", "roamly_record_generation_cost"
  ];
  const missing = expectedFns.filter((f) => !fnList.includes(f));
  check("all 18 queue RPCs exist as real plpgsql functions", missing.length === 0, `missing: ${missing.join(",")}`);

  // PostgREST
  const conf = [
    `db-uri = "postgres://postgres@127.0.0.1:${PG_PORT}/${DB}"`,
    `db-schemas = "public"`,
    `db-anon-role = "anon"`,
    `jwt-secret = "${JWT_SECRET}"`,
    `server-host = "127.0.0.1"`,
    `server-port = ${PGRST_PORT}`
  ].join("\n");
  writeFileSync(path.join(RUN_DIR, "postgrest.conf"), conf);
  postgrest = spawn(POSTGREST_BIN, [path.join(RUN_DIR, "postgrest.conf")], { stdio: "ignore" });
  let pgrstUp = false;
  for (let i = 0; i < 50 && !pgrstUp; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PGRST_PORT}/`);
      pgrstUp = r.status === 200;
    } catch { /* not up yet */ }
    if (!pgrstUp) await new Promise((r) => setTimeout(r, 200));
  }
  check("PostgREST 12.2.3 serving the public schema", pgrstUp, "no 200 from / within 10 s");

  // /rest/v1 prefix proxy (supabase-js expects the Supabase path layout)
  proxy = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PGRST_PORT}`);
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "") || "/";
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const upstream = await fetch(url, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "host")),
          body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks)
        });
        res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.writeHead(502);
        res.end(String(err));
      }
    });
  });
  await new Promise((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));
}

async function teardown() {
  if (proxy) proxy.close();
  if (postgrest) postgrest.kill("SIGTERM");
  if (pgStartedBySuite) asPostgres(`${PG_BIN}/pg_ctl`, ["-D", PGDATA, "-m", "fast", "stop"]);
}

/* ─────────────── environment (before app imports) ─────────────── */
process.env.ROAMLY_ZERO_ENGINE_ENABLED = "1";
process.env.ROAMLY_PACK_STORE = "supabase";
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;
delete process.env.ROAMLY_PACK_CACHE_DIR;
for (const key of Object.keys(process.env)) {
  if (/^SUPABASE_|NEXT_PUBLIC_SUPABASE/.test(key)) delete process.env[key];
}

// FORMAL GATE (Stage 4 test-net repair, 2026-11-10 — GATES register
// entry GATE-G346-POSTGREST): this suite is an end-to-end proof
// against a REAL local PostgreSQL 16 + PostgREST 12.2.3. PostgreSQL
// is provisioned by the suite itself (harness/g346-suite-pgdata), but
// the PostgREST static binary is an external artifact that must exist
// at harness/bin/postgrest — absent in this environment and not
// fetchable (no network egress). When a prerequisite is missing the
// suite SKIPS with this named reason; when all are present, every
// assertion below runs at full strength.
const missingPrereqs = [];
if (!existsSync(POSTGREST_BIN)) missingPrereqs.push(`PostgREST 12.2.3 static binary at ${POSTGREST_BIN}`);
if (!existsSync(path.join(PG_BIN, "initdb"))) missingPrereqs.push(`PostgreSQL 16 binaries at ${PG_BIN}`);
else {
  // The Roamly schema's first statement is CREATE EXTENSION pgcrypto,
  // so the server must ship the contrib extensions — a binaries-only
  // PostgreSQL 16 (e.g. the contrib-less preview-stack 16.2 that
  // remained after this VM's system PostgreSQL was lost on
  // 2026-11-11) starts fine but fails the migration chain. Probe the
  // extension control file through the server's own pg_config so the
  // check follows whatever layout the binaries use.
  let sharedir = "";
  try {
    sharedir = run(path.join(PG_BIN, "pg_config"), ["--sharedir"]).stdout.trim();
  } catch { /* pg_config unusable — treated as missing below */ }
  if (!sharedir || !existsSync(path.join(sharedir, "extension", "pgcrypto.control")))
    missingPrereqs.push("the pgcrypto contrib extension for the PostgreSQL 16 server (CREATE EXTENSION pgcrypto is the Roamly schema's first statement)");
}
if (missingPrereqs.length) {
  console.log(`GATED test:gap-g346-route1 — missing: ${missingPrereqs.join("; ")}. See GATES.md entry GATE-G346-POSTGREST.`);
  process.exit(0);
}

try {
  await provision();

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = (role) => {
    const head = b64({ alg: "HS256", typ: "JWT" });
    const body = b64({ role, iss: "supabase", ref: "g346local", iat: 1700000000, exp: 2000000000 });
    return `${head}.${body}.${createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url")}`;
  };
  const require = createRequire(path.join(TREE_ROOT, "package.json"));
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(`http://127.0.0.1:${PROXY_PORT}`, jwt("service_role"), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  globalThis.__roamlyFakeSupabase = db;
  globalThis.__capturedGenerationEmails = [];

  const { processGenerationQueue } = await import("@/lib/roamly/generationWorker.ts");
  const { createOrResumeGenerationJob } = await import("@/lib/roamly/generationQueue.ts");
  const { createSupabaseEngineGenerationStore, startEngineGeneration } = await import("@/lib/roamly/engine/generate.ts");
  const { getStagedGenerationState } = await import("@/lib/roamly/stagedItineraryGeneration.ts");
  const { validateItineraryForProduction } = await import("@/lib/itinerary.ts");
  const { SupabasePackStore } = await import("@/lib/roamly/engine/packs/supabaseStore.ts");
  const { seedDestinationFromRecordedPack } = await import("@/lib/roamly/engine/packs/builder.ts");
  const { breadthDestination } = await import("@/lib/roamly/engine/packs/destinations.ts");

  const USER = "22222222-2222-4222-8222-222222222222";
  psql(["-c", `insert into auth.users(id,email) values('${USER}','g346@example.test') on conflict (id) do nothing;`]);

  const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, FIX2), "utf8"));
  const scn = load("scenarios.json").data.find((s) => s.entry.id === "charlottetown-smalltown");
  const { entry, requestText, startDate, endDate } = scn;
  const payload = {
    origin: "Saint John",
    originCity: "Saint John",
    destination: entry.destination,
    destinationCity: entry.destination,
    destinationCountry: entry.destinationCountry,
    tripType: "single_destination",
    startDate,
    endDate,
    daysCount: entry.days,
    travelers: entry.travelers,
    travelersCount: (entry.travelers.adults || 0) + (entry.travelers.children || 0),
    budgetAmount: entry.budgetAmount,
    budgetCurrency: entry.budgetCurrency,
    interests: entry.interests,
    pace: entry.pace,
    travelStyle: entry.travelStyle,
    specialNotes: requestText,
    language: "en",
    explicitRequirements: entry.checks
      .filter((c) => c.kind === "keyword")
      .map((c) => ({ type: "activity", request: c.label, priority: "hard" }))
  };
  const emptyContext = () => ({
    personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
    confirmedBookings: []
  });

  console.log("GAP-G346-ROUTE1 setup: seeding the recorded Charlottetown pack through the REAL SupabasePackStore");
  {
    const seeded = await seedDestinationFromRecordedPack(
      new SupabasePackStore(db),
      breadthDestination("Charlottetown"),
      load("packs/pack-charlottetown.json").data,
      { workerId: "gap-g346-suite" }
    );
    const { data: packs } = await db.from("roamly_destination_packs").select("pack_version_id,status").eq("status", "ready");
    check("pack seeded to a ready pack row over PostgREST", (packs || []).length === 1, `${(packs || []).length} ready packs`);
    const { count } = await db
      .from("roamly_destination_candidates")
      .select("*", { count: "exact", head: true });
    check("candidate rows landed in the real table", (count || 0) > 100, `${count} rows`);
  }

  const jobsFor = async (tripId) =>
    (await db.from("roamly_trip_generation_jobs").select("*").eq("trip_id", tripId)).data || [];
  const stateOf = async (tripId) => {
    const { data } = await db.from("roamly_trips").select("metadata").eq("id", tripId).maybeSingle();
    return getStagedGenerationState(data.metadata, tripId);
  };
  const itinerariesFor = async (tripId) =>
    (await db.from("roamly_itineraries").select("id,source,full_json").eq("trip_id", tripId)).data || [];
  const predictionsFor = async (tripId) =>
    (await db.from("roamly_trip_predictions").select("prediction_id").eq("trip_id", tripId)).data || [];
  const emailsFor = (tripId) => globalThis.__capturedGenerationEmails.filter((e) => e.tripId === tripId);

  const NORMAL = { executionBudgetMs: 300000, stageCleanupBufferMs: 1000, maxLayersPerRun: 8, leaseSeconds: 240 };
  async function createTripJob(tripId, tag) {
    const { error } = await db.from("roamly_trips").insert({
      id: tripId,
      user_id: USER,
      metadata: {
        planning: {
          tripType: "single_destination", origin: "Saint John", destination: entry.destination,
          destinationCity: entry.destination, startDate, endDate, daysCount: entry.days
        }
      },
      status: "generating",
      itinerary_status: "generating",
      itinerary_unlock_source: "paid"
    });
    if (error) throw new Error(`trip insert failed: ${error.message}`);
    const store = createSupabaseEngineGenerationStore(db);
    await startEngineGeneration({
      store, tripId, userId: USER, payload, requestId: `req-${tag}-start`,
      unlockSource: "paid", context: emptyContext()
    });
    const created = await createOrResumeGenerationJob({
      supabase: db, tripId, userId: USER, payload, priority: 10,
      generationVersion: "zero-engine-v1", reason: `${tag}_route_creation`
    });
    if (!created.ok) throw new Error(`job create failed: ${JSON.stringify(created)}`);
    return created.job;
  }
  async function drive(tripId, tag) {
    for (let calls = 0; calls < 14; calls++) {
      const st = await stateOf(tripId);
      if (!st || st.status === "complete" || st.status === "failed" || st.status === "partially_failed") break;
      await processGenerationQueue({ tripId, userId: USER, requestId: `req-${tag}-${calls}`, config: NORMAL });
      const js = await jobsFor(tripId);
      check(`${tag}: still exactly one job row after queue call ${calls}`, js.length === 1, `${js.length} jobs`);
    }
  }

  /* ═══ T1: queued → complete via the cron's own entry point ═══ */
  console.log("GAP-G346-ROUTE1/T1: zero-engine trip driven ONLY by processGenerationQueue calls (real RPCs)");
  const T1 = "11111111-1111-4111-8111-111111111111";
  const job1 = await createTripJob(T1, "g346");
  {
    const js = await jobsFor(T1);
    check("T1: real get_or_create RPC created exactly one job", js.length === 1, `${js.length}`);
    check("T1: job is queued, zero-engine version", js[0].status === "queued" && js[0].generation_version === "zero-engine-v1", `${js[0].status}/${js[0].generation_version}`);
    check("T1: route creation minted the job the worker will claim", job1.id === js[0].id, `${job1.id} vs ${js[0].id}`);
  }
  await processGenerationQueue({
    tripId: T1, userId: USER, requestId: "req-g346-0",
    config: { executionBudgetMs: 30000, stageCleanupBufferMs: 1000, maxLayersPerRun: 8, leaseSeconds: 240 }
  });
  {
    const js = await jobsFor(T1);
    check("T1: still exactly one job row after queue call 0", js.length === 1, `${js.length} jobs`);
    const st = await stateOf(T1);
    check("T1: budget yield stopped after exactly the outline stage", st.status === "generating_day" && st.completedDayCount === 0, `${st.status} ${st.completedDayCount}/${st.totalDayCount}`);
    check("T1: the outline stage run is recorded in state", st.stageRuns.some((r) => r.stage === "outline" && r.status === "success"), JSON.stringify(st.stageRuns.map((r) => `${r.stage}:${r.status}`)));
  }
  await drive(T1, "T1");
  {
    const st = await stateOf(T1);
    check("T1: generation state reached complete", st.status === "complete", `${st.status}/${st.currentStage} err=${st.errorCode || st.errorMessage || ""}`);
    check("T1: zero AI calls", st.aiCallCount === 0, `${st.aiCallCount}`);
    const js = await jobsFor(T1);
    check("T1: job completed by the real finalize RPCs", js.length === 1 && js[0].status === "completed" && Boolean(js[0].completed_at), JSON.stringify(js.map((j) => j.status)));
    check("T1: job lock released at completion", !js[0].locked_by && !js[0].lease_expires_at, `locked_by=${js[0].locked_by}`);
    const { data: layers } = await db.from("roamly_trip_generation_layers").select("layer_type").eq("job_id", js[0].id).eq("status", "completed");
    const layerTypes = (layers || []).map((l) => l.layer_type);
    check("T1: staged_day layers completed in the real table", layerTypes.filter((t) => t.startsWith("staged_day_")).length === 3, layerTypes.join(","));
    check("T1: outline + finalization layers completed in the real table", layerTypes.includes("staged_outline") && layerTypes.includes("staged_finalization"), layerTypes.join(","));
    const itins = await itinerariesFor(T1);
    check("T1: exactly one itinerary row", itins.length === 1, `${itins.length}`);
    check("T1: itinerary stamped source zero-engine", itins[0] && itins[0].source === "zero-engine", itins[0] && itins[0].source);
    const v = itins[0] ? validateItineraryForProduction(itins[0].full_json, payload) : { ok: false };
    check("T1: final itinerary passes production validation", v.ok === true, JSON.stringify(v).slice(0, 200));
    const preds = await predictionsFor(T1);
    check("T1: exactly one prediction row", preds.length === 1, `${preds.length}`);
    check("T1: exactly one completion email captured", emailsFor(T1).filter((e) => e.kind === "completion").length === 1, JSON.stringify(emailsFor(T1)));
  }

  /* ═══ T2: crashed worker (expired lease) reclaimed by later calls ═══ */
  console.log("GAP-G346-ROUTE1/T2: expired-lease reclaim via the real claim_by_trip RPC");
  const T2 = "33333333-3333-4333-8333-333333333333";
  await createTripJob(T2, "g346t2");
  await processGenerationQueue({
    tripId: T2, userId: USER, requestId: "req-t2-0",
    config: { executionBudgetMs: 30000, stageCleanupBufferMs: 1000, maxLayersPerRun: 8, leaseSeconds: 240 }
  });
  {
    const stMid = await stateOf(T2);
    check("T2: first call yielded mid-generation", stMid.status !== "complete" && stMid.completedDayCount < stMid.totalDayCount, `${stMid.status} ${stMid.completedDayCount}/${stMid.totalDayCount}`);
    const past = new Date(Date.now() - 60000).toISOString();
    const { error } = await db.from("roamly_trip_generation_jobs").update({
      status: "running", locked_by: "roamly-worker:dead", locked_at: past,
      lease_expires_at: past, started_at: past, current_stage: "worker_claimed"
    }).eq("trip_id", T2);
    check("T2: crash shape written (dead worker, lease 60 s expired)", !error, error && error.message);
  }
  await drive(T2, "T2");
  {
    const st = await stateOf(T2);
    check("T2: generation completed after the reclaim", st.status === "complete", `${st.status}/${st.currentStage}`);
    const js = await jobsFor(T2);
    check("T2: still exactly one job row", js.length === 1, `${js.length}`);
    check("T2: job completed, dead worker's lock gone", js[0].status === "completed" && js[0].locked_by !== "roamly-worker:dead", `${js[0].status}/${js[0].locked_by}`);
    const itins = await itinerariesFor(T2);
    check("T2: exactly one itinerary, production-valid", itins.length === 1 && validateItineraryForProduction(itins[0].full_json, payload).ok === true, `${itins.length}`);
    check("T2: exactly one completion email captured", emailsFor(T2).filter((e) => e.kind === "completion").length === 1, JSON.stringify(emailsFor(T2)));
  }
} finally {
  await teardown();
}

console.log(`\nGAP-G346-ROUTE1 E2E QUEUE WORKER (REAL POSTGRESQL 16 + POSTGREST 12.2.3): ${assertions} assertions, ${failures.length} failures`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log("GAP-G346-ROUTE1 E2E QUEUE WORKER PASSED");
