create or replace function public.roamly_complete_generation_layer(
  p_layer_id uuid,
  p_worker_id text,
  p_output_json jsonb default '{}'::jsonb,
  p_evidence_json jsonb default '{}'::jsonb,
  p_dependency_versions_json jsonb default '{}'::jsonb
)
returns public.roamly_trip_generation_layers
language plpgsql
security definer
set search_path = public
as $$
declare
  completed public.roamly_trip_generation_layers;
begin
  update public.roamly_trip_generation_layers
  set
    status = 'completed',
    output_json = coalesce(p_output_json, '{}'::jsonb),
    evidence_json = coalesce(p_evidence_json, '{}'::jsonb),
    dependency_versions_json =
      coalesce(p_dependency_versions_json, dependency_versions_json),
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = now(),
    error_code = null,
    error_message = null,
    updated_at = now()
  where id = p_layer_id
    and status = 'running'
    and (
      locked_by = p_worker_id
      or lease_expires_at is null
      or lease_expires_at <= now()
    )
  returning * into completed;

  return completed;
end;
$$;

create or replace function public.roamly_complete_generation_job(
  p_job_id uuid,
  p_worker_id text
)
returns public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  completed public.roamly_trip_generation_jobs;
begin
  update public.roamly_trip_generation_jobs
  set
    status = 'completed',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = now(),
    next_attempt_at = now(),
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  where id = p_job_id
    and status = 'running'
    and (
      locked_by = p_worker_id
      or lease_expires_at is null
      or lease_expires_at <= now()
    )
  returning * into completed;

  return completed;
end;
$$;

select pg_notify('pgrst', 'reload schema');
