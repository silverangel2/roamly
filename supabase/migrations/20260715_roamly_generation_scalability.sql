-- Queue scalability, cost tracking, admin controls, and health visibility.

create extension if not exists pgcrypto;

alter table public.roamly_trip_generation_jobs
  add column if not exists user_plan text not null default 'free',
  add column if not exists paid_priority boolean not null default false,
  add column if not exists queue_priority_reason text,
  add column if not exists duplicate_request_key text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text,
  add column if not exists estimated_cost_json jsonb not null default '{}'::jsonb,
  add column if not exists provider_usage_json jsonb not null default '{}'::jsonb,
  add column if not exists worker_metrics_json jsonb not null default '{}'::jsonb,
  add column if not exists rate_limit_bucket text;

alter table public.roamly_trip_generation_layers
  add column if not exists duration_ms integer,
  add column if not exists worker_execution_ms integer,
  add column if not exists estimated_cost_json jsonb not null default '{}'::jsonb,
  add column if not exists provider_usage_json jsonb not null default '{}'::jsonb;

create unique index if not exists roamly_generation_jobs_duplicate_request_idx
on public.roamly_trip_generation_jobs (user_id, duplicate_request_key)
where duplicate_request_key is not null;

create index if not exists roamly_generation_jobs_paid_priority_idx
on public.roamly_trip_generation_jobs (paid_priority desc, priority desc, next_attempt_at asc, created_at asc)
where status in ('queued', 'waiting', 'failed');

create index if not exists roamly_generation_jobs_dead_letter_idx
on public.roamly_trip_generation_jobs (dead_lettered_at desc)
where dead_lettered_at is not null;

create table if not exists public.roamly_generation_cost_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  job_id uuid references public.roamly_trip_generation_jobs(id) on delete cascade,
  layer_id uuid references public.roamly_trip_generation_layers(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  cost_category text not null,
  provider text,
  model text,
  unit_count numeric,
  estimated_cost_usd numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (cost_category in (
    'model_tokens',
    'ai_call',
    'map_call',
    'transport_search',
    'accommodation_search',
    'activity_search',
    'email',
    'notification',
    'worker_execution'
  )),
  check (estimated_cost_usd is null or estimated_cost_usd >= 0)
);

create table if not exists public.roamly_generation_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  request_count integer not null default 0,
  token_count integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bucket, window_start)
);

create table if not exists public.roamly_generation_provider_limits (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  bucket text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  request_count integer not null default 0,
  token_count integer not null default 0,
  last_error_code text,
  last_error_at timestamptz,
  rate_limited_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, bucket, window_start)
);

create index if not exists roamly_generation_cost_events_trip_idx on public.roamly_generation_cost_events (trip_id, created_at desc);
create index if not exists roamly_generation_cost_events_job_idx on public.roamly_generation_cost_events (job_id, created_at desc);
create index if not exists roamly_generation_rate_limits_user_idx on public.roamly_generation_rate_limits (user_id, bucket, window_start desc);
create index if not exists roamly_generation_provider_limits_provider_idx on public.roamly_generation_provider_limits (provider, bucket, window_start desc);

drop trigger if exists roamly_generation_rate_limits_updated_at on public.roamly_generation_rate_limits;
create trigger roamly_generation_rate_limits_updated_at
before update on public.roamly_generation_rate_limits
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_generation_provider_limits_updated_at on public.roamly_generation_provider_limits;
create trigger roamly_generation_provider_limits_updated_at
before update on public.roamly_generation_provider_limits
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_generation_cost_events enable row level security;
alter table public.roamly_generation_rate_limits enable row level security;
alter table public.roamly_generation_provider_limits enable row level security;

drop policy if exists "Roamly service role manages generation cost events" on public.roamly_generation_cost_events;
create policy "Roamly service role manages generation cost events"
on public.roamly_generation_cost_events
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly users read own generation rate limits" on public.roamly_generation_rate_limits;
create policy "Roamly users read own generation rate limits"
on public.roamly_generation_rate_limits
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages generation rate limits" on public.roamly_generation_rate_limits;
create policy "Roamly service role manages generation rate limits"
on public.roamly_generation_rate_limits
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly service role manages provider rate limits" on public.roamly_generation_provider_limits;
create policy "Roamly service role manages provider rate limits"
on public.roamly_generation_provider_limits
for all
to service_role
using (true)
with check (true);

create or replace function public.roamly_record_generation_cost(
  p_trip_id uuid,
  p_job_id uuid,
  p_layer_id uuid,
  p_user_id uuid,
  p_cost_category text,
  p_provider text default null,
  p_model text default null,
  p_unit_count numeric default null,
  p_estimated_cost_usd numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.roamly_generation_cost_events
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.roamly_generation_cost_events;
begin
  insert into public.roamly_generation_cost_events (
    trip_id,
    job_id,
    layer_id,
    user_id,
    cost_category,
    provider,
    model,
    unit_count,
    estimated_cost_usd,
    metadata
  )
  values (
    p_trip_id,
    p_job_id,
    p_layer_id,
    p_user_id,
    p_cost_category,
    p_provider,
    p_model,
    p_unit_count,
    p_estimated_cost_usd,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into created;
  return created;
end;
$$;

create or replace function public.roamly_retry_generation_job_admin(
  p_job_id uuid,
  p_reason text default 'admin_retry'
)
returns public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.roamly_trip_generation_jobs;
begin
  update public.roamly_trip_generation_jobs
  set
    status = 'queued',
    retry_count = 0,
    next_attempt_at = now(),
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    last_error_code = null,
    last_error_message = null,
    dead_lettered_at = null,
    dead_letter_reason = null,
    queue_priority_reason = coalesce(p_reason, 'admin_retry'),
    updated_at = now()
  where id = p_job_id
    and status in ('failed', 'waiting', 'queued', 'cancelled')
  returning * into updated;
  return updated;
end;
$$;

create or replace function public.roamly_cancel_generation_job_admin(
  p_job_id uuid,
  p_reason text default 'admin_cancelled'
)
returns public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.roamly_trip_generation_jobs;
begin
  update public.roamly_trip_generation_jobs
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = left(coalesce(p_reason, 'admin_cancelled'), 500),
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    updated_at = now()
  where id = p_job_id
    and status in ('queued', 'waiting', 'running', 'failed')
  returning * into updated;

  update public.roamly_trip_generation_layers
  set
    status = 'skipped',
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    error_code = 'JOB_CANCELLED',
    error_message = left(coalesce(p_reason, 'admin_cancelled'), 500),
    updated_at = now()
  where job_id = p_job_id
    and status in ('pending', 'running', 'failed', 'invalidated');

  return updated;
end;
$$;

create or replace function public.roamly_mark_generation_job_dead_letter(
  p_job_id uuid,
  p_reason text default 'retry_budget_exhausted'
)
returns public.roamly_trip_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.roamly_trip_generation_jobs;
begin
  update public.roamly_trip_generation_jobs
  set
    status = 'failed',
    dead_lettered_at = now(),
    dead_letter_reason = left(coalesce(p_reason, 'retry_budget_exhausted'), 500),
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    updated_at = now()
  where id = p_job_id
  returning * into updated;
  return updated;
end;
$$;

create or replace function public.roamly_generation_queue_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'waiting', count(*) filter (where status = 'waiting'),
    'running', count(*) filter (where status = 'running'),
    'completed_24h', count(*) filter (where status = 'completed' and completed_at >= now() - interval '24 hours'),
    'failed', count(*) filter (where status = 'failed'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'dead_lettered', count(*) filter (where dead_lettered_at is not null),
    'expired_leases', count(*) filter (where status = 'running' and coalesce(lease_expires_at, '-infinity'::timestamptz) <= now()),
    'avg_job_duration_seconds_24h', avg(extract(epoch from (completed_at - started_at))) filter (where completed_at >= now() - interval '24 hours' and started_at is not null),
    'estimated_cost_usd_24h', coalesce((select sum(estimated_cost_usd) from public.roamly_generation_cost_events where created_at >= now() - interval '24 hours'), 0)
  )
  from public.roamly_trip_generation_jobs;
$$;

create or replace view public.roamly_generation_queue_admin as
select
  j.id,
  j.trip_id,
  j.user_id,
  j.status,
  j.priority,
  j.paid_priority,
  j.user_plan,
  j.current_stage,
  j.retry_count,
  j.next_attempt_at,
  j.lease_expires_at,
  j.last_error_code,
  j.last_error_message,
  j.dead_lettered_at,
  j.dead_letter_reason,
  j.created_at,
  j.started_at,
  j.completed_at,
  j.updated_at,
  count(l.id) as layer_count,
  count(l.id) filter (where l.status in ('completed', 'skipped')) as completed_layer_count,
  sum(coalesce((l.estimated_cost_json->>'estimated_cost_usd')::numeric, 0)) as layer_estimated_cost_usd
from public.roamly_trip_generation_jobs j
left join public.roamly_trip_generation_layers l on l.job_id = j.id
group by j.id;

revoke all on public.roamly_generation_queue_admin from public, authenticated;

revoke all on function public.roamly_record_generation_cost(uuid, uuid, uuid, uuid, text, text, text, numeric, numeric, jsonb) from public, authenticated;
revoke all on function public.roamly_retry_generation_job_admin(uuid, text) from public, authenticated;
revoke all on function public.roamly_cancel_generation_job_admin(uuid, text) from public, authenticated;
revoke all on function public.roamly_mark_generation_job_dead_letter(uuid, text) from public, authenticated;
revoke all on function public.roamly_generation_queue_health() from public, authenticated;

grant execute on function public.roamly_record_generation_cost(uuid, uuid, uuid, uuid, text, text, text, numeric, numeric, jsonb) to service_role;
grant execute on function public.roamly_retry_generation_job_admin(uuid, text) to service_role;
grant execute on function public.roamly_cancel_generation_job_admin(uuid, text) to service_role;
grant execute on function public.roamly_mark_generation_job_dead_letter(uuid, text) to service_role;
grant execute on function public.roamly_generation_queue_health() to service_role;
