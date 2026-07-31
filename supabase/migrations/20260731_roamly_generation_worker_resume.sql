-- Keep active generation work moving ahead of stale failed retries and clear
-- locks left on non-running jobs by the legacy status bridge.

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
    where j.completed_at is null
      and (
        (j.status in ('queued', 'waiting') and coalesce(j.next_attempt_at, now()) <= now())
        or (j.status = 'failed' and j.retry_count < p_max_retries and coalesce(j.next_attempt_at, now()) <= now())
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
      j.created_at
    limit greatest(1, p_batch_size)
    for update skip locked
  )
  update public.roamly_trip_generation_jobs j
  set
    status = 'running',
    locked_at = now(),
    locked_by = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(j.started_at, now()),
    last_error_code = null,
    last_error_message = null
  from eligible
  where j.id = eligible.id
  returning j.*;
end;
$$;

create or replace function public.roamly_release_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_next_status text default 'waiting'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.roamly_trip_generation_jobs
  set
    status = case when p_next_status in ('queued', 'waiting', 'failed') then p_next_status else 'waiting' end,
    locked_at = null,
    locked_by = null,
    lease_expires_at = null
  where id = p_job_id
    and locked_by = p_worker_id
    and status in ('running', 'waiting', 'failed');
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

update public.roamly_trip_generation_jobs
set
  locked_at = null,
  locked_by = null,
  lease_expires_at = null,
  updated_at = now()
where status in ('waiting', 'failed')
  and (locked_at is not null or locked_by is not null or lease_expires_at is not null);

revoke all on function public.roamly_claim_generation_jobs(text, integer, integer, integer) from public, authenticated;
revoke all on function public.roamly_release_generation_job(uuid, text, text) from public, authenticated;

grant execute on function public.roamly_claim_generation_jobs(text, integer, integer, integer) to service_role;
grant execute on function public.roamly_release_generation_job(uuid, text, text) to service_role;
