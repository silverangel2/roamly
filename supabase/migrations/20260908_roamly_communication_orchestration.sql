-- Additive, server-controlled customer communication orchestration ledger.
create extension if not exists pgcrypto;

create table if not exists public.roamly_communication_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete set null,
  purpose text not null,
  occurrence_key text not null,
  logical_key text not null,
  preferred_channel text not null,
  selected_channel text not null,
  status text not null default 'pending',
  scheduled_for timestamptz not null default now(),
  useful_until timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  retryable boolean not null default true,
  next_retry_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,
  last_error_code text,
  provider text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  environment text not null default 'production',
  deployment_id text,
  commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, logical_key),
  check (purpose in ('purchase_confirmation','pretrip_7d','pretrip_1d','travel_day','daily_trip_briefing','booking_material_change','gmail_reconnect','billing_entitlement','activity_starting_soon','activity_now')),
  check (preferred_channel in ('email','push','in_app')),
  check (selected_channel in ('email','push','in_app')),
  check (status in ('pending','claimed','sent','failed','suppressed')),
  check (length(btrim(occurrence_key)) between 1 and 180),
  check (length(btrim(logical_key)) between 1 and 512),
  check (attempt_count between 0 and max_attempts),
  check (max_attempts between 1 and 5),
  check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096)
);

create index if not exists roamly_communication_ledger_due_idx
  on public.roamly_communication_ledger (status, next_retry_at, scheduled_for);
create index if not exists roamly_communication_ledger_trip_idx
  on public.roamly_communication_ledger (user_id, trip_id, created_at desc);

alter table public.roamly_communication_ledger enable row level security;
grant all privileges on public.roamly_communication_ledger to service_role;

create or replace function public.roamly_claim_communication(
  p_user_id uuid,
  p_trip_id uuid default null,
  p_purpose text default null,
  p_occurrence_key text default null,
  p_logical_key text default null,
  p_preferred_channel text default 'email',
  p_scheduled_for timestamptz default now(),
  p_useful_until timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_environment text default 'production',
  p_deployment_id text default null,
  p_commit_sha text default null,
  p_now timestamptz default now()
)
returns table (communication_id uuid, claimed boolean, status text, claim_token uuid, attempt_count integer)
language plpgsql security definer set search_path = public
as $$
declare row_data public.roamly_communication_ledger%rowtype; new_token uuid;
begin
  insert into public.roamly_communication_ledger
    (user_id, trip_id, purpose, occurrence_key, logical_key, preferred_channel, selected_channel, scheduled_for, useful_until, metadata, environment, deployment_id, commit_sha)
  values
    (p_user_id, p_trip_id, p_purpose, p_occurrence_key, p_logical_key, p_preferred_channel, p_preferred_channel, coalesce(p_scheduled_for, now()), p_useful_until, coalesce(p_metadata, '{}'::jsonb), coalesce(nullif(p_environment,''),'production'), p_deployment_id, p_commit_sha)
  on conflict (user_id, logical_key) do nothing;

  select * into row_data from public.roamly_communication_ledger
    where user_id = p_user_id and logical_key = p_logical_key for update;
  if not found then return; end if;

  if row_data.status in ('sent','suppressed') then
    return query select row_data.id, false, row_data.status, null::uuid, row_data.attempt_count; return;
  end if;
  if row_data.status = 'claimed' and row_data.claimed_at > coalesce(p_now, now()) - interval '15 minutes' then
    return query select row_data.id, false, row_data.status, null::uuid, row_data.attempt_count; return;
  end if;
  if row_data.status = 'failed' and row_data.next_retry_at > coalesce(p_now, now()) then
    return query select row_data.id, false, row_data.status, null::uuid, row_data.attempt_count; return;
  end if;
  if row_data.status = 'failed' and row_data.retryable = false then
    return query select row_data.id, false, row_data.status, null::uuid, row_data.attempt_count; return;
  end if;
  if row_data.useful_until is not null and row_data.useful_until <= coalesce(p_now, now()) then
    update public.roamly_communication_ledger set status='suppressed', suppressed_at=coalesce(p_now,now()), suppression_reason='stale', updated_at=now() where id=row_data.id;
    return query select row_data.id, false, 'suppressed', null::uuid, row_data.attempt_count; return;
  end if;
  if row_data.scheduled_for > coalesce(p_now, now()) then
    return query select row_data.id, false, row_data.status, null::uuid, row_data.attempt_count; return;
  end if;
  if row_data.attempt_count >= row_data.max_attempts then
    return query select row_data.id, false, 'failed', null::uuid, row_data.attempt_count; return;
  end if;

  new_token := gen_random_uuid();
  update public.roamly_communication_ledger
    set status='claimed', claim_token=new_token, claimed_at=coalesce(p_now,now()), attempt_count=attempt_count+1, updated_at=now()
    where id=row_data.id;
  return query select row_data.id, true, 'claimed', new_token, row_data.attempt_count + 1;
end; $$;

create or replace function public.roamly_complete_communication(
  p_communication_id uuid, p_claim_token uuid, p_provider text default null, p_provider_message_id text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.roamly_communication_ledger
    set status='sent', sent_at=now(), provider=p_provider, provider_message_id=p_provider_message_id, updated_at=now()
    where id=p_communication_id and status='claimed' and claim_token=p_claim_token;
  return found;
end; $$;

create or replace function public.roamly_fail_communication(
  p_communication_id uuid, p_claim_token uuid, p_error_code text, p_retryable boolean default true, p_uncertain_acceptance boolean default false
) returns boolean language plpgsql security definer set search_path = public as $$
declare current_attempt integer; retry_at timestamptz;
begin
  select attempt_count into current_attempt from public.roamly_communication_ledger where id=p_communication_id and status='claimed' and claim_token=p_claim_token for update;
  if not found then return false; end if;
  retry_at := case when p_retryable and not p_uncertain_acceptance and current_attempt < 5 then now() + make_interval(secs => least(3600, 60 * power(2, greatest(0,current_attempt-1)))) else null end;
  update public.roamly_communication_ledger set status='failed', retryable=(p_retryable and not p_uncertain_acceptance and current_attempt < 5), next_retry_at=coalesce(retry_at, now()), claimed_at=null, claim_token=null, last_error_code=left(p_error_code,80), updated_at=now() where id=p_communication_id;
  return true;
end; $$;

revoke all on function public.roamly_claim_communication(uuid,uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.roamly_complete_communication(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.roamly_fail_communication(uuid,uuid,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.roamly_claim_communication(uuid,uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,timestamptz) to service_role;
grant execute on function public.roamly_complete_communication(uuid,uuid,text,text) to service_role;
grant execute on function public.roamly_fail_communication(uuid,uuid,text,boolean,boolean) to service_role;
