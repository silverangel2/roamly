-- Roamly durable itinerary generation queue and layer persistence.
-- Idempotent and Roamly-prefixed for safe use in shared Supabase projects.
--
-- Market evidence boundary:
-- public.roamly_market_prices remains a shared anonymous market cache for normalized
-- provider results keyed by route/date/search parameters. User-specific traveler
-- requirements, ranking evidence, and decision rationale belong in the protected
-- generation layers below, not in the shared cache.

create extension if not exists pgcrypto;

create or replace function public.roamly_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.roamly_trip_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  priority integer not null default 0,
  current_stage text,
  generation_version text not null default 'roamly-brain-v1',
  model_version text,
  retry_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  idempotency_key text not null,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  check (retry_count >= 0),
  check (priority >= 0)
);

alter table public.roamly_trip_generation_jobs
  add column if not exists idempotency_key text;

update public.roamly_trip_generation_jobs
set idempotency_key = coalesce(idempotency_key, trip_id::text || ':' || generation_version)
where idempotency_key is null;

alter table public.roamly_trip_generation_jobs
  alter column idempotency_key set not null;

create table if not exists public.roamly_trip_generation_layers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  job_id uuid not null references public.roamly_trip_generation_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  layer_type text not null,
  layer_sequence integer not null,
  status text not null default 'pending',
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  dependency_versions_json jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  generation_version text not null default 'roamly-brain-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('pending', 'running', 'completed', 'failed', 'skipped', 'invalidated')),
  check (retry_count >= 0),
  check (layer_sequence > 0)
);

create unique index if not exists roamly_trip_generation_jobs_user_idempotency_idx
on public.roamly_trip_generation_jobs (user_id, idempotency_key);

create unique index if not exists roamly_trip_generation_jobs_active_trip_idx
on public.roamly_trip_generation_jobs (trip_id)
where status in ('queued', 'running', 'waiting');

create index if not exists roamly_trip_generation_jobs_claim_idx
on public.roamly_trip_generation_jobs (status, priority desc, next_attempt_at, created_at);

create index if not exists roamly_trip_generation_jobs_lease_idx
on public.roamly_trip_generation_jobs (lease_expires_at)
where status = 'running';

create index if not exists roamly_trip_generation_jobs_trip_idx
on public.roamly_trip_generation_jobs (trip_id, created_at desc);

create index if not exists roamly_trip_generation_jobs_user_idx
on public.roamly_trip_generation_jobs (user_id, created_at desc);

create unique index if not exists roamly_trip_generation_layers_sequence_idx
on public.roamly_trip_generation_layers (job_id, layer_sequence);

create unique index if not exists roamly_trip_generation_layers_type_version_idx
on public.roamly_trip_generation_layers (job_id, layer_type, generation_version);

create index if not exists roamly_trip_generation_layers_claim_idx
on public.roamly_trip_generation_layers (job_id, status, layer_sequence, next_attempt_at);

create index if not exists roamly_trip_generation_layers_lease_idx
on public.roamly_trip_generation_layers (lease_expires_at)
where status = 'running';

create index if not exists roamly_trip_generation_layers_trip_idx
on public.roamly_trip_generation_layers (trip_id, layer_sequence);

create index if not exists roamly_trip_generation_layers_user_idx
on public.roamly_trip_generation_layers (user_id, created_at desc);

drop trigger if exists roamly_trip_generation_jobs_updated_at on public.roamly_trip_generation_jobs;
create trigger roamly_trip_generation_jobs_updated_at
before update on public.roamly_trip_generation_jobs
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_trip_generation_layers_updated_at on public.roamly_trip_generation_layers;
create trigger roamly_trip_generation_layers_updated_at
before update on public.roamly_trip_generation_layers
for each row execute function public.roamly_set_updated_at();

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
    order by j.priority desc, coalesce(j.next_attempt_at, j.created_at), j.created_at
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

create or replace function public.roamly_claim_generation_layer(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 240,
  p_max_retries integer default 3
)
returns public.roamly_trip_generation_layers
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.roamly_trip_generation_layers;
begin
  with eligible as (
    select l.id
    from public.roamly_trip_generation_layers l
    where l.job_id = p_job_id
      and (
        (l.status = 'pending' and coalesce(l.next_attempt_at, now()) <= now())
        or (l.status = 'failed' and l.retry_count < p_max_retries and coalesce(l.next_attempt_at, now()) <= now())
        or (l.status = 'running' and coalesce(l.lease_expires_at, '-infinity'::timestamptz) <= now())
      )
      and not exists (
        select 1
        from public.roamly_trip_generation_layers previous
        where previous.job_id = l.job_id
          and previous.layer_sequence < l.layer_sequence
          and previous.status not in ('completed', 'skipped')
      )
    order by l.layer_sequence
    limit 1
    for update skip locked
  )
  update public.roamly_trip_generation_layers l
  set
    status = 'running',
    locked_at = now(),
    locked_by = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(l.started_at, now()),
    error_code = null,
    error_message = null
  from eligible
  where l.id = eligible.id
  returning l.* into claimed;

  return claimed;
end;
$$;

create or replace function public.roamly_renew_generation_lease(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 240,
  p_layer_id uuid default null
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
  set lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds))
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running';
  get diagnostics updated_count = row_count;

  if p_layer_id is not null then
    update public.roamly_trip_generation_layers
    set lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds))
    where id = p_layer_id
      and job_id = p_job_id
      and locked_by = p_worker_id
      and status = 'running';
  end if;

  return updated_count > 0;
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
    and status = 'running';
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

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
    dependency_versions_json = coalesce(p_dependency_versions_json, dependency_versions_json),
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = now(),
    error_code = null,
    error_message = null
  where id = p_layer_id
    and locked_by = p_worker_id
    and status = 'running'
  returning * into completed;
  return completed;
end;
$$;

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
    next_attempt_at = case when next_retry < p_max_retries then now() + make_interval(secs => delay_seconds) else null end,
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
    last_error_code = null,
    last_error_message = null
  where id = p_job_id
    and locked_by = p_worker_id
    and status = 'running'
  returning * into completed;
  return completed;
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
    next_attempt_at = case when next_retry < p_max_retries then now() + make_interval(secs => delay_seconds) else null end,
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

create or replace function public.roamly_cancel_generation_job(
  p_job_id uuid,
  p_user_id uuid default null
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
    status = 'cancelled',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    completed_at = now(),
    last_error_code = 'JOB_CANCELLED',
    last_error_message = 'Generation job was cancelled.'
  where id = p_job_id
    and (p_user_id is null or user_id = p_user_id)
    and status not in ('completed', 'cancelled');
  get diagnostics updated_count = row_count;

  update public.roamly_trip_generation_layers
  set
    status = 'skipped',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    error_code = 'JOB_CANCELLED',
    error_message = 'Generation job was cancelled.'
  where job_id = p_job_id
    and status in ('pending', 'running', 'failed', 'invalidated');

  return updated_count > 0;
end;
$$;

create or replace function public.roamly_invalidate_generation_layers(
  p_job_id uuid,
  p_from_sequence integer,
  p_reason text default 'DEPENDENCY_INVALIDATED'
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
    status = 'invalidated',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    error_code = 'LAYER_INVALIDATED',
    error_message = left(coalesce(p_reason, 'Layer dependency invalidated.'), 2000)
  where job_id = p_job_id
    and layer_sequence >= p_from_sequence
    and status in ('pending', 'running', 'completed', 'failed');
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.roamly_requeue_invalidated_layers(
  p_job_id uuid,
  p_generation_version text default 'roamly-brain-v1'
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
    status = 'pending',
    retry_count = 0,
    next_attempt_at = now(),
    error_code = null,
    error_message = null,
    completed_at = null,
    generation_version = p_generation_version
  where job_id = p_job_id
    and status = 'invalidated';
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.roamly_claim_generation_jobs(text, integer, integer, integer) from public, authenticated;
revoke all on function public.roamly_claim_generation_layer(uuid, text, integer, integer) from public, authenticated;
revoke all on function public.roamly_renew_generation_lease(uuid, text, integer, uuid) from public, authenticated;
revoke all on function public.roamly_release_generation_job(uuid, text, text) from public, authenticated;
revoke all on function public.roamly_complete_generation_layer(uuid, text, jsonb, jsonb, jsonb) from public, authenticated;
revoke all on function public.roamly_schedule_generation_layer_retry(uuid, text, text, text, integer, integer, integer) from public, authenticated;
revoke all on function public.roamly_complete_generation_job(uuid, text) from public, authenticated;
revoke all on function public.roamly_schedule_generation_job_retry(uuid, text, text, text, integer, integer, integer) from public, authenticated;
revoke all on function public.roamly_cancel_generation_job(uuid, uuid) from public, authenticated;
revoke all on function public.roamly_invalidate_generation_layers(uuid, integer, text) from public, authenticated;
revoke all on function public.roamly_requeue_invalidated_layers(uuid, text) from public, authenticated;

grant execute on function public.roamly_claim_generation_jobs(text, integer, integer, integer) to service_role;
grant execute on function public.roamly_claim_generation_layer(uuid, text, integer, integer) to service_role;
grant execute on function public.roamly_renew_generation_lease(uuid, text, integer, uuid) to service_role;
grant execute on function public.roamly_release_generation_job(uuid, text, text) to service_role;
grant execute on function public.roamly_complete_generation_layer(uuid, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.roamly_schedule_generation_layer_retry(uuid, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.roamly_complete_generation_job(uuid, text) to service_role;
grant execute on function public.roamly_schedule_generation_job_retry(uuid, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.roamly_cancel_generation_job(uuid, uuid) to service_role;
grant execute on function public.roamly_invalidate_generation_layers(uuid, integer, text) to service_role;
grant execute on function public.roamly_requeue_invalidated_layers(uuid, text) to service_role;
