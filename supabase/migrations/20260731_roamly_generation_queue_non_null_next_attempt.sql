-- Keep generation queue job/layer retry timestamps compatible with the NOT NULL schema.
--
-- Completed, cancelled, and retry-exhausted rows are made non-claimable by status,
-- completed_at, or retry_count, not by storing a NULL next_attempt_at.

create or replace function public.roamly_schedule_generation_layer_retry(
  p_layer_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_max_retries integer default 3,
  p_retry_base_seconds integer default 60,
  p_retry_max_seconds integer default 1800
)
returns public.roamly_trip_generation_layers
language plpgsql
security definer
set search_path = public
as $$
declare
  failed public.roamly_trip_generation_layers;
  next_retry integer;
  delay_seconds integer;
begin
  select retry_count + 1 into next_retry
  from public.roamly_trip_generation_layers
  where id = p_layer_id
    and locked_by = p_worker_id
    and status = 'running'
  for update;

  if next_retry is null then
    return null;
  end if;

  delay_seconds = least(greatest(1, p_retry_max_seconds), greatest(1, p_retry_base_seconds) * (2 ^ greatest(0, next_retry - 1))::integer);

  update public.roamly_trip_generation_layers
  set
    status = 'failed',
    retry_count = next_retry,
    next_attempt_at = case
      when next_retry < p_max_retries then now() + make_interval(secs => delay_seconds)
      else now()
    end,
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    error_code = p_error_code,
    error_message = left(coalesce(p_error_message, ''), 2000)
  where id = p_layer_id
  returning * into failed;

  return failed;
end;
$$;

create or replace function public.roamly_schedule_generation_job_retry(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_max_retries integer default 3,
  p_retry_base_seconds integer default 60,
  p_retry_max_seconds integer default 1800
)
returns public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  failed public.roamly_trip_generation_jobs;
  next_retry integer;
  delay_seconds integer;
begin
  select retry_count + 1 into next_retry
  from public.roamly_trip_generation_jobs
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running'
  for update;

  if next_retry is null then
    return null;
  end if;

  delay_seconds = least(greatest(1, p_retry_max_seconds), greatest(1, p_retry_base_seconds) * (2 ^ greatest(0, next_retry - 1))::integer);

  update public.roamly_trip_generation_jobs
  set
    status = 'failed',
    retry_count = next_retry,
    next_attempt_at = case
      when next_retry < p_max_retries then now() + make_interval(secs => delay_seconds)
      else now()
    end,
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    last_error_code = p_error_code,
    last_error_message = left(coalesce(p_error_message, ''), 2000)
  where id = p_job_id
  returning * into failed;

  return failed;
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
  trip_metadata jsonb;
  final_generation jsonb;
  completed_layer_count integer := 0;
  completed_at_text text := to_char(p_completed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  total_days integer;
  completed_days integer;
begin
  select *
  into job_row
  from public.roamly_trip_generation_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'GENERATION_JOB_NOT_FOUND');
  end if;

  if p_user_id is not null and job_row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'GENERATION_JOB_USER_MISMATCH');
  end if;

  select coalesce(metadata, '{}'::jsonb)
  into trip_metadata
  from public.roamly_trips
  where id = job_row.trip_id
    and user_id = job_row.user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRIP_NOT_FOUND');
  end if;

  final_generation := coalesce(p_generation_state, trip_metadata -> 'generation', '{}'::jsonb);
  if jsonb_typeof(final_generation) is distinct from 'object' then
    final_generation := '{}'::jsonb;
  end if;

  begin
    total_days := nullif(final_generation ->> 'totalDayCount', '')::integer;
  exception when others then
    total_days := null;
  end;

  begin
    completed_days := nullif(final_generation ->> 'completedDayCount', '')::integer;
  exception when others then
    completed_days := null;
  end;

  final_generation := final_generation || jsonb_build_object(
    'status', 'complete',
    'currentStage', 'complete',
    'completedAt', coalesce(final_generation ->> 'completedAt', completed_at_text),
    'updatedAt', completed_at_text,
    'worker', null,
    'lastError', null,
    'lastErrorCode', null
  );

  if total_days is not null then
    final_generation := jsonb_set(
      final_generation,
      '{completedDayCount}',
      to_jsonb(greatest(coalesce(completed_days, 0), total_days)),
      true
    );
  end if;

  update public.roamly_trip_generation_layers
  set
    status = 'completed',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = coalesce(completed_at, p_completed_at),
    error_code = null,
    error_message = null,
    updated_at = p_completed_at
  where job_id = job_row.id
    and status <> 'completed';

  update public.roamly_trip_generation_jobs
  set
    status = 'completed',
    current_stage = 'completion_notification',
    next_attempt_at = coalesce(next_attempt_at, p_completed_at, now()),
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = coalesce(completed_at, p_completed_at),
    updated_at = p_completed_at,
    last_error_code = null,
    last_error_message = null
  where id = job_row.id;

  update public.roamly_trips
  set
    status = 'generated',
    itinerary_status = 'generated',
    metadata = jsonb_set(trip_metadata, '{generation}', final_generation, true),
    updated_at = p_completed_at
  where id = job_row.trip_id
    and user_id = job_row.user_id;

  select count(*)
  into completed_layer_count
  from public.roamly_trip_generation_layers
  where job_id = job_row.id
    and status = 'completed';

  return jsonb_build_object(
    'ok', true,
    'jobId', job_row.id,
    'tripId', job_row.trip_id,
    'completedAt', completed_at_text,
    'completedLayerCount', completed_layer_count
  );
end;
$$;

update public.roamly_trip_generation_jobs
set next_attempt_at = coalesce(completed_at, updated_at, created_at, now())
where next_attempt_at is null;

alter table public.roamly_trip_generation_jobs
  alter column next_attempt_at set default now(),
  alter column next_attempt_at set not null;

revoke all on function public.roamly_schedule_generation_layer_retry(uuid, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.roamly_schedule_generation_job_retry(uuid, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.roamly_schedule_generation_layer_retry(uuid, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.roamly_schedule_generation_job_retry(uuid, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
