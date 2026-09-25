-- Stop generation work when its owning trip becomes terminal.
-- Forward-only repair for G-A13-02. Do not edit or rerun historical queue migrations.

create or replace function public.roamly_cancel_generation_for_terminal_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.roamly_trip_generation_jobs
  set
    status = 'cancelled',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    cancelled_at = coalesce(cancelled_at, now()),
    cancellation_reason = coalesce(cancellation_reason, 'TRIP_TERMINAL'),
    last_error_code = 'TRIP_TERMINAL',
    last_error_message = 'Generation stopped because the owning trip is terminal.',
    updated_at = now()
  where trip_id = new.id
    and user_id = new.user_id
    and status in ('queued', 'running', 'waiting', 'failed');

  update public.roamly_trip_generation_layers
  set
    status = 'skipped',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = coalesce(completed_at, now()),
    error_code = 'TRIP_TERMINAL',
    error_message = 'Generation stopped because the owning trip is terminal.',
    updated_at = now()
  where trip_id = new.id
    and user_id = new.user_id
    and status in ('pending', 'running', 'failed', 'invalidated');

  return new;
end;
$$;

drop trigger if exists roamly_stop_generation_on_terminal_trip on public.roamly_trips;
create trigger roamly_stop_generation_on_terminal_trip
after update of status, itinerary_status on public.roamly_trips
for each row
when (
  (
    new.status in ('archived', 'cancelled', 'completed')
    or coalesce(new.itinerary_status, '') = 'cancelled'
  )
  and not (
    old.status in ('archived', 'cancelled', 'completed')
    or coalesce(old.itinerary_status, '') = 'cancelled'
  )
)
execute function public.roamly_cancel_generation_for_terminal_trip();

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
        or (j.status = 'failed' and j.retry_count < p_max_retries and coalesce(j.next_attempt_at, now()) <= now())
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

create or replace function public.roamly_finalize_generation_trip(
  p_trip_id uuid,
  p_user_id uuid,
  p_metadata jsonb,
  p_unlock_source text,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
  payment_status text;
begin
  if p_unlock_source not in ('free', 'paid', 'bundle', 'admin') then
    return false;
  end if;

  payment_status := case
    when p_unlock_source = 'free' then 'free'
    when p_unlock_source = 'bundle' then 'bundled'
    else 'paid'
  end;

  update public.roamly_trips
  set
    status = 'generated',
    itinerary_status = 'generated',
    itinerary_locked = true,
    itinerary_locked_at = coalesce(itinerary_locked_at, coalesce(p_completed_at, now())),
    itinerary_generated_at = coalesce(itinerary_generated_at, coalesce(p_completed_at, now())),
    itinerary_unlock_source = coalesce(itinerary_unlock_source, p_unlock_source),
    itinerary_payment_status = case
      when itinerary_payment_status is not null and itinerary_payment_status <> 'unpaid' then itinerary_payment_status
      else payment_status
    end,
    metadata = coalesce(p_metadata, metadata, '{}'::jsonb),
    updated_at = coalesce(p_completed_at, now())
  where id = p_trip_id
    and user_id = p_user_id
    and status not in ('archived', 'cancelled', 'completed')
    and coalesce(itinerary_status, '') <> 'cancelled';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.roamly_finalize_generation_completion(
  p_job_id uuid,
  p_user_id uuid,
  p_generation_state jsonb default null,
  p_completed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.roamly_trip_generation_jobs%rowtype;
  trip_row public.roamly_trips%rowtype;
  trip_metadata jsonb;
  final_generation jsonb;
  completed_layer_count integer := 0;
  completed_at_text text := to_char(p_completed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  total_days integer;
  completed_days integer;
begin
  select * into job_row
  from public.roamly_trip_generation_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'GENERATION_JOB_NOT_FOUND');
  end if;
  if p_user_id is not null and job_row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'GENERATION_JOB_USER_MISMATCH');
  end if;

  select * into trip_row
  from public.roamly_trips
  where id = job_row.trip_id
    and user_id = job_row.user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRIP_NOT_FOUND');
  end if;
  if trip_row.status in ('archived', 'cancelled', 'completed')
     or coalesce(trip_row.itinerary_status, '') = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'TRIP_TERMINAL');
  end if;

  trip_metadata := coalesce(trip_row.metadata, '{}'::jsonb);
  final_generation := coalesce(p_generation_state, trip_metadata -> 'generation', '{}'::jsonb);
  if jsonb_typeof(final_generation) is distinct from 'object' then final_generation := '{}'::jsonb; end if;

  begin total_days := nullif(final_generation ->> 'totalDayCount', '')::integer; exception when others then total_days := null; end;
  begin completed_days := nullif(final_generation ->> 'completedDayCount', '')::integer; exception when others then completed_days := null; end;

  final_generation := final_generation || jsonb_build_object(
    'status', 'complete', 'currentStage', 'complete',
    'completedAt', coalesce(final_generation ->> 'completedAt', completed_at_text),
    'updatedAt', completed_at_text, 'worker', null, 'lastError', null, 'lastErrorCode', null
  );
  if total_days is not null then
    final_generation := jsonb_set(final_generation, '{completedDayCount}', to_jsonb(greatest(coalesce(completed_days, 0), total_days)), true);
  end if;

  update public.roamly_trip_generation_layers
  set status = 'completed', locked_at = null, locked_by = null, lease_expires_at = null,
      completed_at = coalesce(completed_at, p_completed_at), error_code = null, error_message = null,
      updated_at = p_completed_at
  where job_id = job_row.id and status <> 'completed';

  update public.roamly_trip_generation_jobs
  set status = 'completed', current_stage = 'completion_notification', next_attempt_at = null,
      locked_at = null, locked_by = null, lease_expires_at = null,
      completed_at = coalesce(completed_at, p_completed_at), updated_at = p_completed_at,
      last_error_code = null, last_error_message = null
  where id = job_row.id;

  update public.roamly_trips
  set status = 'generated', itinerary_status = 'generated',
      metadata = jsonb_set(trip_metadata, '{generation}', final_generation, true), updated_at = p_completed_at
  where id = job_row.trip_id and user_id = job_row.user_id
    and status not in ('archived', 'cancelled', 'completed')
    and coalesce(itinerary_status, '') <> 'cancelled';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRIP_TERMINAL');
  end if;

  select count(*) into completed_layer_count
  from public.roamly_trip_generation_layers
  where job_id = job_row.id and status = 'completed';

  return jsonb_build_object('ok', true, 'jobId', job_row.id, 'tripId', job_row.trip_id,
    'completedAt', completed_at_text, 'completedLayerCount', completed_layer_count);
end;
$$;

revoke all on function public.roamly_cancel_generation_for_terminal_trip() from public, anon, authenticated, service_role;
revoke all on function public.roamly_claim_generation_jobs(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.roamly_claim_generation_job_by_trip(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.roamly_finalize_generation_trip(uuid, uuid, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.roamly_claim_generation_jobs(text, integer, integer, integer) to service_role;
grant execute on function public.roamly_claim_generation_job_by_trip(uuid, text, integer, integer) to service_role;
grant execute on function public.roamly_finalize_generation_trip(uuid, uuid, jsonb, text, timestamptz) to service_role;
grant execute on function public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
