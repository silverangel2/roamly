-- Consolidation 2026-11-06 (Block H): the finalize wart.
--
-- roamly_trip_generation_jobs.next_attempt_at has been
-- NOT NULL DEFAULT now() since the queue's base migration
-- (20260715), and the 20260731 non-null migration's own finalize
-- honoured that with coalesce(next_attempt_at, p_completed_at,
-- now()). The two LATER redefinitions of
-- roamly_finalize_generation_completion (20260731 postgrest
-- finalization, then the live 20261001 terminal-trip guards)
-- regressed the jobs update to `next_attempt_at = null`, so every
-- completion finalize raises 23502 (not-null violation) and the
-- RPC fails atomically — completions only ever converged through
-- retries and side paths.
--
-- This migration re-creates the LIVE (20261001) function body
-- verbatim — including its terminal-trip guards — with exactly
-- one change: the completed job's next_attempt_at becomes its
-- completion time instead of NULL, the same convention the
-- non-null migration established. A completed job is never
-- claimed again (claim predicates only take queued/waiting/
-- failed rows), so the value is inert; it only has to be legal.

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
  set status = 'completed', current_stage = 'completion_notification',
      -- THE FIX: was `next_attempt_at = null` (23502 on a NOT NULL
      -- column). Completion time instead — never null, never claimed.
      next_attempt_at = coalesce(completed_at, p_completed_at, now()),
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

revoke all on function public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.roamly_finalize_generation_completion(uuid, uuid, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
