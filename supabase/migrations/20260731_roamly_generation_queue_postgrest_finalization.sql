-- Restore PostgREST visibility for Roamly generation queue objects and make
-- successful completion finalization a single database transaction.

grant usage on schema public to anon, authenticated, service_role;

grant select on table public.roamly_trip_generation_jobs to anon, authenticated;
grant select on table public.roamly_trip_generation_layers to anon, authenticated;
grant all privileges on table public.roamly_trip_generation_jobs to service_role;
grant all privileges on table public.roamly_trip_generation_layers to service_role;
grant all privileges on table public.roamly_trip_generation_jobs to postgres;
grant all privileges on table public.roamly_trip_generation_layers to postgres;

alter table public.roamly_trip_generation_jobs enable row level security;
alter table public.roamly_trip_generation_layers enable row level security;

drop policy if exists "Roamly users read own generation jobs" on public.roamly_trip_generation_jobs;
create policy "Roamly users read own generation jobs"
on public.roamly_trip_generation_jobs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages generation jobs" on public.roamly_trip_generation_jobs;
create policy "Roamly service role manages generation jobs"
on public.roamly_trip_generation_jobs
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly users read own generation layers" on public.roamly_trip_generation_layers;
create policy "Roamly users read own generation layers"
on public.roamly_trip_generation_layers
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages generation layers" on public.roamly_trip_generation_layers;
create policy "Roamly service role manages generation layers"
on public.roamly_trip_generation_layers
for all
to service_role
using (true)
with check (true);

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
    next_attempt_at = null,
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

create or replace function public.roamly_reconcile_completed_generation_jobs(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  repaired jsonb := '[]'::jsonb;
  result jsonb;
begin
  for candidate in
    select
      j.id as job_id,
      j.user_id,
      coalesce(t.metadata -> 'generation', '{}'::jsonb) as generation_state
    from public.roamly_trip_generation_jobs j
    join public.roamly_trips t
      on t.id = j.trip_id
     and t.user_id = j.user_id
    where (
        j.status in ('queued', 'waiting', 'running', 'failed')
        or j.completed_at is null
        or j.locked_at is not null
        or j.locked_by is not null
        or j.lease_expires_at is not null
        or t.status = 'generating'
        or t.itinerary_status = 'generating'
      )
      and exists (
        select 1
        from public.roamly_itineraries i
        where i.trip_id = j.trip_id
          and i.user_id = j.user_id
          and jsonb_typeof(i.full_json -> 'daily_itinerary') = 'array'
          and jsonb_array_length(i.full_json -> 'daily_itinerary') > 0
          and coalesce(i.full_json ->> 'generation_note', '') ~* 'generated through roamly staged ai generation'
      )
      and (
        t.metadata #>> '{generationEmail,completion_email_sent_at}' is not null
        or t.metadata #>> '{generationEmail,completion_email_status}' in ('sent', 'captured')
        or t.metadata #>> '{generationEmail,delivery_status}' in ('sent', 'captured')
      )
    order by j.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    result := public.roamly_finalize_generation_completion(
      candidate.job_id,
      candidate.user_id,
      candidate.generation_state,
      now()
    );

    if result ->> 'ok' = 'true' then
      repaired := repaired || jsonb_build_array(result);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'repairedCount', jsonb_array_length(repaired),
    'repaired', repaired
  );
end;
$$;

do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    to_regprocedure('public.roamly_claim_generation_jobs(text, integer, integer, integer)'),
    to_regprocedure('public.roamly_claim_generation_job_by_trip(uuid, text, integer, integer)'),
    to_regprocedure('public.roamly_claim_generation_layer(uuid, text, integer, integer)'),
    to_regprocedure('public.roamly_renew_generation_lease(uuid, text, integer, uuid)'),
    to_regprocedure('public.roamly_release_generation_job(uuid, text, text)'),
    to_regprocedure('public.roamly_complete_generation_layer(uuid, text, jsonb, jsonb, jsonb)'),
    to_regprocedure('public.roamly_schedule_generation_layer_retry(uuid, text, text, text, integer, integer, integer)'),
    to_regprocedure('public.roamly_complete_generation_job(uuid, text)'),
    to_regprocedure('public.roamly_schedule_generation_job_retry(uuid, text, text, text, integer, integer, integer)'),
    to_regprocedure('public.roamly_cancel_generation_job(uuid, uuid)'),
    to_regprocedure('public.roamly_invalidate_generation_layers(uuid, integer, text)'),
    to_regprocedure('public.roamly_requeue_invalidated_layers(uuid, text)'),
    to_regprocedure('public.roamly_generation_queue_health()'),
    to_regprocedure('public.roamly_record_generation_cost(uuid, uuid, uuid, uuid, text, text, text, numeric, numeric, jsonb)'),
    to_regprocedure('public.roamly_retry_generation_job_admin(uuid, text)'),
    to_regprocedure('public.roamly_cancel_generation_job_admin(uuid, text)'),
    to_regprocedure('public.roamly_mark_generation_job_dead_letter(uuid, text)'),
    to_regprocedure('public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz)'),
    to_regprocedure('public.roamly_reconcile_completed_generation_jobs(integer)')
  ]
  loop
    if fn is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
