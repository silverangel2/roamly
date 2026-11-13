-- Retry-claim defect (2026-11-12): skip a superseded failed job at claim time.
--
-- Root cause: every retried trip carries a same-trip pair — a FAILED
-- attempt-1 row (claimable via the claim RPCs' failed branch) AND its
-- WAITING retry row (claimable via the waiting branch). The batch claim
-- RPC selected BOTH rows and activated them in one UPDATE, violating
-- the unique partial index roamly_trip_generation_jobs_active_trip_idx
-- (UNIQUE (trip_id) WHERE status IN ('queued','running','waiting'),
-- 20260715): Postgres aborted the whole statement with 23505, so the
-- wake claimed NOTHING, every 5-minute wake since 2026-11-11 16:10:37Z.
-- The by-trip claim has the same hazard (its sort picks the failed row
-- first). The stuck-generation detector then re-armed the waiting row
-- forever without resolving the pair.
--
-- Fix: a failed job is claimable only while NO live job exists for its
-- trip. The guard below is added to the failed branch of BOTH claim
-- RPCs and nowhere else — the waiting/queued/running branches can
-- never introduce a second active row for a trip, and the trip join,
-- terminal guards, ordering, leases and grants are untouched.
-- CREATE OR REPLACE preserves the existing service_role grants.
-- No row healing is needed: after this ships, the first wake claims
-- the two waiting retries (different trips, no violation); the failed
-- rows stay failed as history, never re-claimed.
-- Evidence: hidden_files/retry-claim-fix-2026-11-12/FIX-REPORT.md.

create or replace function public.roamly_claim_generation_jobs(
  p_worker_id text,
  p_batch_size integer default 5,
  p_lease_seconds integer default 240,
  p_max_retries integer default 3
)
returns setof public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with eligible as (
    select j.id
    from public.roamly_trip_generation_jobs j
    join public.roamly_trips t
      on t.id = j.trip_id
     and t.user_id = j.user_id
    where j.completed_at is null
      and t.status not in ('archived', 'cancelled', 'completed')
      and coalesce(t.itinerary_status, '') <> 'cancelled'
      and (
        (j.status in ('queued', 'waiting') and coalesce(j.next_attempt_at, now()) <= now())
        or (j.status = 'failed' and j.retry_count < p_max_retries and coalesce(j.next_attempt_at, now()) <= now()
          and not exists (
            select 1 from public.roamly_trip_generation_jobs s
            where s.trip_id = j.trip_id and s.id <> j.id
              and s.completed_at is null
              and s.status in ('queued', 'running', 'waiting')
          ))
        or (j.status = 'running' and coalesce(j.lease_expires_at, '-infinity'::timestamptz) <= now())
      )
    order by
      case
        when j.status in ('queued', 'waiting') then 0
        when j.status = 'running' then 1
        else 2
      end,
      j.priority desc,
      coalesce(j.next_attempt_at, j.created_at),
      j.created_at,
      j.id
    limit greatest(1, p_batch_size)
    for update of j skip locked
  )
  update public.roamly_trip_generation_jobs j
  set
    status = 'running',
    locked_at = now(),
    locked_by = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(j.started_at, now()),
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  from eligible
  where j.id = eligible.id
  returning j.*;
end;
$$;

create or replace function public.roamly_claim_generation_job_by_trip(
  p_trip_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 240,
  p_max_retries integer default 3
)
returns public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.roamly_trip_generation_jobs;
begin
  with eligible as (
    select j.id
    from public.roamly_trip_generation_jobs j
    join public.roamly_trips t
      on t.id = j.trip_id
     and t.user_id = j.user_id
    where j.trip_id = p_trip_id
      and j.completed_at is null
      and t.status not in ('archived', 'cancelled', 'completed')
      and coalesce(t.itinerary_status, '') <> 'cancelled'
      and (
        (j.status in ('queued', 'waiting') and coalesce(j.next_attempt_at, now()) <= now())
        or (j.status = 'failed' and j.retry_count < p_max_retries and coalesce(j.next_attempt_at, now()) <= now()
          and not exists (
            select 1 from public.roamly_trip_generation_jobs s
            where s.trip_id = j.trip_id and s.id <> j.id
              and s.completed_at is null
              and s.status in ('queued', 'running', 'waiting')
          ))
        or (j.status = 'running' and coalesce(j.lease_expires_at, '-infinity'::timestamptz) <= now())
      )
    order by j.priority desc, coalesce(j.next_attempt_at, j.created_at), j.created_at, j.id
    limit 1
    for update of j skip locked
  )
  update public.roamly_trip_generation_jobs j
  set
    status = 'running',
    locked_at = now(),
    locked_by = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(j.started_at, now()),
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  from eligible
  where j.id = eligible.id
  returning j.* into claimed;

  return claimed;
end;
$$;

notify pgrst, 'reload schema';
