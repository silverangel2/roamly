-- Add durable, service-role-only owner-alert claim state to the existing
-- operational incident aggregate. No alert delivery occurs in this migration.
alter table public.roamly_operational_incidents
  add column if not exists owner_alert_generation bigint not null default 0,
  add column if not exists owner_alert_claimed_generation bigint,
  add column if not exists owner_alert_claim_token uuid,
  add column if not exists owner_alert_claimed_at timestamptz,
  add column if not exists owner_alert_sent_at timestamptz;

-- Existing incidents predate owner alerting. Mark their current occurrence as
-- accounted for so applying this migration cannot create surprise alerts.
update public.roamly_operational_incidents
set owner_alert_generation = case when status = 'open' then 1 else 0 end,
    owner_alert_claimed_generation = case when status = 'open' then 1 else null end,
    owner_alert_claim_token = null,
    owner_alert_claimed_at = null,
    owner_alert_sent_at = null
where owner_alert_generation = 0
  and owner_alert_claimed_generation is null;

alter table public.roamly_operational_incidents
  add constraint roamly_operational_incidents_owner_alert_generation_check
  check (owner_alert_generation >= 0);

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
    latest_safe_metadata, affected_account_count, affected_trip_count,
    owner_alert_generation, owner_alert_claimed_generation, owner_alert_claim_token,
    owner_alert_claimed_at, owner_alert_sent_at
  ) values (
    p_fingerprint, coalesce(nullif(trim(p_environment), ''), 'production'), p_severity, p_subsystem, p_event_code,
    case when p_kind = 'recovery' then 'resolved' else 'open' end,
    case when p_kind = 'recovery' then 0 else 1 end,
    coalesce(p_occurred_at, now()), coalesce(p_occurred_at, now()),
    case when p_kind = 'recovery' then coalesce(p_occurred_at, now()) else null end,
    inserted_event.id, p_correlation_id, p_deployment_environment, p_deployment_id, p_commit_sha,
    coalesce(p_safe_metadata, '{}'::jsonb), p_affected_account_count, p_affected_trip_count,
    case when p_kind = 'recovery' then 0 else 1 end,
    null, null, null, null
  )
  on conflict (fingerprint) do update set
    severity = excluded.severity,
    last_seen_at = greatest(public.roamly_operational_incidents.last_seen_at, excluded.last_seen_at),
    status = case when p_kind = 'recovery' then 'resolved' else 'open' end,
    resolved_at = case when p_kind = 'recovery' then excluded.resolved_at else null end,
    occurrence_count = public.roamly_operational_incidents.occurrence_count +
      case when p_kind = 'recovery' then 0 else 1 end,
    owner_alert_generation = case
      when p_kind = 'recovery' then public.roamly_operational_incidents.owner_alert_generation
      when public.roamly_operational_incidents.status = 'resolved'
        then public.roamly_operational_incidents.owner_alert_generation + 1
      else public.roamly_operational_incidents.owner_alert_generation
    end,
    owner_alert_claimed_generation = case
      when p_kind = 'recovery' then public.roamly_operational_incidents.owner_alert_claimed_generation
      when public.roamly_operational_incidents.status = 'resolved' then null
      else public.roamly_operational_incidents.owner_alert_claimed_generation
    end,
    owner_alert_claim_token = case
      when p_kind = 'recovery' then public.roamly_operational_incidents.owner_alert_claim_token
      when public.roamly_operational_incidents.status = 'resolved' then null
      else public.roamly_operational_incidents.owner_alert_claim_token
    end,
    owner_alert_claimed_at = case
      when p_kind = 'recovery' then public.roamly_operational_incidents.owner_alert_claimed_at
      when public.roamly_operational_incidents.status = 'resolved' then null
      else public.roamly_operational_incidents.owner_alert_claimed_at
    end,
    owner_alert_sent_at = case
      when p_kind = 'recovery' then public.roamly_operational_incidents.owner_alert_sent_at
      when public.roamly_operational_incidents.status = 'resolved' then null
      else public.roamly_operational_incidents.owner_alert_sent_at
    end,
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

create or replace function public.roamly_claim_operational_incident_owner_alert(
  p_incident_id uuid,
  p_expected_generation bigint
)
returns table (claimed boolean, claim_token uuid, generation bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  token uuid := gen_random_uuid();
begin
  return query
  update public.roamly_operational_incidents
  set owner_alert_claimed_generation = p_expected_generation,
      owner_alert_claim_token = token,
      owner_alert_claimed_at = now(),
      updated_at = now()
  where id = p_incident_id
    and status = 'open'
    and severity in ('high', 'critical')
    and owner_alert_generation = p_expected_generation
    and owner_alert_claimed_generation is distinct from p_expected_generation
  returning true, owner_alert_claim_token, owner_alert_generation;

  if not found then
    return query select false, null::uuid, null::bigint;
  end if;
end;
$$;

revoke all on function public.roamly_claim_operational_incident_owner_alert(uuid, bigint) from public, anon, authenticated;
grant execute on function public.roamly_claim_operational_incident_owner_alert(uuid, bigint) to service_role;

revoke all on function public.roamly_record_operational_event(text, text, text, text, text, text, timestamptz, text, text, text, text, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.roamly_record_operational_event(text, text, text, text, text, text, timestamptz, text, text, text, text, text, jsonb, integer, integer) to service_role;
