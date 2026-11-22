-- KF-2 #2 claim poison (2026-11-22): one claimable row per trip, ever.
--
-- Root cause: the 2026-11-12 guard (20261112_roamly_claim_skip_superseded_failed)
-- makes a failed job claimable only while NO live job exists for its trip.
-- A failed+FAILED pair passes that guard on BOTH rows — neither row has a
-- live sibling. Sokoto trip 1edda600 left exactly that pair (engine job
-- 4747105c and brain job 6ad988a9, both failed, retry_count 1, completed_at
-- NULL). Every 5-minute cron wake, the batch claim RPC selected Tangier's
-- waiting job AND both Sokoto rows, and the single UPDATE to status='running'
-- violated unique index roamly_trip_generation_jobs_active_trip_idx
-- (UNIQUE (trip_id) WHERE status IN ('queued','running','waiting'),
-- 20260715): Postgres aborted the whole statement with 23505, so NOTHING
-- was claimed — dead from Nov 20 ~12:51Z until the live heal Nov 22
-- 13:28:54Z (completed_at set on 4747105c; Tangier claimed and generated
-- at the 13:30 wake). The claim error only ever reached console.info
-- (generation_worker_claim_error), so the outage was silent for 2 days.
--
-- Fix: rank the claimable rows per trip with row_number() using the exact
-- claim ranking (live first, then priority, then due time, then created)
-- and keep only rank 1 per trip before the LIMIT. In practice the reachable
-- poison is failed+failed (and failed x N): a waiting+waiting pair cannot
-- exist at all, because the partial unique index forbids two active rows
-- for one trip at write time. Claim order and priority are unchanged — the
-- outer ORDER BY reproduces the previous ranking term for term, and the
-- FOR UPDATE OF j SKIP LOCKED still locks the base-table rows (the ranked
-- CTE only filters; the lock is taken on the join back to the jobs table).
-- The by-trip RPC needs no change: its LIMIT 1 already guarantees one row.
--
-- Apply: run this file on the Dell DB at ship (same manual apply as the
-- 20261112 migration, PR #121). CREATE OR REPLACE preserves the existing
-- service_role grants.
-- Evidence: scripts/roamly-kf2-claim-poison-checks.mjs (fixed RPC claims
-- one row per trip; the unfixed 20261112 RPC throws 23505 on the same seed).

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
  with ranked as (
    select
      j.id,
      j.trip_id,
      case
        when j.status in ('queued', 'waiting') then 0
        when j.status = 'running' then 1
        else 2
      end as claim_rank,
      j.priority,
      coalesce(j.next_attempt_at, j.created_at) as attempt_due,
      j.created_at,
      row_number() over (
        partition by j.trip_id
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
      ) as trip_rank
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
  ),
  eligible as (
    select j.id
    from ranked r
    join public.roamly_trip_generation_jobs j on j.id = r.id
    where r.trip_rank = 1
    order by
      r.claim_rank,
      r.priority desc,
      r.attempt_due,
      r.created_at,
      r.id
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

notify pgrst, 'reload schema';
