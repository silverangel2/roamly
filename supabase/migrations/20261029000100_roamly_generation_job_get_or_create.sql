-- 20261029000100_roamly_generation_job_get_or_create.sql
--
-- FILES ONLY — the owner applies this migration; agents never apply it.
--
-- Problem (see ATTRIBUTION.md): creation of a generation job looked the
-- job up by (user_id, idempotency_key) but the active-job uniqueness
-- rule is (trip_id) WHERE status IN ('queued','running','waiting').
-- Any caller computing a different key than the existing active job's
-- key (omitted generationVersion, or a "latest job" lookup masked by a
-- terminal row) INSERTed, collided with the active-trip index, and got
-- a 409 — and the duplicate-key handler re-read by the same wrong key
-- and missed again, so every scheduler wake repeated the 409 forever.
--
-- Fix: ONE atomic creation path. This function returns the existing
-- active job for the trip (whatever its key) when one exists, else
-- inserts exactly one row. Races resolve inside Postgres: the partial
-- active-trip index plus ON CONFLICT DO NOTHING plus a re-select mean
-- concurrent callers serialize onto one row and NO 409 ever escapes to
-- PostgREST. Catching and ignoring 409s in application code is NOT
-- done anywhere; this removes the error at its source.
--
-- What it deliberately does NOT do (preserved behavior):
-- - It never changes a job's status. Stale-lease reclaim stays with
--   roamly_claim_generation_jobs (queued/waiting due, failed with
--   retries left and due, running with expired lease; FOR UPDATE
--   SKIP LOCKED). A running job is returned untouched, so its lease
--   is never disturbed by creation.
-- - A failed job is returned untouched; the caller's existing reopen
--   path (failed -> waiting) still owns that transition.
-- - A completed/cancelled job is returned untouched, never flipped
--   back to active. A genuinely new job for a finished trip still
--   works via a different version key (current behavior, unchanged).
-- - At most one INSERT attempt plus pure re-selects: provably
--   terminating, no loop. The unique_violation handler covers the
--   second unique index (user_id, idempotency_key) for the case where
--   a same-key row commits between the reads and the insert.
--
-- Grants follow the existing claim-RPC pattern: service_role only.

create or replace function public.roamly_get_or_create_generation_job(
  p_trip_id uuid,
  p_user_id uuid,
  p_generation_version text,
  p_priority integer default 0,
  p_user_plan text default 'free',
  p_paid_priority boolean default false,
  p_queue_priority_reason text default null,
  p_duplicate_request_key text default null,
  p_current_stage text default null,
  p_model_version text default null
)
returns table (
  id uuid,
  trip_id uuid,
  user_id uuid,
  status text,
  priority integer,
  current_stage text,
  generation_version text,
  model_version text,
  retry_count integer,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  idempotency_key text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz,
  user_plan text,
  paid_priority boolean,
  queue_priority_reason text,
  duplicate_request_key text,
  resumed boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_version text := coalesce(nullif(p_generation_version, ''), 'roamly-brain-v1');
  v_key text := p_trip_id::text || ':' || v_version;
  v_active public.roamly_trip_generation_jobs;
  v_keyed public.roamly_trip_generation_jobs;
  v_new public.roamly_trip_generation_jobs;
begin
  -- 1. An active job for this trip wins, whatever its key.
  --    This closes both the omitted-version hole and the
  --    latest-job-masked-by-terminal hole in one read.
  select j.* into v_active
    from public.roamly_trip_generation_jobs j
   where j.trip_id = p_trip_id
     and j.status in ('queued', 'running', 'waiting')
   order by j.created_at desc
   limit 1;
  -- NOTE on column lists: the RETURN QUERY statements below name every
  -- column explicitly, in RETURNS TABLE order. `SELECT *` is deliberately
  -- NOT used: later migrations may have appended columns to the table
  -- in a different physical order, and a `*` expansion would then
  -- misalign values into the wrong declared columns. Explicit lists
  -- are order-independent and safe.
  if found then
    update public.roamly_trip_generation_jobs j set
      priority = greatest(j.priority, coalesce(p_priority, 0)),
      current_stage = coalesce(p_current_stage, j.current_stage),
      user_plan = coalesce(p_user_plan, j.user_plan),
      paid_priority = (j.paid_priority or coalesce(p_paid_priority, false)),
      queue_priority_reason = coalesce(p_queue_priority_reason, j.queue_priority_reason),
      duplicate_request_key = coalesce(p_duplicate_request_key, j.duplicate_request_key)
     where j.id = v_active.id
     returning j.* into v_active;
    return query select
      v_active.id, v_active.trip_id, v_active.user_id, v_active.status,
      v_active.priority, v_active.current_stage, v_active.generation_version,
      v_active.model_version, v_active.retry_count, v_active.next_attempt_at,
      v_active.locked_at, v_active.locked_by, v_active.lease_expires_at,
      v_active.idempotency_key, v_active.last_error_code, v_active.last_error_message,
      v_active.created_at, v_active.started_at, v_active.completed_at,
      v_active.updated_at, v_active.user_plan, v_active.paid_priority,
      v_active.queue_priority_reason, v_active.duplicate_request_key, true;
    return;
  end if;

  -- 2. A same-key non-active job: return it untouched (status never
  --    changed here). Failed -> the caller reopens it via the existing
  --    path. Completed/cancelled -> returned as-is, never resurrected.
  select j.* into v_keyed
    from public.roamly_trip_generation_jobs j
   where j.user_id = p_user_id
     and j.idempotency_key = v_key
   order by j.created_at desc
   limit 1;
  if found then
    return query select
      v_keyed.id, v_keyed.trip_id, v_keyed.user_id, v_keyed.status,
      v_keyed.priority, v_keyed.current_stage, v_keyed.generation_version,
      v_keyed.model_version, v_keyed.retry_count, v_keyed.next_attempt_at,
      v_keyed.locked_at, v_keyed.locked_by, v_keyed.lease_expires_at,
      v_keyed.idempotency_key, v_keyed.last_error_code, v_keyed.last_error_message,
      v_keyed.created_at, v_keyed.started_at, v_keyed.completed_at,
      v_keyed.updated_at, v_keyed.user_plan, v_keyed.paid_priority,
      v_keyed.queue_priority_reason, v_keyed.duplicate_request_key, true;
    return;
  end if;

  -- 3. Fresh insert, race-proof. The ON CONFLICT arbiter matches the
  --    partial active-trip index predicate verbatim; the exception
  --    handler covers the (user_id, idempotency_key) index for a
  --    same-key row committing between step 2 and this insert.
  begin
    insert into public.roamly_trip_generation_jobs (
      trip_id, user_id, status, priority, user_plan, paid_priority,
      queue_priority_reason, duplicate_request_key, current_stage,
      generation_version, model_version, idempotency_key, next_attempt_at
    ) values (
      p_trip_id, p_user_id, 'queued', greatest(0, coalesce(p_priority, 0)),
      coalesce(p_user_plan, 'free'), coalesce(p_paid_priority, false),
      p_queue_priority_reason, p_duplicate_request_key, p_current_stage,
      v_version, p_model_version, v_key, now()
    )
    on conflict (trip_id) where status in ('queued', 'running', 'waiting') do nothing
    returning * into v_new;
  exception when unique_violation then
    v_new := null;
  end;
  if found then
    return query select
      v_new.id, v_new.trip_id, v_new.user_id, v_new.status,
      v_new.priority, v_new.current_stage, v_new.generation_version,
      v_new.model_version, v_new.retry_count, v_new.next_attempt_at,
      v_new.locked_at, v_new.locked_by, v_new.lease_expires_at,
      v_new.idempotency_key, v_new.last_error_code, v_new.last_error_message,
      v_new.created_at, v_new.started_at, v_new.completed_at,
      v_new.updated_at, v_new.user_plan, v_new.paid_priority,
      v_new.queue_priority_reason, v_new.duplicate_request_key, false;
    return;
  end if;

  -- 4. Lost a race: the winner is visible now. Prefer the active job.
  select j.* into v_active
    from public.roamly_trip_generation_jobs j
   where j.trip_id = p_trip_id
     and j.status in ('queued', 'running', 'waiting')
   order by j.created_at desc
   limit 1;
  if found then
    return query select
      v_active.id, v_active.trip_id, v_active.user_id, v_active.status,
      v_active.priority, v_active.current_stage, v_active.generation_version,
      v_active.model_version, v_active.retry_count, v_active.next_attempt_at,
      v_active.locked_at, v_active.locked_by, v_active.lease_expires_at,
      v_active.idempotency_key, v_active.last_error_code, v_active.last_error_message,
      v_active.created_at, v_active.started_at, v_active.completed_at,
      v_active.updated_at, v_active.user_plan, v_active.paid_priority,
      v_active.queue_priority_reason, v_active.duplicate_request_key, true;
    return;
  end if;
  select j.* into v_keyed
    from public.roamly_trip_generation_jobs j
   where j.user_id = p_user_id
     and j.idempotency_key = v_key
   order by j.created_at desc
   limit 1;
  if found then
    return query select
      v_keyed.id, v_keyed.trip_id, v_keyed.user_id, v_keyed.status,
      v_keyed.priority, v_keyed.current_stage, v_keyed.generation_version,
      v_keyed.model_version, v_keyed.retry_count, v_keyed.next_attempt_at,
      v_keyed.locked_at, v_keyed.locked_by, v_keyed.lease_expires_at,
      v_keyed.idempotency_key, v_keyed.last_error_code, v_keyed.last_error_message,
      v_keyed.created_at, v_keyed.started_at, v_keyed.completed_at,
      v_keyed.updated_at, v_keyed.user_plan, v_keyed.paid_priority,
      v_keyed.queue_priority_reason, v_keyed.duplicate_request_key, true;
    return;
  end if;

  -- Unreachable in practice (any conflict implies a visible row).
  -- Raise loudly rather than looping or inventing a row.
  raise exception 'roamly_get_or_create_generation_job: conflict with no visible row for trip %', p_trip_id;
end;
$$;

revoke all on function public.roamly_get_or_create_generation_job(uuid, uuid, text, integer, text, boolean, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.roamly_get_or_create_generation_job(uuid, uuid, text, integer, text, boolean, text, text, text, text)
  to service_role;
