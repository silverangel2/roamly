// Roamly ship-fixes checks (2026-10-22 follow-up release for the
// four SHIP-REPORT defects):
//
//   1. Advance-endpoint 503s for engine jobs — the worker's
//      ensureTripJob resume omitted the job's generationVersion, so
//      the idempotency key defaulted to the brain version, missed
//      the existing zero-engine job, and the INSERT collided with
//      roamly_trip_generation_jobs_active_trip_idx. Section 1
//      exercises that pre-fix call shape (a direct
//      createOrResumeGenerationJob without a version — the exact
//      call the old ensureTripJob made) and proves it now RESUMES
//      the engine job: since the 2026-10-29 Fix #1 amendment, job
//      creation runs through the atomic RPC
//      roamly_get_or_create_generation_job, which the fake client
//      below emulates with the migration's own semantics (plus
//      fidelity scenarios against the real function and negative
//      checks proving the emulation can fail). It then proves the
//      fixed ensureTripJob resumes the engine job.
//   2. All-in budget verdict display model (pure formatter).
//   3. Must-see extraction from desire phrasing + named-miss lines.
//   4. Overpass collector hardening (fake fetcher: chunk failure,
//      partial acceptance, deadline discipline).
//
// Run: npm run test:wiring-fixes  (or --only=<1|2|3|4>)

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ONLY = new Set(((process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)).split(",").filter(Boolean));
const section = (name) => ONLY.size === 0 || ONLY.has(String(name));

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label}\n  GOT:  ${JSON.stringify(actual)}\n  WANT: ${JSON.stringify(expected)}`);
}

/* ------------------------------------------------------------------ */
/* Fake PostgREST client — the ship-checks pattern, generalized: any  */
/* table auto-exists empty; declared uniques + the jobs table's       */
/* active-trip partial index reproduce production constraint names.   */
/* ------------------------------------------------------------------ */

const TABLE_DEFS = {
  roamly_trips: { uniques: [["id"]] },
  roamly_trip_generation_jobs: {
    uniques: [["user_id", "idempotency_key"]],
    activeTripIndex: true
  },
  roamly_trip_generation_layers: { uniques: [["job_id", "layer_type", "generation_version"]] }
};
const ACTIVE_JOB_STATUSES = ["queued", "running", "waiting"];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

class FakeDb {
  constructor() {
    this.tables = new Map();
    this.stampSeq = 0;
  }

  stamp() {
    this.stampSeq += 1;
    return new Date(Date.UTC(2026, 9, 22, 12, 0, 0) + this.stampSeq * 1000).toISOString();
  }

  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table);
  }

  def(table) {
    return TABLE_DEFS[table] || { uniques: [] };
  }

  checkUniques(table, candidate, ignoreRow) {
    const def = this.def(table);
    for (const cols of def.uniques) {
      for (const row of this.rows(table)) {
        if (ignoreRow && row === ignoreRow) continue;
        if (cols.every((c) => deepEqual(row[c], candidate[c]))) {
          return {
            code: "23505",
            message: `duplicate key value violates unique constraint "${table}_${cols.join("_")}_idx"`
          };
        }
      }
    }
    if (def.activeTripIndex && ACTIVE_JOB_STATUSES.includes(candidate.status)) {
      for (const row of this.rows(table)) {
        if (ignoreRow && row === ignoreRow) continue;
        if (row.trip_id === candidate.trip_id && ACTIVE_JOB_STATUSES.includes(row.status)) {
          return {
            code: "23505",
            message: 'duplicate key value violates unique constraint "roamly_trip_generation_jobs_active_trip_idx"'
          };
        }
      }
    }
    return null;
  }

  insert(table, inputRows) {
    const inserted = [];
    for (const input of inputRows) {
      const row = structuredClone(input);
      if (row.id === undefined) row.id = randomUUID();
      if (row.created_at === undefined) row.created_at = this.stamp();
      if (row.updated_at === undefined) row.updated_at = this.stamp();
      const conflict = this.checkUniques(table, row, null);
      if (conflict) return { data: null, error: conflict };
      this.rows(table).push(row);
      inserted.push(row);
    }
    return { data: inserted, error: null };
  }

  matches(row, filters) {
    for (const f of filters) {
      const value = row[f.col];
      if (f.op === "eq" && !deepEqual(value, f.val)) return false;
      if (f.op === "in" && !f.val.some((v) => deepEqual(value, v))) return false;
      if (f.op === "lte" && !(value <= f.val)) return false;
      if (f.op === "gte" && !(value >= f.val)) return false;
      if (f.op === "is" && !(f.val === null ? value === null || value === undefined : deepEqual(value, f.val))) return false;
    }
    return true;
  }

  select(table, filters, orders, limitN) {
    let out = this.rows(table).filter((row) => this.matches(row, filters));
    for (const order of [...orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[order.col];
        const bv = b[order.col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order.ascending ? cmp : -cmp;
      });
    }
    if (limitN !== null) out = out.slice(0, limitN);
    return out.map((row) => structuredClone(row));
  }

  update(table, patch, filters) {
    const matched = this.rows(table).filter((row) => this.matches(row, filters));
    for (const row of matched) {
      const conflict = this.checkUniques(table, { ...row, ...structuredClone(patch) }, row);
      if (conflict) return { data: null, error: conflict };
    }
    for (const row of matched) {
      Object.assign(row, structuredClone(patch));
      row.updated_at = this.stamp();
    }
    return { data: matched.map((row) => structuredClone(row)), error: null };
  }

  deleteRows(table, filters) {
    const before = this.rows(table).length;
    this.tables.set(table, this.rows(table).filter((row) => !this.matches(row, filters)));
    return { data: null, error: null, deleted: before - this.rows(table).length };
  }

  upsert(table, input, onConflictCols, ignoreDuplicates) {
    const inputs = Array.isArray(input) ? input : [input];
    const out = [];
    for (const item of inputs) {
      const existing = this.rows(table).find((row) => onConflictCols.every((c) => deepEqual(row[c], item[c])));
      if (existing) {
        if (!ignoreDuplicates) Object.assign(existing, structuredClone(item));
        out.push(structuredClone(existing));
        continue;
      }
      const result = this.insert(table, [item]);
      if (result.error) return { data: null, error: result.error };
      out.push(result.data[0]);
    }
    return { data: out, error: null };
  }
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.mode = null;
    this.payload = null;
    this.upsertOpts = null;
    this.filters = [];
    this.orders = [];
    this.limitN = null;
    this.returnCols = null;
  }

  select(cols) {
    if (this.mode === null) this.mode = "select";
    else this.returnCols = cols;
    return this;
  }

  insert(payload) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(patch) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  upsert(payload, opts) {
    this.mode = "upsert";
    this.payload = payload;
    this.upsertOpts = opts || {};
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(col, val) {
    this.filters.push({ op: "eq", col, val });
    return this;
  }

  neq(col, val) {
    this.filters.push({ op: "eq", col: val, negate: true });
    return this;
  }

  in(col, val) {
    this.filters.push({ op: "in", col, val });
    return this;
  }

  lte(col, val) {
    this.filters.push({ op: "lte", col, val });
    return this;
  }

  gte(col, val) {
    this.filters.push({ op: "gte", col, val });
    return this;
  }

  is(col, val) {
    this.filters.push({ op: "is", col, val });
    return this;
  }

  order(col, opts) {
    this.orders.push({ col, ascending: !opts || opts.ascending !== false });
    return this;
  }

  limit(n) {
    this.limitN = n;
    return this;
  }

  project(row, cols) {
    if (!row || !cols || cols === "*") return row;
    const out = {};
    for (const col of cols.split(",").map((c) => c.trim())) out[col] = row[col];
    return out;
  }

  execute() {
    if (this.mode === "select") {
      const filters = this.filters.map((f) => (f.negate ? { ...f, op: "neq" } : f));
      const rows = this.db.select(this.table, filters, this.orders, this.limitN);
      return { data: rows.map((r) => this.project(r, this.returnCols && this.mode === "select" ? this.returnCols : "*")), error: null };
    }
    if (this.mode === "insert") {
      const inputs = Array.isArray(this.payload) ? this.payload : [this.payload];
      const result = this.db.insert(this.table, inputs);
      if (result.error) return { data: null, error: result.error };
      return { data: this.returnCols ? result.data.map((r) => this.project(r, this.returnCols)) : null, error: null };
    }
    if (this.mode === "update") {
      const result = this.db.update(this.table, this.payload, this.filters);
      if (result.error) return { data: null, error: result.error };
      return { data: this.returnCols ? result.data.map((r) => this.project(r, this.returnCols)) : null, error: null };
    }
    if (this.mode === "upsert") {
      const onConflict = (this.upsertOpts.onConflict || "id").split(",").map((c) => c.trim());
      const result = this.db.upsert(this.table, this.payload, onConflict, this.upsertOpts.ignoreDuplicates === true);
      if (result.error) return { data: null, error: result.error };
      return { data: this.returnCols ? result.data.map((r) => this.project(r, this.returnCols)) : null, error: null };
    }
    if (this.mode === "delete") {
      const result = this.db.deleteRows(this.table, this.filters);
      return { data: null, error: result.error };
    }
    throw new Error("fake query executed with no mode");
  }

  async single() {
    const { data, error } = this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) {
      return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const { data, error } = this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return { data: null, error: null };
    if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    return { data: rows[0], error: null };
  }

  then(onFulfilled, onRejected) {
    let result;
    try {
      result = this.execute();
    } catch (err) {
      return Promise.reject(err).then(onFulfilled, onRejected);
    }
    return Promise.resolve({ data: result.data, error: result.error }).then(onFulfilled, onRejected);
  }
}

/* ------------------------------------------------------------------ */
/* Fake RPC — roamly_get_or_create_generation_job, emulated from the  */
/* migration SQL itself (20261029000100), not from the app's hopes:   */
/*   step 1: the ACTIVE job for the trip (any key) wins; the          */
/*           caller's mutable fields merge onto it in place           */
/*           (greatest priority, coalesce stage/plan/reason/key, OR   */
/*           paid) and it returns with resumed = true.                */
/*   step 2: a same-(user, idempotency-key) job in any other status   */
/*           returns untouched, resumed = true (status NEVER flipped).*/
/*   step 3: insert exactly one row (resumed = false) — unless the    */
/*           active-trip arbiter or the (user_id, idempotency_key)    */
/*           unique index conflicts; both are swallowed exactly as    */
/*           the SQL swallows them (DO NOTHING / caught               */
/*           unique_violation) and control falls to the re-selects.   */
/*   step 4: re-select active, then keyed; if neither is visible the  */
/*           function raises (P0001) instead of looping.              */
/* PostgREST bind-time casts run BEFORE the body: a mistyped uuid /   */
/* integer / boolean argument fails with 22P02, and a NULL trip or    */
/* user id fails the insert with 23502 — both surface as errors,      */
/* never as fabricated rows. Unknown function names fail with the     */
/* PostgREST schema-cache error (PGRST202).                           */
/* ------------------------------------------------------------------ */

const GET_OR_CREATE_RPC = "roamly_get_or_create_generation_job";
const RPC_JOB_COLUMNS = [
  "id", "trip_id", "user_id", "status", "priority", "current_stage",
  "generation_version", "model_version", "retry_count", "next_attempt_at",
  "locked_at", "locked_by", "lease_expires_at", "idempotency_key",
  "last_error_code", "last_error_message", "created_at", "started_at",
  "completed_at", "updated_at", "user_plan", "paid_priority",
  "queue_priority_reason", "duplicate_request_key"
];
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function rpcJobShape(row, resumed) {
  const out = {};
  for (const col of RPC_JOB_COLUMNS) out[col] = row[col] === undefined ? null : row[col];
  out.resumed = resumed;
  return out;
}

function emulateGetOrCreateGenerationJob(db, args) {
  const a = args || {};
  // Bind-time casts (PostgREST -> Postgres) precede the function body.
  for (const param of ["p_trip_id", "p_user_id"]) {
    const v = a[param];
    if (v !== undefined && v !== null && (typeof v !== "string" || !UUID_SHAPE.test(v))) {
      return { data: null, error: { code: "22P02", message: `invalid input syntax for type uuid: "${v}"` } };
    }
  }
  if (a.p_priority !== undefined && a.p_priority !== null && !Number.isInteger(a.p_priority)) {
    return { data: null, error: { code: "22P02", message: `invalid input syntax for type integer: "${a.p_priority}"` } };
  }
  if (a.p_paid_priority !== undefined && a.p_paid_priority !== null && typeof a.p_paid_priority !== "boolean") {
    return { data: null, error: { code: "22P02", message: `invalid input syntax for type boolean: "${a.p_paid_priority}"` } };
  }

  const jobs = db.rows("roamly_trip_generation_jobs");
  // v_version := coalesce(nullif(p_generation_version, ''), 'roamly-brain-v1')
  const version = a.p_generation_version ? a.p_generation_version : "roamly-brain-v1";
  // v_key := p_trip_id::text || ':' || v_version (NULL when trip is NULL)
  const key = a.p_trip_id === undefined || a.p_trip_id === null ? null : `${a.p_trip_id}:${version}`;
  const newestFirst = (x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0);
  const activeForTrip = () =>
    a.p_trip_id === undefined || a.p_trip_id === null
      ? null
      : jobs.filter((j) => j.trip_id === a.p_trip_id && ACTIVE_JOB_STATUSES.includes(j.status)).sort(newestFirst)[0] || null;
  const keyedJob = () =>
    key === null
      ? null
      : jobs.filter((j) => j.user_id === a.p_user_id && j.idempotency_key === key).sort(newestFirst)[0] || null;

  // Step 1 — the active job for the trip wins, whatever its key; the
  // function's UPDATE merges the caller's mutable fields onto it.
  let active = activeForTrip();
  if (active) {
    active.priority = Math.max(
      active.priority === undefined || active.priority === null ? 0 : active.priority,
      a.p_priority === undefined || a.p_priority === null ? 0 : a.p_priority
    );
    if (a.p_current_stage !== undefined && a.p_current_stage !== null) active.current_stage = a.p_current_stage;
    if (a.p_user_plan !== undefined && a.p_user_plan !== null) active.user_plan = a.p_user_plan;
    active.paid_priority = Boolean(active.paid_priority) || Boolean(a.p_paid_priority);
    if (a.p_queue_priority_reason !== undefined && a.p_queue_priority_reason !== null) {
      active.queue_priority_reason = a.p_queue_priority_reason;
    }
    if (a.p_duplicate_request_key !== undefined && a.p_duplicate_request_key !== null) {
      active.duplicate_request_key = a.p_duplicate_request_key;
    }
    active.updated_at = db.stamp();
    return { data: [rpcJobShape(active, true)], error: null };
  }

  // Step 2 — a same-key job in a non-active status returns untouched.
  const keyed = keyedJob();
  if (keyed) return { data: [rpcJobShape(keyed, true)], error: null };

  // Step 3 — the insert. NULL trip/user violate NOT NULL (23502),
  // exactly as the real INSERT statement fails.
  if (a.p_trip_id === undefined || a.p_trip_id === null) {
    return {
      data: null,
      error: { code: "23502", message: 'null value in column "trip_id" of relation "roamly_trip_generation_jobs" violates not-null constraint' }
    };
  }
  if (a.p_user_id === undefined || a.p_user_id === null) {
    return {
      data: null,
      error: { code: "23502", message: 'null value in column "user_id" of relation "roamly_trip_generation_jobs" violates not-null constraint' }
    };
  }
  const activeConflict = jobs.some((j) => j.trip_id === a.p_trip_id && ACTIVE_JOB_STATUSES.includes(j.status));
  const keyConflict = jobs.some((j) => j.user_id === a.p_user_id && j.idempotency_key === key);
  if (!activeConflict && !keyConflict) {
    const now = db.stamp();
    const row = {
      id: randomUUID(),
      trip_id: a.p_trip_id,
      user_id: a.p_user_id,
      status: "queued",
      priority: Math.max(0, a.p_priority === undefined || a.p_priority === null ? 0 : a.p_priority),
      current_stage: a.p_current_stage === undefined ? null : a.p_current_stage,
      generation_version: version,
      model_version: a.p_model_version === undefined ? null : a.p_model_version,
      retry_count: 0,
      next_attempt_at: now,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      idempotency_key: key,
      last_error_code: null,
      last_error_message: null,
      created_at: now,
      started_at: null,
      completed_at: null,
      updated_at: now,
      user_plan: a.p_user_plan === undefined || a.p_user_plan === null ? "free" : a.p_user_plan,
      paid_priority: Boolean(a.p_paid_priority),
      queue_priority_reason: a.p_queue_priority_reason === undefined ? null : a.p_queue_priority_reason,
      duplicate_request_key: a.p_duplicate_request_key === undefined ? null : a.p_duplicate_request_key
    };
    jobs.push(row);
    return { data: [rpcJobShape(row, false)], error: null };
  }

  // Step 4 — lost the race: the winner is visible now. Prefer the
  // active job, then the keyed job; otherwise raise, never loop.
  active = activeForTrip();
  if (active) return { data: [rpcJobShape(active, true)], error: null };
  const keyedAfter = keyedJob();
  if (keyedAfter) return { data: [rpcJobShape(keyedAfter, true)], error: null };
  return {
    data: null,
    error: { code: "P0001", message: `roamly_get_or_create_generation_job: conflict with no visible row for trip ${a.p_trip_id}` }
  };
}

function createFakeSupabaseClient() {
  const db = new FakeDb();
  const rpcCalls = [];
  let armedRpcResponse = null;
  return {
    from(table) {
      return new FakeQuery(db, table);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args || {}) });
      if (armedRpcResponse) {
        const response = armedRpcResponse;
        armedRpcResponse = null;
        return response;
      }
      if (name !== GET_OR_CREATE_RPC) {
        return {
          data: null,
          error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` }
        };
      }
      return emulateGetOrCreateGenerationJob(db, args || {});
    },
    __db: db,
    __rpcCalls: rpcCalls,
    // Test-only failure arming: the NEXT rpc() call returns exactly
    // this response, once. The negative checks arm it to prove the
    // code under test surfaces bad responses instead of inventing a
    // job — the emulation itself never fabricates these responses.
    __armRpcResponseOnce(response) {
      armedRpcResponse = response;
    }
  };
}

// A client that delegates to `fake` but rewrites the RPC name or
// arguments in transit — the only way to drive the real code into
// the wrong-name / wrong-argument failure modes without touching
// the code under test.
function wrapRpcClient(fake, rewrite) {
  return {
    from(table) {
      return fake.from(table);
    },
    rpc(name, args) {
      const rewritten = rewrite(name, args);
      return fake.rpc(rewritten.name, rewritten.args);
    },
    __db: fake.__db,
    __rpcCalls: fake.__rpcCalls
  };
}

/* ================================================================== */
/* Section 1 — Fix #1: advance 503s for engine jobs                   */
/* ================================================================== */

if (section(1)) {
  const { createOrResumeGenerationJob, ROAMLY_BRAIN_VERSION } = await import("@/lib/roamly/generationQueue.ts");
  const { ensureTripJob } = await import("@/lib/roamly/generationWorker.ts");
  const { ZERO_ENGINE_GENERATION_VERSION } = await import("@/lib/roamly/engine/generate.ts");

  const USER = "11111111-1111-4111-8111-111111111111";

  function seedTripWithJob(fake, { tripId, version, jobStatus = "queued" }) {
    const db = fake.__db;
    db.insert("roamly_trips", [{
      id: tripId,
      user_id: USER,
      metadata: {},
      itinerary_status: "generating",
      status: "draft",
      updated_at: db.stamp()
    }]);
    const job = {
      id: randomUUID(),
      trip_id: tripId,
      user_id: USER,
      status: jobStatus,
      priority: 10,
      user_plan: "free",
      paid_priority: false,
      queue_priority_reason: "generate_route",
      duplicate_request_key: null,
      current_stage: "outline",
      generation_version: version,
      model_version: "fake-model",
      idempotency_key: `${tripId}:${version}`,
      next_attempt_at: db.stamp(),
      retry_count: 0
    };
    db.insert("roamly_trip_generation_jobs", [job]);
    return job;
  }

  // --- POST-FIX CONTRACT (re-expressed 2026-10-29, the disclosed
  // Fix #1 test amendment): the pre-fix call shape (the old
  // ensureTripJob called createOrResumeGenerationJob with NO
  // generationVersion). Pre-fix this block asserted the call FAILED
  // with the roamly_trip_generation_jobs_active_trip_idx collision —
  // that premise is exactly what Fix #1 removes. Under the approved
  // contract, creation is atomic on the trip's ACTIVE job (the RPC
  // above), so the same call shape now RESUMES the existing engine
  // job: same job back, marked resumed, no new row, no error.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "22222222-2222-4222-8222-222222222222";
    const seeded = seedTripWithJob(fake, { tripId: TRIP, version: ZERO_ENGINE_GENERATION_VERSION });
    const repro = await createOrResumeGenerationJob({
      supabase: fake,
      tripId: TRIP,
      userId: USER,
      payload: null,
      priority: 10,
      reason: "worker_trip_target"
    });
    eq(repro.ok, true, "1-REPRO: pre-fix call shape (no version) now succeeds — creation keys on the active job, not the version key");
    eq(repro.job.id, seeded.id, "1-REPRO: the returned job IS the existing zero-engine job");
    eq(repro.resumed, true, "1-REPRO: the existing job is reported as resumed");
    eq(repro.job.generation_version, ZERO_ENGINE_GENERATION_VERSION, "1-REPRO: the resumed job keeps the engine version (no brain-key alias)");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 1, "1-REPRO: no duplicate job row was created");
  }

  // --- FIXED: ensureTripJob resumes the engine job.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "33333333-3333-4333-8333-333333333333";
    seedTripWithJob(fake, { tripId: TRIP, version: ZERO_ENGINE_GENERATION_VERSION });
    const res = await ensureTripJob({ admin: fake, tripId: TRIP, userId: USER });
    eq(res.ok, true, "1: ensureTripJob succeeds for a zero-engine job");
    eq(res.jobReady, true, "1: jobReady is true for the engine job");
    const jobs = fake.__db.rows("roamly_trip_generation_jobs");
    eq(jobs.length, 1, "1: still exactly one job row — the engine job was resumed, not duplicated");
    eq(jobs[0].generation_version, ZERO_ENGINE_GENERATION_VERSION, "1: the resumed job keeps the engine version");
  }

  // --- Regression: a brain job still resumes exactly as before.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "44444444-4444-4444-8444-444444444444";
    seedTripWithJob(fake, { tripId: TRIP, version: ROAMLY_BRAIN_VERSION });
    const res = await ensureTripJob({ admin: fake, tripId: TRIP, userId: USER });
    eq(res.ok, true, "1: ensureTripJob still succeeds for a brain job");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 1, "1: brain job resumed in place");
  }

  // --- Regression: no job yet — a fresh job is created with the
  // default (brain) version, the pre-engine behavior.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "55555555-5555-4555-8555-555555555555";
    fake.__db.insert("roamly_trips", [{
      id: TRIP, user_id: USER, metadata: {}, itinerary_status: "generating", status: "draft", updated_at: fake.__db.stamp()
    }]);
    const res = await ensureTripJob({ admin: fake, tripId: TRIP, userId: USER });
    eq(res.ok, true, "1: ensureTripJob creates a job when none exists");
    const jobs = fake.__db.rows("roamly_trip_generation_jobs");
    eq(jobs.length, 1, "1: exactly one job created");
    eq(jobs[0].generation_version, ROAMLY_BRAIN_VERSION, "1: the fresh job carries the default brain version");
  }

  // --- CONTRACT: the code drives the RPC by its exact name, with
  // the trip, the owner, and the defaulted brain version.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "66666666-6666-4666-8666-666666666666";
    fake.__db.insert("roamly_trips", [{
      id: TRIP, user_id: USER, metadata: {}, itinerary_status: "generating", status: "draft", updated_at: fake.__db.stamp()
    }]);
    const res = await createOrResumeGenerationJob({
      supabase: fake, tripId: TRIP, userId: USER, payload: null, priority: 10, reason: "contract_probe"
    });
    eq(res.ok, true, "1-CONTRACT: fresh create through the RPC succeeds");
    eq(fake.__rpcCalls.length, 1, "1-CONTRACT: exactly one RPC call was made");
    eq(fake.__rpcCalls[0].name, GET_OR_CREATE_RPC, "1-CONTRACT: the RPC is called by its exact production name");
    eq(fake.__rpcCalls[0].args.p_trip_id, TRIP, "1-CONTRACT: p_trip_id is the trip");
    eq(fake.__rpcCalls[0].args.p_user_id, USER, "1-CONTRACT: p_user_id is the trip owner");
    eq(fake.__rpcCalls[0].args.p_generation_version, ROAMLY_BRAIN_VERSION, "1-CONTRACT: an omitted version defaults to the brain version before the call");
  }

  /* ---------------------------------------------------------------- */
  /* FIDELITY: the fake RPC against the migration's own contract.     */
  /* These scenarios mirror tests-harness.cjs (T1/T2/T6a/T6c/T6b)     */
  /* against the REAL function on local Postgres; AMENDMENT-REPORT.md */
  /* tabulates fake vs real outcomes per scenario. The emulation      */
  /* must agree with the SQL — where they could disagree, the SQL     */
  /* wins and the emulation is what gets fixed.                       */
  /* ---------------------------------------------------------------- */

  const rpcArgs = (tripId, version) => ({
    p_trip_id: tripId,
    p_user_id: USER,
    p_generation_version: version,
    p_priority: 0,
    p_user_plan: "free",
    p_paid_priority: false,
    p_queue_priority_reason: "fidelity",
    p_duplicate_request_key: null,
    p_current_stage: null,
    p_model_version: "fake-model"
  });
  const seedJobRow = (fake, { tripId, version, status = "queued" }) => {
    const db = fake.__db;
    const job = {
      id: randomUUID(),
      trip_id: tripId,
      user_id: USER,
      status,
      priority: 0,
      user_plan: "free",
      paid_priority: false,
      queue_priority_reason: null,
      duplicate_request_key: null,
      current_stage: null,
      generation_version: version,
      model_version: "fake-model",
      idempotency_key: `${tripId}:${version}`,
      next_attempt_at: db.stamp(),
      retry_count: 0
    };
    db.insert("roamly_trip_generation_jobs", [job]);
    return job;
  };

  // F1 (= harness T1, RPC level; the REPRO block above is the same
  // scenario through the app code): a BRAIN-key call against an
  // active zero-engine job returns THAT job, resumed, no new row.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "77777777-7777-4777-8777-777777777777";
    const seeded = seedJobRow(fake, { tripId: TRIP, version: ZERO_ENGINE_GENERATION_VERSION });
    const r = await fake.rpc(GET_OR_CREATE_RPC, rpcArgs(TRIP, ROAMLY_BRAIN_VERSION));
    eq(r.error, null, "1-FIDELITY F1: version-mismatch call does not error");
    eq(r.data[0].id, seeded.id, "1-FIDELITY F1: the existing engine job is returned");
    eq(r.data[0].resumed, true, "1-FIDELITY F1: returned as resumed");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 1, "1-FIDELITY F1: still exactly one row");
  }

  // F2 (= harness T2): 16 mixed-version creates race on a fresh
  // trip. The fake serializes calls (single-threaded JS), so this
  // proves the OUTCOME contract — one row, one creator, fifteen
  // resumers, no errors — not the timing.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "88888888-8888-4888-8888-888888888888";
    const versions = [...Array(8).fill(ROAMLY_BRAIN_VERSION), ...Array(8).fill(ZERO_ENGINE_GENERATION_VERSION)];
    const results = await Promise.all(versions.map((v) => fake.rpc(GET_OR_CREATE_RPC, rpcArgs(TRIP, v))));
    eq(results.filter((r) => r.error).length, 0, "1-FIDELITY F2: no racing caller errors");
    eq(new Set(results.map((r) => r.data[0].id)).size, 1, "1-FIDELITY F2: every caller lands on the same single job");
    eq(results.filter((r) => r.data[0].resumed === false).length, 1, "1-FIDELITY F2: exactly one caller creates; the rest resume");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 1, "1-FIDELITY F2: exactly one row exists after the race");
  }

  // F3 (= harness T6a): a same-key COMPLETED job returns untouched.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "99999999-9999-4999-8999-999999999999";
    const seeded = seedJobRow(fake, { tripId: TRIP, version: ROAMLY_BRAIN_VERSION, status: "completed" });
    const r = await fake.rpc(GET_OR_CREATE_RPC, rpcArgs(TRIP, ROAMLY_BRAIN_VERSION));
    eq(r.error, null, "1-FIDELITY F3: terminal lookup does not error");
    eq(r.data[0].id, seeded.id, "1-FIDELITY F3: the completed job itself is returned");
    eq(r.data[0].status, "completed", "1-FIDELITY F3: returned status stays completed");
    eq(r.data[0].resumed, true, "1-FIDELITY F3: a pre-existing row reports resumed");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 1, "1-FIDELITY F3: no new row");
    eq(fake.__db.rows("roamly_trip_generation_jobs")[0].status, "completed", "1-FIDELITY F3: the stored row was never flipped active");
  }

  // F4 (= harness T6c + the masked-by-terminal hole): the trip's
  // NEWEST job is completed (brain key) while an OLDER zero-engine
  // job is still active. A brain-key call must return the ACTIVE
  // job — step 1 (active by trip) precedes the keyed lookup.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const activeSeed = seedJobRow(fake, { tripId: TRIP, version: ZERO_ENGINE_GENERATION_VERSION });
    seedJobRow(fake, { tripId: TRIP, version: ROAMLY_BRAIN_VERSION, status: "completed" });
    const r = await fake.rpc(GET_OR_CREATE_RPC, rpcArgs(TRIP, ROAMLY_BRAIN_VERSION));
    eq(r.data[0].id, activeSeed.id, "1-FIDELITY F4: the ACTIVE job wins over the newer terminal row");
    eq(r.data[0].status, "queued", "1-FIDELITY F4: the returned job is the active one");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 2, "1-FIDELITY F4: no row created or removed");
  }

  // F5 (= harness T6b): a finished trip (only a completed brain
  // job) still gets a genuinely new job under a different version.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const seeded = seedJobRow(fake, { tripId: TRIP, version: ROAMLY_BRAIN_VERSION, status: "completed" });
    const r = await fake.rpc(GET_OR_CREATE_RPC, rpcArgs(TRIP, ZERO_ENGINE_GENERATION_VERSION));
    eq(r.error, null, "1-FIDELITY F5: new-version create does not error");
    ok(r.data[0].id !== seeded.id, "1-FIDELITY F5: a NEW job row is created for the finished trip");
    eq(r.data[0].resumed, false, "1-FIDELITY F5: the new row reports resumed = false");
    eq(r.data[0].status, "queued", "1-FIDELITY F5: the new job starts queued");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 2, "1-FIDELITY F5: the finished row and the new row coexist");
    eq(
      fake.__db.rows("roamly_trip_generation_jobs").find((j) => j.id === seeded.id).status,
      "completed",
      "1-FIDELITY F5: the finished row stays completed"
    );
  }

  /* ---------------------------------------------------------------- */
  /* NEGATIVE CHECKS: the emulation must be able to FAIL, and the     */
  /* code under test must surface every failure as ok:false — never   */
  /* a silent success, never a fabricated job. Each check arms a      */
  /* deliberate failure mode and asserts on it; a mock that           */
  /* auto-passed would fail these by construction.                    */
  /* ---------------------------------------------------------------- */

  // (a) WRONG RPC NAME — PostgREST schema-cache failure, surfaced.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const direct = await fake.rpc("roamly_get_or_create_generation_jobs", rpcArgs(TRIP, ROAMLY_BRAIN_VERSION));
    eq(direct.data, null, "1-NEG name: a mistyped function name returns no data");
    eq(direct.error && direct.error.code, "PGRST202", "1-NEG name: a mistyped function name fails with the PostgREST schema-cache code");
    ok(
      String(direct.error && direct.error.message).includes("Could not find the function"),
      "1-NEG name: the error names the missing function"
    );
    // Through the real code: a client whose rpc rewrites the name
    // in transit drives createOrResumeGenerationJob into the same
    // failure, and the seeded trip gains NO job.
    fake.__db.insert("roamly_trips", [{
      id: TRIP, user_id: USER, metadata: {}, itinerary_status: "generating", status: "draft", updated_at: fake.__db.stamp()
    }]);
    const wrongName = wrapRpcClient(fake, (name, args) => ({ name: "roamly_get_or_create_generation_jobs", args }));
    const res = await createOrResumeGenerationJob({ supabase: wrongName, tripId: TRIP, userId: USER, payload: null, priority: 10 });
    eq(res.ok, false, "1-NEG name: the code surfaces the wrong-name failure as ok:false");
    ok(String(res.error).includes("Could not find the function"), "1-NEG name: the code carries the PostgREST error, not a generic success");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 0, "1-NEG name: no job was fabricated by the failed call");
  }

  // (b) WRONG ARGUMENTS — bind-time and statement-time failures.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    fake.__db.insert("roamly_trips", [{
      id: TRIP, user_id: USER, metadata: {}, itinerary_status: "generating", status: "draft", updated_at: fake.__db.stamp()
    }]);
    const mistyped = await fake.rpc(GET_OR_CREATE_RPC, { ...rpcArgs(TRIP, ROAMLY_BRAIN_VERSION), p_trip_id: "not-a-uuid" });
    eq(mistyped.error && mistyped.error.code, "22P02", "1-NEG args: a non-uuid trip id fails the bind cast (22P02)");
    const noTrip = wrapRpcClient(fake, (name, args) => ({ name, args: { ...args, p_trip_id: undefined } }));
    const resNoTrip = await createOrResumeGenerationJob({ supabase: noTrip, tripId: TRIP, userId: USER, payload: null, priority: 10 });
    eq(resNoTrip.ok, false, "1-NEG args: a missing trip id surfaces as ok:false");
    ok(String(resNoTrip.error).includes("violates not-null constraint"), "1-NEG args: the missing trip id fails as the real INSERT would (23502)");
    const badPriority = wrapRpcClient(fake, (name, args) => ({ name, args: { ...args, p_priority: "high" } }));
    const resBadPriority = await createOrResumeGenerationJob({ supabase: badPriority, tripId: TRIP, userId: USER, payload: null, priority: 10 });
    eq(resBadPriority.ok, false, "1-NEG args: a mistyped priority surfaces as ok:false");
    ok(String(resBadPriority.error).includes("invalid input syntax for type integer"), "1-NEG args: the mistyped priority fails the integer cast");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 0, "1-NEG args: no job was fabricated by any bad-argument call");
  }

  // (c) RESPONSE HANDLING — empty and malformed RPC responses are
  // the code's explicit GENERATION_JOB_NOT_RETURNED, never a job.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    fake.__db.insert("roamly_trips", [{
      id: TRIP, user_id: USER, metadata: {}, itinerary_status: "generating", status: "draft", updated_at: fake.__db.stamp()
    }]);
    const variants = [
      ["empty rows", { data: [], error: null }],
      ["null data", { data: null, error: null }],
      ["malformed non-array data", { data: { unexpected: true }, error: null }]
    ];
    for (const [label, response] of variants) {
      fake.__armRpcResponseOnce(response);
      const res = await createOrResumeGenerationJob({ supabase: fake, tripId: TRIP, userId: USER, payload: null, priority: 10 });
      eq(res.ok, false, `1-NEG response: ${label} surfaces as ok:false`);
      eq(res.error, "GENERATION_JOB_NOT_RETURNED", `1-NEG response: ${label} yields the explicit not-returned error`);
    }
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 0, "1-NEG response: no phantom job exists after the bad responses");
  }

  // (d) RPC ERROR RESPONSE — a forced error propagates intact.
  {
    const fake = createFakeSupabaseClient();
    const TRIP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    fake.__db.insert("roamly_trips", [{
      id: TRIP, user_id: USER, metadata: {}, itinerary_status: "generating", status: "draft", updated_at: fake.__db.stamp()
    }]);
    fake.__armRpcResponseOnce({ data: null, error: { code: "XX000", message: "forced rpc failure (wiring-fixes negative check)" } });
    const res = await createOrResumeGenerationJob({ supabase: fake, tripId: TRIP, userId: USER, payload: null, priority: 10 });
    eq(res.ok, false, "1-NEG error: a forced RPC error surfaces as ok:false");
    eq(res.error, "forced rpc failure (wiring-fixes negative check)", "1-NEG error: the RPC error message reaches the caller intact");
    eq(fake.__db.rows("roamly_trip_generation_jobs").length, 0, "1-NEG error: no job was fabricated by the failed call");
  }

  console.log(`Section 1 (fix #1 — advance 503 / version forwarding): ${count} assertions so far`);
}

/* ================================================================== */
/* Section 2 — Fix #2: all-in budget verdict display model            */
/* ================================================================== */

if (section(2)) {
  const { buildBudgetVerdictDisplay, readBudgetVerdictDisplay } = await import("@/lib/roamly/engine/budgetVerdictDisplay.ts");

  const posture = {
    verdict: "OVER",
    note: "even the bottom of the estimated range (CAD 1348) exceeds the cap (CAD 2400)",
    cap: { amount: 2400, currency: "CAD", verdict: null, verdictNote: null },
    coverage: 0.95,
    coverageThreshold: 0.5,
    pricedItems: 18,
    evidencedItems: 17,
    scopeLines: 20,
    evidencedScopeLines: 19,
    components: [
      {
        component: "lodging",
        name: "Hôtel Marie Rollett",
        applicable: true,
        evidenced: true,
        evidence: { tier: "BAND", range: { low: 440, high: 720, currency: "CAD", per: "party" }, basis: "recorded price level", source: "google" },
        nights: 4
      },
      {
        component: "transport",
        name: "Getting there",
        applicable: true,
        evidenced: false,
        evidence: { tier: "UNKNOWN", range: null, basis: "no evidence", source: "none" },
        nights: null
      }
    ],
    evidenceByTier: { BAND: 10 },
    estimatedTotals: { low: 1348, high: 2724, currency: "CAD" },
    payingParty: 2,
    scopeNote: "All-in scope: plan items + lodging (evidenced) + getting-there (not evidenced — excluded from the totals, never counted as zero).",
    priceBandsKnown: 9,
    bandDistribution: { MODERATE: 9 },
    bandSource: "google"
  };

  const display = buildBudgetVerdictDisplay(posture);
  eq(display.verdict, "OVER", "2: verdict rides through");
  eq(display.headline, "Over your budget", "2: OVER headline is plain traveler language");
  eq(display.totalLabel, "Estimated whole-trip total: CAD 1,348–2,724", "2: all-in totals shown with grouping");
  eq(display.capLabel, "Your budget: CAD 2,400", "2: cap shown");
  ok(display.coverageLabel.includes("19 of 20"), "2: coverage stated over all-in scope lines");
  eq(display.componentLines.length, 2, "2: both applicable components listed");
  const lodgingLine = display.componentLines.find((l) => l.label === "Lodging");
  ok(lodgingLine.evidenced && lodgingLine.detail.includes("CAD 440–720") && lodgingLine.detail.includes("4 nights"), "2: lodging priced with its range and nights");
  const transportLine = display.componentLines.find((l) => l.label === "Getting there");
  eq(transportLine.evidenced, false, "2: transport honestly unevidenced");
  ok(transportLine.detail.includes("never counted as $0"), "2: unevidenced component NAMED, never zero-filled");

  // The no-evidence posture: 0–0 totals must never present as a price.
  const blind = buildBudgetVerdictDisplay({
    ...posture,
    verdict: "UNVERIFIABLE",
    note: "the plan carries no priced items to judge",
    evidencedScopeLines: 0,
    estimatedTotals: { low: 0, high: 0, currency: "CAD" },
    components: posture.components.map((c) => ({ ...c, evidenced: false, evidence: { tier: "UNKNOWN", range: null, basis: "none", source: "none" } }))
  });
  eq(blind.totalLabel, null, "2: no-evidence posture shows NO total (0-0 is not a price)");
  eq(blind.headline, "We couldn't fully check this trip against your budget", "2: UNVERIFIABLE headline is honest");

  // Day-trip lodging is not applicable: it leaves the display entirely.
  const dayTrip = buildBudgetVerdictDisplay({
    ...posture,
    components: [{ ...posture.components[0], applicable: false }, posture.components[1]]
  });
  eq(dayTrip.componentLines.length, 1, "2: non-applicable lodging excluded from component lines");
  eq(dayTrip.componentLines[0].label, "Getting there", "2: only the applicable component remains");

  // Read-side: stamped doc round-trips; incumbent/tampered docs do not.
  const doc = { trip_title: "x", budget_verdict_display: display };
  const readBack = readBudgetVerdictDisplay(doc);
  ok(readBack && readBack.verdict === "OVER" && readBack.componentLines.length === 2, "2: stamped doc reads back through the guard");
  eq(readBudgetVerdictDisplay({ trip_title: "incumbent — no stamp" }), null, "2: incumbent doc yields null (legacy display)");
  eq(readBudgetVerdictDisplay({ budget_verdict_display: { ...display, version: 99 } }), null, "2: unknown version rejected");
  eq(readBudgetVerdictDisplay(null), null, "2: null doc yields null");

  console.log(`Section 2 (fix #2 — all-in verdict display): ${count} assertions so far`);
}

/* ================================================================== */
/* Section 3 — Fix #3: desire must-sees + named miss                  */
/* ================================================================== */

if (section(3)) {
  const { extractConstraints, extractMustSeeDesires, namedMustSeeMiss } = await import("@/lib/roamly/engine/understand.ts");
  const { deriveMustSees } = await import("@/lib/roamly/engine/generate.ts");

  const PARIS_REQUEST =
    "We are a couple in our thirties planning an easy four day break in Paris, our first visit. Please keep every morning relaxed with no starts before nine, and leave one full rest afternoon in the middle of the trip with nothing booked so we can wander our own neighbourhood. Our total budget cap for the whole trip is 2400 Canadian dollars, so favour great-value bistros over splurges. We would love a morning at a local food market and an evening walk along the river, plus time in one museum. Keep walks between stops short and mostly flat.";

  const desires = extractMustSeeDesires(PARIS_REQUEST);
  eq(desires.length, 3, `3: the Paris request yields three desire must-sees (got: ${JSON.stringify(desires)})`);
  ok(desires.some((d) => /food market/.test(d)), "3: food market desire extracted");
  ok(desires.some((d) => /river/.test(d)), "3: river walk desire extracted");
  ok(desires.some((d) => /museum/.test(d)), "3: museum desire extracted (the 'plus …' segment)");

  const extracted = extractConstraints(PARIS_REQUEST);
  eq(JSON.stringify(extracted.mustSeeDesires), JSON.stringify(desires), "3: extractConstraints carries the desires");

  // Golden safety: the pool's own phrasings must NOT grow desires —
  // "a couple who love the mountains" is a self-description, and
  // the "include … please" asks already flow through placeItems.
  const banffText =
    "We are a couple who love the mountains but not early alarms for a slow four day break. Please keep every day gentle, with no starts before ten and one full rest afternoon in the middle. Keep the total budget under one thousand five hundred dollars, avoid long walks between stops, and also include the gondola ride up Sulphur Mountain and an afternoon at the hot springs please.";
  eq(extractMustSeeDesires(banffText).length, 0, "3: 'who love the mountains' does NOT fire (golden safety)");
  const quebecText =
    "We are a couple traveling with our two kids, aged six and nine for an easy five day break. Please keep every day gentle, with no starts before nine and one full rest afternoon in the middle. Keep the total budget under one thousand one hundred dollars, avoid long walks between stops, and also include the ferry ride across to Levis and a trip out to Montmorency Falls please.";
  eq(extractMustSeeDesires(quebecText).length, 0, "3: include-please requests grow no duplicate desires");

  // Derivation: the desires become solver must-sees through the
  // same pattern ladder as every other must-see source.
  const fakePack = {
    destination: "Paris",
    sights: [
      { name: "Marché Mouffetard", kind: "market" },
      { name: "Musée de l'Orangerie", kind: "museum" }
    ],
    excursions: [],
    transport: []
  };
  const specs = deriveMustSees({ explicitRequirements: [], constraints: {} }, extracted, fakePack);
  const labels = specs.map((s) => s.label);
  ok(labels.some((l) => /food market/.test(l)), "3: food market desire derives into a must-see spec");
  ok(labels.some((l) => /museum/.test(l)), "3: museum desire derives into a must-see spec");
  const marketSpec = specs.find((l) => /food market/.test(l.label));
  ok(marketSpec.patterns.some((p) => p.toLowerCase().includes("market")), "3: market spec carries the market pattern for kind matching");

  // The named miss: exact, honest, deterministic.
  eq(
    namedMustSeeMiss("one museum", "Paris"),
    "One honest gap: you asked for a museum. The open place data for Paris has no verified match for it, so it is named here instead of being invented.",
    "3: named-miss line is the honest sentence"
  );

  console.log(`Section 3 (fix #3 — desire must-sees + named miss): ${count} assertions so far`);
}

/* ================================================================== */
/* Section 4 — Fix #4: Overpass collector hardening                   */
/* ================================================================== */

if (section(4)) {
  const {
    collectPoiCandidates,
    fetchOverpass,
    mainOverpassQuery,
    mainOverpassQueryChunks,
    liveBuildProvenance,
    OVERPASS_ENDPOINTS
  } = await import("@/lib/roamly/engine/packs/collectors.ts");

  const DEST = {
    destinationId: "dst-test",
    centre: { lat: 46.81, lon: -71.21 },
    bbox: { minLat: 46.7, minLon: -71.35, maxLat: 46.92, maxLon: -71.07 }
  };
  const FAST = { attemptTimeoutMs: 5000, maxRounds: 1, backoffBaseMs: 1 };

  const el = (id, tags) => ({ type: "node", id, lat: 46.81, lon: -71.21, tags });
  function fakeFetcher(handler) {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url, body: init.body || "" });
      const query = decodeURIComponent((init.body || "").replace(/^data=/, ""));
      const outcome = handler(query, url);
      if (outcome === "fail") return { ok: false, status: 429, text: async () => "rate limited" };
      return { ok: true, status: 200, text: async () => JSON.stringify({ elements: outcome }) };
    };
    fetcher.calls = calls;
    return fetcher;
  }
  const elementsFor = (query) => {
    if (query.includes('"waterfall"')) return [el(3, { name: "Chute Test", waterway: "waterfall" })];
    if (query.includes('"tourism"')) return [el(1, { name: "Musée Test", tourism: "museum" })];
    if (query.includes("fast_food")) return [el(2, { name: "Bistro Test", amenity: "restaurant" })];
    return [el(4, { name: "Parc Test", leisure: "park" })];
  };

  // Chunk union == the shipped union query, semantically: expand
  // every regex alternation (amenity~"a|b|c") into per-value
  // statements on both sides, then the sets must be identical —
  // the hardening may regroup statements across chunks but must
  // not drop or add a single selector.
  {
    const expand = (stmt) => {
      const m = stmt.match(/^(\w+\["[^"]+)"~"([^"]+)"(.*)$/);
      if (!m) return [stmt];
      return m[2].split("|").map((alt) => `${m[1]}="${alt}"${m[3]}`);
    };
    const statements = (q) =>
      q
        .replace(/\[out:json\]\[timeout:\d+\];/, "")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s && s !== "(" && s !== ");" && s !== "out center;")
        .flatMap(expand)
        .sort();
    const union = statements(mainOverpassQuery(DEST.bbox));
    const chunked = mainOverpassQueryChunks(DEST.bbox).flatMap((c) => statements(c.query)).sort();
    eq(JSON.stringify(chunked), JSON.stringify(union), "4: chunk selectors == shipped union selectors, expanded (nothing dropped, nothing added)");
    eq(mainOverpassQueryChunks(DEST.bbox).length, 5, "4: five main chunks");
  }

  // Happy path: every chunk arrives — complete, classified, deduped.
  {
    const fetcher = fakeFetcher((q) => elementsFor(q));
    const col = await collectPoiCandidates(fetcher, DEST, FAST);
    eq(col.evidence.partial, false, "4: full collection is not partial");
    eq(col.evidence.succeededChunks.length, 6, "4: 5 main chunks + wide succeeded");
    ok(col.candidates.some((c) => c.kind === "museum"), "4: museum candidate classified");
    ok(col.candidates.some((c) => c.kind === "falls"), "4: wide-chunk falls candidate classified");
    ok(!liveBuildProvenance(col, col.evidence.fetchedAt).label.includes("PARTIAL"), "4: complete provenance carries no PARTIAL mark");
  }

  // One chunk hard-fails (429 everywhere): PARTIAL, named, others live.
  {
    const fetcher = fakeFetcher((q) => (q.includes("fast_food") ? "fail" : elementsFor(q)));
    const col = await collectPoiCandidates(fetcher, DEST, FAST);
    eq(col.evidence.partial, true, "4: a dead chunk degrades the collection to PARTIAL, not failure");
    eq(JSON.stringify(col.evidence.failedChunks), JSON.stringify(["food"]), "4: the failed chunk is named (food)");
    ok(col.candidates.some((c) => c.kind === "museum"), "4: surviving chunks still classify");
    const label = liveBuildProvenance(col, col.evidence.fetchedAt).label;
    ok(label.includes("PARTIAL") && label.includes("food"), "4: provenance label discloses the partial collection and the missing chunk");
  }

  // Every chunk fails: honest total failure (the queue retries later).
  {
    const fetcher = fakeFetcher(() => "fail");
    let threw = "";
    try {
      await collectPoiCandidates(fetcher, DEST, FAST);
    } catch (err) {
      threw = String(err && err.message ? err.message : err);
    }
    ok(threw.includes("every chunk"), `4: total failure throws honestly (got: ${threw.slice(0, 80)})`);
  }

  // Deadline discipline: the injected clock jumps 70 s per read; at
  // a 210 s deadline only the first chunks start, the rest are
  // marked failed-before-start and the collection goes partial.
  {
    let t = Date.UTC(2026, 9, 22, 12, 0, 0);
    const clock = () => new Date((t += 70_000));
    const fetcher = fakeFetcher((q) => elementsFor(q));
    const col = await collectPoiCandidates(fetcher, DEST, FAST, clock, 210_000);
    eq(col.evidence.partial, true, "4: deadline overrun yields a partial collection");
    ok(col.evidence.succeededChunks.length >= 1 && col.evidence.succeededChunks.length < 6, "4: some chunks landed before the deadline, the rest never started");
    eq(col.evidence.succeededChunks.length + col.evidence.failedChunks.length, 6, "4: every chunk is accounted for");
  }

  // Endpoint rotation heals a 429: first endpoint refuses, second serves.
  {
    const fetcher = fakeFetcher((q, url) => (url === OVERPASS_ENDPOINTS[0] ? "fail" : elementsFor(q)));
    const res = await fetchOverpass(fetcher, mainOverpassQueryChunks(DEST.bbox)[0].query, FAST);
    eq(res.endpoint, OVERPASS_ENDPOINTS[1], "4: fetch rotates off a 429-ing endpoint to the mirror");
    ok(res.attempts >= 2, "4: rotation is counted in attempts");
  }

  console.log(`Section 4 (fix #4 — Overpass hardening): ${count} assertions so far`);
}

/* ================================================================== */
/* Section 5 — Fix #5: auto-registration for unregistered cities      */
/* ================================================================== */

if (section(5)) {
  const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
  const { SupabasePackStore } = await import("@/lib/roamly/engine/packs/supabaseStore.ts");
  const { resolveDestinationId } = await import("@/lib/roamly/engine/generate.ts");
  const { classifyGeocodeResults, geocodePlaceWithNominatim, buildAutoRegistration } = await import(
    "@/lib/roamly/engine/geocode.ts"
  );
  const { destinationRegistryId, shadowBBox, PARIS_DESTINATION } = await import(
    "@/lib/roamly/engine/packs/destinations.ts"
  );

  // Verbatim jsonv2 shape from the live service (2026-10-22):
  // the class field is named "category" — a fixture modeled on
  // the v1 name let Lisbon classify not_found in production.
  const LISBON_NOMINATIM = [
    {
      osm_type: "relation",
      osm_id: 5400890,
      lat: "38.7077507",
      lon: "-9.1365919",
      category: "boundary",
      type: "administrative",
      importance: 0.7635036148306796,
      display_name: "Lisbon, Portugal",
      address: { city: "Lisbon", county: "Lisbon", country: "Portugal", country_code: "pt" }
    },
    {
      osm_type: "relation",
      osm_id: 2897141,
      lat: "38.9952469",
      lon: "-9.1435928",
      category: "boundary",
      type: "administrative",
      importance: 0.5597440686440401,
      display_name: "Lisbon, Portugal",
      address: { county: "Lisbon", country: "Portugal", country_code: "pt" }
    }
  ];
  const lisbonPlace = {
    canonicalName: "Lisbon",
    country: "Portugal",
    countryCode: "pt",
    centre: { lat: 38.7077507, lon: -9.1365919 },
    osmType: "relation",
    osmId: 5400890,
    importance: 0.7635036148306796,
    displayName: "Lisbon, Portugal"
  };
  const lisbonId = destinationRegistryId("Portugal", "Lisbon", { lat: 38.7077507, lon: -9.1365919 });
  const depsFor = (packStore, geocoder) => ({
    store: {},
    packStore,
    geocoder,
    timeZoneForCoords: async () => "Europe/Lisbon"
  });

  // Nominatim classification: found / not_found / ambiguous.
  {
    const found = classifyGeocodeResults(LISBON_NOMINATIM);
    eq(found.kind, "found", "5: Lisbon geocodes to a found place");
    eq(found.place.canonicalName, "Lisbon", "5: canonical name from the geocoder address");
    eq(found.place.country, "Portugal", "5: canonical country");
    eq(classifyGeocodeResults([]).kind, "not_found", "5: empty result set is not_found");
    const ambiguous = classifyGeocodeResults([
      { osm_type: "node", osm_id: 1, lat: "39.9", lon: "-89.6", category: "place", type: "city", importance: 0.55, display_name: "Springfield, Illinois, United States", address: { city: "Springfield", country: "United States", country_code: "us" } },
      { osm_type: "node", osm_id: 2, lat: "49.2", lon: "-123.0", category: "place", type: "city", importance: 0.5, display_name: "Springfield, British Columbia, Canada", address: { city: "Springfield", country: "Canada", country_code: "ca" } }
    ]);
    eq(ambiguous.kind, "ambiguous", "5: cross-country near-tie is ambiguous, not a coin flip");
    const viaHttp = await geocodePlaceWithNominatim(
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify(LISBON_NOMINATIM) }),
      "Lisbon"
    );
    eq(viaHttp.kind, "found", "5: Nominatim HTTP path classifies a real payload");
    const down = await geocodePlaceWithNominatim(
      async () => ({ ok: false, status: 503, text: async () => "" }),
      "Lisbon"
    );
    eq(down.kind, "unavailable", "5: geocoder 503 is unavailable (transient), never not_found");
  }

  // The registration row itself: registry identity + shadow bbox + provenance.
  {
    const dto = buildAutoRegistration(lisbonPlace, "Europe/Lisbon", new Date("2026-10-22T12:00:00.000Z"));
    eq(dto.destinationId, lisbonId, "5: registration ID is the registry content ID");
    eq(JSON.stringify(dto.bbox), JSON.stringify(shadowBBox(dto.centre, "city")), "5: bbox follows the registry shadow rule");
    eq(dto.geocodeProvenance.source, "nominatim", "5: provenance names the geocoder");
    eq(dto.geocodeProvenance.sourceRef, "nominatim:relation:5400890", "5: provenance carries the OSM identity");
  }

  // End-to-end resolution: unknown city registers, then resolves;
  // a spelling variant dedupes onto the same registration.
  {
    const store = new InMemoryPackStore(() => new Date());
    let geocodeCalls = 0;
    const geocoder = async () => {
      geocodeCalls += 1;
      return { kind: "found", place: lisbonPlace };
    };
    const id = await resolveDestinationId(depsFor(store, geocoder), { destination: "Lisbon", destinationCity: "Lisbon" });
    eq(id, lisbonId, "5: unregistered Lisbon resolves to the new registration");
    eq(geocodeCalls, 1, "5: exactly one geocode for a new destination");
    const registered = await store.listDestinations();
    eq(registered.length, 1, "5: one registry row was created");
    eq(registered[0].timeZone, "Europe/Lisbon", "5: plan-time zone recorded on the row");
    const again = await resolveDestinationId(depsFor(store, geocoder), { destination: "Lisboa", destinationCity: "Lisboa" });
    eq(again, lisbonId, "5: spelling variant dedupes onto the same registration (OSM identity)");
    eq((await store.listDestinations()).length, 1, "5: the variant did not fork the registry");
  }

  // A registry hit never geocodes.
  {
    const store = new InMemoryPackStore(() => new Date());
    await store.registerDestination(PARIS_DESTINATION);
    const geocoder = async () => {
      throw new Error("geocoder must not be called for a registered destination");
    };
    const id = await resolveDestinationId(depsFor(store, geocoder), { destination: "Paris", destinationCity: "Paris" });
    eq(id, PARIS_DESTINATION.destinationId, "5: registered Paris resolves from the registry, no geocode");
  }

  // Honest failures: unresolvable + ambiguous are permanent and
  // coded distinctly; a geocoder outage is transient.
  {
    const store = new InMemoryPackStore(() => new Date());
    const attempt = async (geocoder) => {
      try {
        await resolveDestinationId(depsFor(store, geocoder), { destination: "Nowheresville", destinationCity: "Nowheresville" });
        return null;
      } catch (err) {
        return err;
      }
    };
    const nf = await attempt(async () => ({ kind: "not_found" }));
    eq(nf.code, "ZERO_ENGINE_DESTINATION_UNRESOLVABLE", "5: unresolvable name fails with its own code");
    eq(nf.permanent, true, "5: unresolvable is permanent (no retry loop)");
    ok(nf.message.includes("could not find"), "5: unresolvable wording is traveler-facing");
    const amb = await attempt(async () => ({ kind: "ambiguous", candidates: ["Springfield, United States", "Springfield, Canada"] }));
    eq(amb.code, "ZERO_ENGINE_DESTINATION_UNRESOLVABLE", "5: ambiguity shares the honest-failure code");
    ok(amb.message.includes("Springfield, Canada"), "5: ambiguity names the candidate places");
    const un = await attempt(async () => ({ kind: "unavailable", reason: "boom" }));
    eq(un.code, "ZERO_ENGINE_GEOCODER_UNAVAILABLE", "5: geocoder outage has a distinct code");
    eq(un.permanent, false, "5: geocoder outage is transient (job retries)");
  }

  // Durability: a registration written by one SupabasePackStore
  // instance is visible to a NEW instance over the same settings
  // table (the drain process is not the registering process).
  {
    const rows = new Map();
    const fakeClient = {
      from(table) {
        if (table !== "roamly_admin_settings") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            like: async (_col, pattern) => {
              const prefix = String(pattern).replace(/%$/, "");
              return {
                data: [...rows.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => ({ value: v })),
                error: null
              };
            }
          }),
          upsert: async (row) => {
            rows.set(row.key, row.value);
            return { error: null };
          }
        };
      }
    };
    const dto = buildAutoRegistration(lisbonPlace, "Europe/Lisbon", new Date("2026-10-22T12:00:00.000Z"));
    const writer = new SupabasePackStore(fakeClient, () => new Date());
    await writer.registerDestination(dto);
    const reader = new SupabasePackStore(fakeClient, () => new Date());
    const listed = await reader.listDestinations();
    ok(listed.some((d) => d.destinationId === lisbonId), "5: registration survives across store instances (drain can resolve it)");
    const got = await reader.getDestination(lisbonId);
    eq(got?.geocodeProvenance.sourceRef, "nominatim:relation:5400890", "5: provenance survives the round trip");
    let dupThrew = false;
    try {
      await reader.registerDestination(dto);
    } catch (err) {
      dupThrew = String(err.code || err.message).includes("DUPLICATE");
    }
    ok(dupThrew, "5: re-registering the same place is a duplicate, not a fork");

    // A dead settings table degrades reads to the compiled-in
    // registry — destination lookups never die with it.
    const deadClient = {
      from() {
        return {
          select: () => ({
            like: async () => {
              throw new Error("fetch failed");
            }
          }),
          upsert: async () => ({ error: { message: "down" } })
        };
      }
    };
    const degraded = new SupabasePackStore(deadClient, () => new Date());
    const served = await degraded.listDestinations();
    ok(served.some((d) => d.displayName === "Paris"), "5: registry still serves seeds when the settings read fails");
  }

  console.log(`Section 5 (fix #5 — auto-registration): ${count} assertions so far`);
}

console.log(`roamly-wiring-fixes-checks: ${count} assertions PASS`);
