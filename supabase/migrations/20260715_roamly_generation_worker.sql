-- Worker wake-up helpers for the durable Roamly generation queue.

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
    where j.trip_id = p_trip_id
      and j.completed_at is null
      and (
        (j.status in ('queued', 'waiting') and coalesce(j.next_attempt_at, now()) <= now())
        or (j.status = 'failed' and j.retry_count < p_max_retries and coalesce(j.next_attempt_at, now()) <= now())
        or (j.status = 'running' and coalesce(j.lease_expires_at, '-infinity'::timestamptz) <= now())
      )
    order by j.priority desc, coalesce(j.next_attempt_at, j.created_at), j.created_at
    limit 1
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
  returning j.* into claimed;

  return claimed;
end;
$$;

create or replace function public.roamly_release_generation_layer(
  p_layer_id uuid,
  p_worker_id text,
  p_next_status text default 'pending'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.roamly_trip_generation_layers
  set
    status = case when p_next_status in ('pending', 'failed', 'skipped') then p_next_status else 'pending' end,
    locked_at = null,
    locked_by = null,
    lease_expires_at = null
  where id = p_layer_id
    and locked_by = p_worker_id
    and status = 'running';
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

create or replace function public.roamly_skip_remaining_generation_layers(
  p_job_id uuid,
  p_worker_id text,
  p_reason text default 'JOB_COMPLETED'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.roamly_trip_generation_layers
  set
    status = 'skipped',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = coalesce(completed_at, now()),
    error_code = null,
    error_message = left(coalesce(p_reason, 'Job completed before this compatibility layer ran.'), 2000)
  where job_id = p_job_id
    and status in ('pending', 'failed', 'invalidated')
    and not exists (
      select 1
      from public.roamly_trip_generation_jobs j
      where j.id = p_job_id
        and j.locked_by is distinct from p_worker_id
    );
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.roamly_claim_generation_job_by_trip(uuid, text, integer, integer) from public, authenticated;
revoke all on function public.roamly_release_generation_layer(uuid, text, text) from public, authenticated;
revoke all on function public.roamly_skip_remaining_generation_layers(uuid, text, text) from public, authenticated;

grant execute on function public.roamly_claim_generation_job_by_trip(uuid, text, integer, integer) to service_role;
grant execute on function public.roamly_release_generation_layer(uuid, text, text) to service_role;
grant execute on function public.roamly_skip_remaining_generation_layers(uuid, text, text) to service_role;
