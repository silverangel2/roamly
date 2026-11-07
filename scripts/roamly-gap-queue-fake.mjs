// GAP-CLOSURE WAVE 3 (2026-11-02, LOCAL ONLY) — shared queue fake for
// the G3+G4 / G6 suites.
//
// ROUTE TAKEN FOR G3+G4: Route 2 (JS emulation) — see
// harness/GAP-D-CHANGELOG.md for the Route 1 (real Postgres +
// PostgREST) attempt and its evidence. This module extends the diet
// FakeDb (scripts/roamly-egress-diet-fake.mjs) with:
//   1. Write-returning semantics PostgREST actually has
//      (insert/update/upsert ... .select(...) returns written rows;
//      the diet fake's select() after a write was a no-op, which
//      silently dropped those rows — SupabasePackStore,
//      syncGeneratedItinerary and the engine store all rely on them).
//   2. Real upsert conflict handling (onConflict columns +
//      ignoreDuplicates), which the diet fake modelled as plain
//      insert. Conflict keys used in-tree: generation layers
//      (job_id,layer_type,generation_version), admin settings (key),
//      generation states (trip_id).
//   3. .like("key", "prefix:%") — used by SupabasePackStore's
//      durable-destination registry read.
//   4. rpc(name, args) emulations of the generation queue RPCs,
//      transcribed from the FINAL version of each function in the
//      migration chain (see per-RPC provenance comments).
//
// FIDELITY NOTES (emulation choices, stated per RPC below):
//   - SKIP LOCKED: JS execution is single-threaded and every rpc()
//     runs to completion synchronously, so no row is ever locked by
//     another transaction when a claim runs. The eligibility +
//     ORDER BY + LIMIT semantics of the SQL are reproduced exactly;
//     the lock itself is vacuous in this model (same serialized-
//     execution caveat as wiring-fixes F2).
//   - now(): the SQL uses the transaction timestamp; the emulation
//     uses wall-clock Date.now() per call. Lease/next_attempt
//     comparisons are therefore real-time, exactly as the worker
//     experiences them against PostgREST.
//   - Composite-returning functions (claim_by_trip, complete_*,
//     schedule_*_retry) return a single row object or null, as
//     PostgREST presents them to supabase-js; setof functions
//     (claim_jobs, get_or_create) return arrays.

import { FakeDb, FakeQuery } from "./roamly-egress-diet-fake.mjs";

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const nowIso = () => new Date().toISOString();
const plusSeconds = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const timeMs = (v) => (v == null ? null : new Date(v).getTime());

export class GapQuery extends FakeQuery {
  select(cols, opts) {
    // PostgREST: select after a write returns the written rows.
    this.selectCols = cols;
    if (opts?.count) this.countMode = opts.count;
    if (opts?.head) this.head = true;
    return this;
  }
  like(col, pattern) {
    const prefix = String(pattern).replace(/%.*$/, "");
    this.filters.push((r) => typeof r[col] === "string" && r[col].startsWith(prefix));
    return this;
  }
  insert(rows) {
    if (this.table === "roamly_itineraries") {
      const arr = Array.isArray(rows) ? rows : [rows];
      for (const row of arr) if (row.repair_revision === undefined) row.repair_revision = 0;
    }
    return super.insert(rows);
  }
  upsert(rows, opts) {
    this.writeKind = "upsertGap";
    this.writeRow = rows;
    this.upsertOpts = opts || {};
    return this;
  }
  execute() {
    if (this.writeKind === "upsertGap") {
      const rowsIn = Array.isArray(this.writeRow) ? this.writeRow : [this.writeRow];
      const table = (this.db.tables[this.table] = this.db.tables[this.table] || []);
      const conflictCols = String(this.upsertOpts.onConflict || "id").split(",").map((s) => s.trim());
      const out = [];
      for (const incoming of rowsIn) {
        const existing = table.find((r) => conflictCols.every((c) => String(r[c] ?? "") === String(incoming[c] ?? "")));
        if (existing) {
          if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, clone(incoming));
          out.push(existing);
        } else {
          const stored = {
            id: incoming.id || `fake-${Math.random().toString(36).slice(2, 10)}`,
            created_at: incoming.created_at || new Date().toISOString(),
            ...clone(incoming)
          };
          table.push(stored);
          out.push(stored);
        }
      }
      this.db.log.push({ table: this.table, kind: "upsert", rows: out.length, bytes: 0 });
      return { data: this.selectCols ? out.map((r) => this.project(r)) : null, error: null, count: null };
    }
    return super.execute();
  }
}

/* ------------------------------------------------------------------ */
/* RPC emulations — final migration version of each function          */
/* ------------------------------------------------------------------ */

function tripIsTerminalRow(trip) {
  return (
    !trip ||
    ["archived", "cancelled", "completed"].includes(trip.status) ||
    (trip.itinerary_status || "") === "cancelled"
  );
}

function claimEligible(db, job, maxRetries, nowMs) {
  if (job.completed_at != null) return false;
  const trip = (db.tables.roamly_trips || []).find((t) => t.id === job.trip_id && t.user_id === job.user_id);
  if (!trip || tripIsTerminalRow(trip)) return false; // 20261001 join + terminal guard
  const nextMs = timeMs(job.next_attempt_at) ?? nowMs;
  if ((job.status === "queued" || job.status === "waiting") && nextMs <= nowMs) return true;
  if (job.status === "failed" && job.retry_count < maxRetries && nextMs <= nowMs) return true;
  if (job.status === "running" && (timeMs(job.lease_expires_at) ?? -Infinity) <= nowMs) return true;
  return false;
}

function applyClaim(job, workerId, leaseSeconds) {
  const now = nowIso();
  job.status = "running";
  job.locked_at = now;
  job.locked_by = workerId;
  job.lease_expires_at = plusSeconds(Math.max(30, leaseSeconds));
  job.started_at = job.started_at || now;
  job.last_error_code = null;
  job.last_error_message = null;
  job.updated_at = now;
  return job;
}

function claimSortKey(job) {
  // 20261001 claim_jobs ordering: queued/waiting first, then running,
  // then failed; priority desc; coalesce(next_attempt_at, created_at);
  // created_at; id.
  const category = job.status === "queued" || job.status === "waiting" ? 0 : job.status === "running" ? 1 : 2;
  return [category, -(job.priority || 0), job.next_attempt_at || job.created_at || "", job.created_at || "", job.id];
}
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

const RPCS = {
  // 20261029000100 — steps: 1 active wins (with the priority/stage
  // coalesce update), 2 same-key untouched, 3 fresh insert,
  // 4 race re-select (unreachable single-threaded; steps 1-2 cover it).
  roamly_get_or_create_generation_job(db, args) {
    const jobs = (db.tables.roamly_trip_generation_jobs = db.tables.roamly_trip_generation_jobs || []);
    const version = args.p_generation_version || "roamly-brain-v1";
    const key = `${args.p_trip_id}:${version}`;
    const active = jobs
      .filter((j) => j.trip_id === args.p_trip_id && ["queued", "running", "waiting"].includes(j.status))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (active) {
      active.priority = Math.max(active.priority || 0, args.p_priority || 0);
      active.current_stage = args.p_current_stage ?? active.current_stage;
      active.user_plan = args.p_user_plan ?? active.user_plan;
      active.paid_priority = Boolean(active.paid_priority || args.p_paid_priority);
      active.queue_priority_reason = args.p_queue_priority_reason ?? active.queue_priority_reason;
      active.duplicate_request_key = args.p_duplicate_request_key ?? active.duplicate_request_key;
      return [{ ...clone(active), resumed: true }];
    }
    const keyed = jobs
      .filter((j) => j.user_id === args.p_user_id && j.idempotency_key === key)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (keyed) return [{ ...clone(keyed), resumed: true }];
    db.__jobSeq = (db.__jobSeq || 0) + 1;
    const now = nowIso();
    const row = {
      id: `job-gap-${db.__jobSeq}`,
      trip_id: args.p_trip_id,
      user_id: args.p_user_id,
      status: "queued",
      priority: Math.max(0, Math.round(args.p_priority || 0)),
      current_stage: args.p_current_stage || null,
      generation_version: version,
      model_version: args.p_model_version || null,
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
      user_plan: args.p_user_plan || "free",
      paid_priority: args.p_paid_priority === true,
      queue_priority_reason: args.p_queue_priority_reason || null,
      duplicate_request_key: args.p_duplicate_request_key || null
    };
    jobs.push(row);
    return [{ ...clone(row), resumed: false }];
  },

  // 20261001000100 (terminal-guards) version.
  roamly_claim_generation_jobs(db, args) {
    const nowMs = Date.now();
    const eligible = (db.tables.roamly_trip_generation_jobs || [])
      .filter((j) => claimEligible(db, j, args.p_max_retries ?? 3, nowMs))
      .sort((a, b) => compareKeys(claimSortKey(a), claimSortKey(b)))
      .slice(0, Math.max(1, args.p_batch_size ?? 5));
    return eligible.map((j) => clone(applyClaim(j, args.p_worker_id, args.p_lease_seconds ?? 240)));
  },

  // 20261001000100 (terminal-guards) version.
  roamly_claim_generation_job_by_trip(db, args) {
    const nowMs = Date.now();
    const eligible = (db.tables.roamly_trip_generation_jobs || [])
      .filter((j) => j.trip_id === args.p_trip_id && claimEligible(db, j, args.p_max_retries ?? 3, nowMs))
      .sort((a, b) =>
        compareKeys(
          [-(a.priority || 0), a.next_attempt_at || a.created_at || "", a.created_at || "", a.id],
          [-(b.priority || 0), b.next_attempt_at || b.created_at || "", b.created_at || "", b.id]
        )
      );
    if (!eligible.length) return null;
    return clone(applyClaim(eligible[0], args.p_worker_id, args.p_lease_seconds ?? 240));
  },

  // 20260715 queue version (never redefined).
  roamly_claim_generation_layer(db, args) {
    const nowMs = Date.now();
    const layers = (db.tables.roamly_trip_generation_layers || []).filter((l) => l.job_id === args.p_job_id);
    const maxRetries = args.p_max_retries ?? 3;
    const eligible = layers
      .filter((l) => {
        const nextMs = timeMs(l.next_attempt_at) ?? nowMs;
        const statusOk =
          (l.status === "pending" && nextMs <= nowMs) ||
          (l.status === "failed" && l.retry_count < maxRetries && nextMs <= nowMs) ||
          (l.status === "running" && (timeMs(l.lease_expires_at) ?? -Infinity) <= nowMs);
        if (!statusOk) return false;
        return !layers.some(
          (prev) => prev.layer_sequence < l.layer_sequence && !["completed", "skipped"].includes(prev.status)
        );
      })
      .sort((a, b) => a.layer_sequence - b.layer_sequence);
    if (!eligible.length) return null;
    const layer = eligible[0];
    const now = nowIso();
    layer.status = "running";
    layer.locked_at = now;
    layer.locked_by = args.p_worker_id;
    layer.lease_expires_at = plusSeconds(Math.max(30, args.p_lease_seconds ?? 240));
    layer.started_at = layer.started_at || now;
    layer.error_code = null;
    layer.error_message = null;
    return clone(layer);
  },

  // 20260715 queue version (never redefined). NOTE: the SQL does not
  // touch updated_at on renew — reproduced.
  roamly_renew_generation_lease(db, args) {
    let updated = 0;
    for (const job of db.tables.roamly_trip_generation_jobs || []) {
      if (job.id === args.p_job_id && job.locked_by === args.p_worker_id && job.status === "running") {
        job.lease_expires_at = plusSeconds(Math.max(30, args.p_lease_seconds ?? 240));
        updated += 1;
      }
    }
    if (args.p_layer_id) {
      for (const layer of db.tables.roamly_trip_generation_layers || []) {
        if (
          layer.id === args.p_layer_id &&
          layer.job_id === args.p_job_id &&
          layer.locked_by === args.p_worker_id &&
          layer.status === "running"
        ) {
          layer.lease_expires_at = plusSeconds(Math.max(30, args.p_lease_seconds ?? 240));
        }
      }
    }
    return updated > 0;
  },

  // 20260731 worker-resume version: status in (running, waiting, failed).
  roamly_release_generation_job(db, args) {
    let updated = 0;
    for (const job of db.tables.roamly_trip_generation_jobs || []) {
      if (job.id === args.p_job_id && job.locked_by === args.p_worker_id && ["running", "waiting", "failed"].includes(job.status)) {
        job.status = ["queued", "waiting", "failed"].includes(args.p_next_status) ? args.p_next_status : "waiting";
        job.locked_at = null;
        job.locked_by = null;
        job.lease_expires_at = null;
        updated += 1;
      }
    }
    return updated > 0;
  },

  // 20260715 worker version.
  roamly_release_generation_layer(db, args) {
    let updated = 0;
    for (const layer of db.tables.roamly_trip_generation_layers || []) {
      if (layer.id === args.p_layer_id && layer.locked_by === args.p_worker_id && layer.status === "running") {
        layer.status = ["pending", "failed", "skipped"].includes(args.p_next_status) ? args.p_next_status : "pending";
        layer.locked_at = null;
        layer.locked_by = null;
        layer.lease_expires_at = null;
        updated += 1;
      }
    }
    return updated > 0;
  },

  // 20260731 worker-handoff version: running + (owner OR lease
  // null/expired); sets updated_at.
  roamly_complete_generation_layer(db, args) {
    for (const layer of db.tables.roamly_trip_generation_layers || []) {
      if (
        layer.id === args.p_layer_id &&
        layer.status === "running" &&
        (layer.locked_by === args.p_worker_id || layer.lease_expires_at == null || timeMs(layer.lease_expires_at) <= Date.now())
      ) {
        layer.status = "completed";
        layer.output_json = args.p_output_json || {};
        layer.evidence_json = args.p_evidence_json || {};
        layer.dependency_versions_json = args.p_dependency_versions_json ?? layer.dependency_versions_json;
        layer.locked_at = null;
        layer.locked_by = null;
        layer.lease_expires_at = null;
        layer.completed_at = nowIso();
        layer.error_code = null;
        layer.error_message = null;
        layer.updated_at = nowIso();
        return clone(layer);
      }
    }
    return null;
  },

  // 20260731 worker-handoff version: running + (owner OR lease
  // null/expired); next_attempt_at = now() (the NOT NULL repair).
  roamly_complete_generation_job(db, args) {
    for (const job of db.tables.roamly_trip_generation_jobs || []) {
      if (
        job.id === args.p_job_id &&
        job.status === "running" &&
        (job.locked_by === args.p_worker_id || job.lease_expires_at == null || timeMs(job.lease_expires_at) <= Date.now())
      ) {
        const now = nowIso();
        job.status = "completed";
        job.locked_at = null;
        job.locked_by = null;
        job.lease_expires_at = null;
        job.completed_at = now;
        job.next_attempt_at = now;
        job.last_error_code = null;
        job.last_error_message = null;
        job.updated_at = now;
        return clone(job);
      }
    }
    return null;
  },

  // 20260731 non-null-next-attempt version (job + layer share shape):
  // exhausted retries land on next_attempt_at = now(), never null.
  roamly_schedule_generation_job_retry(db, args) {
    return scheduleRetry(db.tables.roamly_trip_generation_jobs || [], args.p_job_id, args, "last_error_code", "last_error_message");
  },
  roamly_schedule_generation_layer_retry(db, args) {
    return scheduleRetry(db.tables.roamly_trip_generation_layers || [], args.p_layer_id, args, "error_code", "error_message");
  },

  // 20260715 worker version.
  roamly_skip_remaining_generation_layers(db, args) {
    const job = (db.tables.roamly_trip_generation_jobs || []).find((j) => j.id === args.p_job_id);
    // SQL: NOT EXISTS(job with locked_by DISTINCT FROM worker) —
    // a missing job proceeds; a job locked by anyone else (or
    // unlocked, NULL distinct) blocks.
    if (job && job.locked_by !== args.p_worker_id) return 0;
    let count = 0;
    for (const layer of db.tables.roamly_trip_generation_layers || []) {
      if (layer.job_id === args.p_job_id && ["pending", "failed", "invalidated"].includes(layer.status)) {
        layer.status = "skipped";
        layer.locked_at = null;
        layer.locked_by = null;
        layer.lease_expires_at = null;
        layer.completed_at = layer.completed_at || nowIso();
        layer.error_code = null;
        layer.error_message = String(args.p_reason || "Job completed before this compatibility layer ran.").slice(0, 2000);
        count += 1;
      }
    }
    return count;
  },

  // 20260715 queue version.
  roamly_invalidate_generation_layers(db, args) {
    let count = 0;
    for (const layer of db.tables.roamly_trip_generation_layers || []) {
      if (
        layer.job_id === args.p_job_id &&
        layer.layer_sequence >= args.p_from_sequence &&
        ["pending", "running", "completed", "failed"].includes(layer.status)
      ) {
        layer.status = "invalidated";
        layer.locked_at = null;
        layer.locked_by = null;
        layer.lease_expires_at = null;
        layer.error_code = "LAYER_INVALIDATED";
        layer.error_message = String(args.p_reason || "Layer dependency invalidated.").slice(0, 2000);
        count += 1;
      }
    }
    return count;
  },

  // 20260715 queue version.
  roamly_requeue_invalidated_layers(db, args) {
    let count = 0;
    for (const layer of db.tables.roamly_trip_generation_layers || []) {
      if (layer.job_id === args.p_job_id && layer.status === "invalidated") {
        layer.status = "pending";
        layer.retry_count = 0;
        layer.next_attempt_at = nowIso();
        layer.error_code = null;
        layer.error_message = null;
        layer.completed_at = null;
        layer.generation_version = args.p_generation_version || "roamly-brain-v1";
        count += 1;
      }
    }
    return count;
  },

  // 20261001000100 (terminal-guards) version.
  roamly_finalize_generation_trip(db, args) {
    if (!["free", "paid", "bundle", "admin"].includes(args.p_unlock_source)) return false;
    const paymentStatus = args.p_unlock_source === "free" ? "free" : args.p_unlock_source === "bundle" ? "bundled" : "paid";
    const trip = (db.tables.roamly_trips || []).find((t) => t.id === args.p_trip_id && t.user_id === args.p_user_id);
    if (!trip || tripIsTerminalRow(trip)) return false;
    const completedAt = args.p_completed_at || nowIso();
    trip.status = "generated";
    trip.itinerary_status = "generated";
    trip.itinerary_locked = true;
    trip.itinerary_locked_at = trip.itinerary_locked_at || completedAt;
    trip.itinerary_generated_at = trip.itinerary_generated_at || completedAt;
    trip.itinerary_unlock_source = trip.itinerary_unlock_source || args.p_unlock_source;
    trip.itinerary_payment_status =
      trip.itinerary_payment_status != null && trip.itinerary_payment_status !== "unpaid"
        ? trip.itinerary_payment_status
        : paymentStatus;
    trip.metadata = args.p_metadata ?? trip.metadata ?? {};
    trip.updated_at = completedAt;
    return true;
  },

  // 20261001000100 (terminal-guards) version — supersedes both
  // 20260731 finalize versions (adds the trip-terminal guards).
  roamly_finalize_generation_completion(db, args) {
    const jobs = db.tables.roamly_trip_generation_jobs || [];
    const job = jobs.find((j) => j.id === args.p_job_id);
    if (!job) return { ok: false, error: "GENERATION_JOB_NOT_FOUND" };
    if (args.p_user_id != null && job.user_id !== args.p_user_id) return { ok: false, error: "GENERATION_JOB_USER_MISMATCH" };
    const trip = (db.tables.roamly_trips || []).find((t) => t.id === job.trip_id && t.user_id === job.user_id);
    if (!trip) return { ok: false, error: "TRIP_NOT_FOUND" };
    if (tripIsTerminalRow(trip)) return { ok: false, error: "TRIP_TERMINAL" };
    const completedAt = args.p_completed_at || nowIso();
    let finalGeneration = clone(args.p_generation_state || trip.metadata?.generation || {});
    if (!finalGeneration || typeof finalGeneration !== "object" || Array.isArray(finalGeneration)) finalGeneration = {};
    const totalDays = Number.isInteger(finalGeneration.totalDayCount) ? finalGeneration.totalDayCount : null;
    const completedDays = Number.isInteger(finalGeneration.completedDayCount) ? finalGeneration.completedDayCount : null;
    finalGeneration = {
      ...finalGeneration,
      status: "complete",
      currentStage: "complete",
      completedAt: finalGeneration.completedAt || completedAt,
      updatedAt: completedAt,
      worker: null,
      lastError: null,
      lastErrorCode: null
    };
    if (totalDays != null) finalGeneration.completedDayCount = Math.max(completedDays || 0, totalDays);
    for (const layer of db.tables.roamly_trip_generation_layers || []) {
      if (layer.job_id === job.id && layer.status !== "completed") {
        layer.status = "completed";
        layer.locked_at = null;
        layer.locked_by = null;
        layer.lease_expires_at = null;
        layer.completed_at = layer.completed_at || completedAt;
        layer.error_code = null;
        layer.error_message = null;
        layer.updated_at = completedAt;
      }
    }
    job.status = "completed";
    job.current_stage = "completion_notification";
    job.next_attempt_at = null;
    job.locked_at = null;
    job.locked_by = null;
    job.lease_expires_at = null;
    job.completed_at = job.completed_at || completedAt;
    job.updated_at = completedAt;
    job.last_error_code = null;
    job.last_error_message = null;
    trip.status = "generated";
    trip.itinerary_status = "generated";
    trip.metadata = { ...(trip.metadata || {}), generation: finalGeneration };
    trip.updated_at = completedAt;
    const completedLayerCount = (db.tables.roamly_trip_generation_layers || []).filter(
      (l) => l.job_id === job.id && l.status === "completed"
    ).length;
    return { ok: true, jobId: job.id, tripId: job.trip_id, completedAt, completedLayerCount };
  },

  // 20260731 postgrest-finalization version. Its candidate gate is
  // staged-note-specific (zero-engine finals never qualify) —
  // reproduced, including the completion-email-sent metadata gate.
  roamly_reconcile_completed_generation_jobs(db, args) {
    const limit = Math.max(1, Math.min(200, Math.round(args.p_limit || 50)));
    const candidates = (db.tables.roamly_trip_generation_jobs || [])
      .filter((job) => {
        const trip = (db.tables.roamly_trips || []).find((t) => t.id === job.trip_id && t.user_id === job.user_id);
        if (!trip) return false;
        const activeIsh =
          ["queued", "waiting", "running", "failed"].includes(job.status) ||
          job.completed_at == null ||
          job.locked_at != null ||
          job.locked_by != null ||
          job.lease_expires_at != null ||
          trip.status === "generating" ||
          trip.itinerary_status === "generating";
        if (!activeIsh) return false;
        const hasStagedFinal = (db.tables.roamly_itineraries || []).some(
          (i) =>
            i.trip_id === job.trip_id &&
            i.user_id === job.user_id &&
            Array.isArray(i.full_json?.daily_itinerary) &&
            i.full_json.daily_itinerary.length > 0 &&
            /generated through roamly staged ai generation/i.test(i.full_json?.generation_note || "")
        );
        if (!hasStagedFinal) return false;
        const ge = trip.metadata?.generationEmail || {};
        return ge.completion_email_sent_at != null || ["sent", "captured"].includes(ge.completion_email_status) || ["sent", "captured"].includes(ge.delivery_status);
      })
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, limit);
    const repaired = [];
    for (const candidate of candidates) {
      const trip = (db.tables.roamly_trips || []).find((t) => t.id === candidate.trip_id);
      const result = RPCS.roamly_finalize_generation_completion(db, {
        p_job_id: candidate.id,
        p_user_id: candidate.user_id,
        p_generation_state: clone(trip?.metadata?.generation || {}),
        p_completed_at: nowIso()
      });
      if (result.ok === true) repaired.push(result);
    }
    return { ok: true, repairedCount: repaired.length, repaired };
  },

  // 20260715 scalability version returns the inserted cost row; the
  // worker treats any result as advisory (.catch(() => null)).
  roamly_record_generation_cost(db, args) {
    const table = (db.tables.roamly_generation_cost_events = db.tables.roamly_generation_cost_events || []);
    const row = {
      id: `cost-${table.length + 1}`,
      trip_id: args.p_trip_id,
      job_id: args.p_job_id,
      layer_id: args.p_layer_id,
      user_id: args.p_user_id,
      cost_category: args.p_cost_category,
      provider: args.p_provider,
      model: args.p_model,
      unit_count: args.p_unit_count,
      estimated_cost_usd: args.p_estimated_cost_usd,
      metadata: args.p_metadata || {},
      created_at: nowIso()
    };
    table.push(row);
    return clone(row);
  }
};

function scheduleRetry(rows, id, args, codeField, messageField) {
  const row = rows.find((r) => r.id === id && r.locked_by === args.p_worker_id && r.status === "running");
  if (!row) return null;
  const nextRetry = (row.retry_count || 0) + 1;
  const maxRetries = args.p_max_retries ?? 3;
  const delaySeconds = Math.min(
    Math.max(1, args.p_retry_max_seconds ?? 1800),
    Math.max(1, args.p_retry_base_seconds ?? 60) * 2 ** Math.max(0, nextRetry - 1)
  );
  row.status = "failed";
  row.retry_count = nextRetry;
  row.next_attempt_at = nextRetry < maxRetries ? plusSeconds(delaySeconds) : nowIso();
  row.locked_at = null;
  row.locked_by = null;
  row.lease_expires_at = null;
  row[codeField] = args.p_error_code;
  row[messageField] = String(args.p_error_message || "").slice(0, 2000);
  return clone(row);
}

export class GapDb extends FakeDb {
  constructor(tables = {}) {
    super(tables);
    this.rpcCalls = [];
  }
  from(table) {
    return new GapQuery(this, table);
  }
  async rpc(name, args = {}) {
    this.rpcCalls.push({ name, args: clone(args) });
    const fn = RPCS[name];
    if (!fn) {
      return {
        data: null,
        error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` }
      };
    }
    try {
      return { data: fn(this, args), error: null };
    } catch (error) {
      return { data: null, error: { code: "P0001", message: error instanceof Error ? error.message : String(error) } };
    }
  }
}

export function emptyGapTables() {
  return {
    roamly_trips: [],
    roamly_itineraries: [],
    roamly_itinerary_days: [],
    roamly_trip_activities: [],
    roamly_trip_checklists: [],
    roamly_trip_days: [],
    roamly_activities: [],
    roamly_trip_generation_jobs: [],
    roamly_trip_generation_layers: [],
    roamly_trip_predictions: [],
    roamly_trip_generation_states: [],
    roamly_destination_pack_builds: [],
    roamly_destination_packs: [],
    roamly_destination_candidates: [],
    roamly_destination_weather_snapshots: [],
    roamly_admin_settings: [],
    traveler_profiles: [],
    traveler_preference_events: [],
    roamly_email_logs: [],
    roamly_trip_events: [],
    roamly_generation_cost_events: [],
    roamly_communication_ledger: []
  };
}
