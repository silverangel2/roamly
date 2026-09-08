-- Shared, privacy-bounded operational incident aggregates and occurrence history.
create table if not exists public.roamly_operational_incidents (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  environment text not null default 'production',
  severity text not null,
  subsystem text not null,
  event_code text not null,
  status text not null default 'open',
  occurrence_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_event_id uuid,
  affected_account_count integer,
  affected_trip_count integer,
  correlation_id text,
  deployment_environment text,
  deployment_id text,
  commit_sha text,
  latest_safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  check (subsystem in ('auth', 'billing', 'trip_generation', 'gmail', 'bookings', 'providers', 'customer_email', 'live_companion', 'background_jobs', 'security')),
  check (event_code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  check (status in ('open', 'resolved')),
  check (occurrence_count >= 0),
  check (affected_account_count is null or affected_account_count >= 0),
  check (affected_trip_count is null or affected_trip_count >= 0)
);

create table if not exists public.roamly_operational_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.roamly_operational_incidents(id) on delete set null,
  event_key text not null unique,
  occurred_at timestamptz not null default now(),
  kind text not null default 'failure',
  severity text not null,
  subsystem text not null,
  event_code text not null,
  correlation_id text,
  deployment_environment text,
  deployment_id text,
  commit_sha text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (kind in ('failure', 'recovery')),
  check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  check (subsystem in ('auth', 'billing', 'trip_generation', 'gmail', 'bookings', 'providers', 'customer_email', 'live_companion', 'background_jobs', 'security')),
  check (event_code ~ '^[a-z][a-z0-9_.-]{1,79}$')
);

create index if not exists roamly_operational_incidents_status_idx
  on public.roamly_operational_incidents (status, severity, last_seen_at desc);
create index if not exists roamly_operational_incidents_subsystem_idx
  on public.roamly_operational_incidents (subsystem, event_code, last_seen_at desc);
create index if not exists roamly_operational_events_incident_idx
  on public.roamly_operational_events (incident_id, occurred_at desc);
create index if not exists roamly_operational_events_occurred_idx
  on public.roamly_operational_events (occurred_at desc);

alter table public.roamly_operational_incidents enable row level security;
alter table public.roamly_operational_events enable row level security;
grant all privileges on public.roamly_operational_incidents to service_role;
grant all privileges on public.roamly_operational_events to service_role;

create or replace function public.roamly_record_operational_event(
  p_event_key text,
  p_fingerprint text,
  p_environment text,
  p_severity text,
  p_subsystem text,
  p_event_code text,
  p_occurred_at timestamptz default now(),
  p_kind text default 'failure',
  p_correlation_id text default null,
  p_deployment_environment text default null,
  p_deployment_id text default null,
  p_commit_sha text default null,
  p_safe_metadata jsonb default '{}'::jsonb,
  p_affected_account_count integer default null,
  p_affected_trip_count integer default null
)
returns table (incident_id uuid, event_id uuid, duplicate boolean, status text, occurrence_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_event public.roamly_operational_events%rowtype;
  existing_event public.roamly_operational_events%rowtype;
  incident public.roamly_operational_incidents%rowtype;
begin
  if nullif(trim(coalesce(p_event_key, '')), '') is null
    or length(p_event_key) > 180
    or nullif(trim(coalesce(p_fingerprint, '')), '') is null
    or length(p_fingerprint) > 128
    or p_subsystem not in ('auth', 'billing', 'trip_generation', 'gmail', 'bookings', 'providers', 'customer_email', 'live_companion', 'background_jobs', 'security')
    or p_event_code !~ '^[a-z][a-z0-9_.-]{1,79}$'
    or p_severity not in ('critical', 'high', 'medium', 'low', 'info')
    or p_kind not in ('failure', 'recovery') then
    return query select null::uuid, null::uuid, false, 'invalid'::text, 0;
    return;
  end if;

  insert into public.roamly_operational_events (
    event_key, occurred_at, kind, severity, subsystem, event_code,
    correlation_id, deployment_environment, deployment_id, commit_sha, safe_metadata
  ) values (
    p_event_key, coalesce(p_occurred_at, now()), p_kind, p_severity, p_subsystem, p_event_code,
    p_correlation_id, p_deployment_environment, p_deployment_id, p_commit_sha,
    coalesce(p_safe_metadata, '{}'::jsonb)
  ) on conflict (event_key) do nothing
  returning * into inserted_event;

  if not found then
    select * into existing_event
    from public.roamly_operational_events
    where event_key = p_event_key;
    select * into incident
    from public.roamly_operational_incidents
    where id = existing_event.incident_id;
    return query select incident.id, existing_event.id, true, incident.status, incident.occurrence_count;
    return;
  end if;

  insert into public.roamly_operational_incidents (
    fingerprint, environment, severity, subsystem, event_code, status,
    occurrence_count, first_seen_at, last_seen_at, resolved_at,
    last_event_id, correlation_id, deployment_environment, deployment_id, commit_sha,
    latest_safe_metadata, affected_account_count, affected_trip_count
  ) values (
    p_fingerprint, coalesce(nullif(trim(p_environment), ''), 'production'), p_severity, p_subsystem, p_event_code,
    case when p_kind = 'recovery' then 'resolved' else 'open' end,
    case when p_kind = 'recovery' then 0 else 1 end,
    coalesce(p_occurred_at, now()), coalesce(p_occurred_at, now()),
    case when p_kind = 'recovery' then coalesce(p_occurred_at, now()) else null end,
    inserted_event.id, p_correlation_id, p_deployment_environment, p_deployment_id, p_commit_sha,
    coalesce(p_safe_metadata, '{}'::jsonb), p_affected_account_count, p_affected_trip_count
  )
  on conflict (fingerprint) do update set
    severity = excluded.severity,
    last_seen_at = greatest(public.roamly_operational_incidents.last_seen_at, excluded.last_seen_at),
    status = case when p_kind = 'recovery' then 'resolved' else 'open' end,
    resolved_at = case when p_kind = 'recovery' then excluded.resolved_at else null end,
    occurrence_count = public.roamly_operational_incidents.occurrence_count +
      case when p_kind = 'recovery' then 0 else 1 end,
    last_event_id = excluded.last_event_id,
    correlation_id = coalesce(excluded.correlation_id, public.roamly_operational_incidents.correlation_id),
    deployment_environment = coalesce(excluded.deployment_environment, public.roamly_operational_incidents.deployment_environment),
    deployment_id = coalesce(excluded.deployment_id, public.roamly_operational_incidents.deployment_id),
    commit_sha = coalesce(excluded.commit_sha, public.roamly_operational_incidents.commit_sha),
    latest_safe_metadata = excluded.latest_safe_metadata,
    affected_account_count = coalesce(excluded.affected_account_count, public.roamly_operational_incidents.affected_account_count),
    affected_trip_count = coalesce(excluded.affected_trip_count, public.roamly_operational_incidents.affected_trip_count),
    updated_at = now()
  returning * into incident;

  update public.roamly_operational_events
  set incident_id = incident.id
  where id = inserted_event.id;

  return query select incident.id, inserted_event.id, false, incident.status, incident.occurrence_count;
end;
$$;

create or replace function public.roamly_cleanup_operational_events(p_retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.roamly_operational_events
  where occurred_at < now() - make_interval(days => greatest(30, least(coalesce(p_retention_days, 90), 365)));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.roamly_record_operational_event(text, text, text, text, text, text, timestamptz, text, text, text, text, text, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.roamly_cleanup_operational_events(integer) from public, anon, authenticated;
grant execute on function public.roamly_record_operational_event(text, text, text, text, text, text, timestamptz, text, text, text, text, text, jsonb, integer, integer) to service_role;
grant execute on function public.roamly_cleanup_operational_events(integer) to service_role;
