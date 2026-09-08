-- Serialize Stripe webhook delivery before any payment or entitlement side effects run.
create table if not exists public.roamly_stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  claim_token uuid not null default gen_random_uuid(),
  attempt_count integer not null default 1
    check (attempt_count >= 0 and attempt_count <= 5),
  first_claimed_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_stripe_webhook_events_status_idx
  on public.roamly_stripe_webhook_events (status, last_attempt_at);

alter table public.roamly_stripe_webhook_events enable row level security;

drop policy if exists "Roamly service role manages Stripe webhook events"
  on public.roamly_stripe_webhook_events;
create policy "Roamly service role manages Stripe webhook events"
on public.roamly_stripe_webhook_events
for all
to service_role
using (true)
with check (true);

grant all privileges on table public.roamly_stripe_webhook_events to service_role;

create or replace function public.roamly_claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_stale_after_seconds integer default 900
)
returns table (
  claim_status text,
  claimed boolean,
  claim_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.roamly_stripe_webhook_events%rowtype;
  inserted public.roamly_stripe_webhook_events%rowtype;
  stale_after interval := make_interval(secs => greatest(300, least(coalesce(p_stale_after_seconds, 900), 3600)));
begin
  if nullif(trim(coalesce(p_stripe_event_id, '')), '') is null then
    return query select 'invalid'::text, false, null::uuid, 0;
    return;
  end if;

  insert into public.roamly_stripe_webhook_events (stripe_event_id, event_type)
  values (p_stripe_event_id, coalesce(nullif(trim(p_event_type), ''), 'unknown'))
  on conflict (stripe_event_id) do nothing
  returning * into inserted;

  if found then
    return query select 'claimed'::text, true, inserted.claim_token, inserted.attempt_count;
    return;
  end if;

  select *
  into existing
  from public.roamly_stripe_webhook_events
  where stripe_event_id = p_stripe_event_id
  for update;

  if existing.status = 'completed' then
    return query select 'completed'::text, false, null::uuid, existing.attempt_count;
    return;
  end if;

  if existing.status = 'processing'
    and existing.last_attempt_at > now() - stale_after then
    return query select 'processing'::text, false, null::uuid, existing.attempt_count;
    return;
  end if;

  if existing.attempt_count >= 5 then
    return query select 'retry_exhausted'::text, false, null::uuid, existing.attempt_count;
    return;
  end if;

  update public.roamly_stripe_webhook_events
  set
    status = 'processing',
    claim_token = gen_random_uuid(),
    attempt_count = existing.attempt_count + 1,
    last_attempt_at = now(),
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  where stripe_event_id = existing.stripe_event_id
  returning * into existing;

  return query select 'claimed'::text, true, existing.claim_token, existing.attempt_count;
end;
$$;

create or replace function public.roamly_complete_stripe_webhook_event(
  p_stripe_event_id text,
  p_claim_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.roamly_stripe_webhook_events
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    last_error_code = null,
    last_error_message = null,
    updated_at = now()
  where stripe_event_id = p_stripe_event_id
    and claim_token = p_claim_token
    and status = 'processing'
  returning true;
$$;

create or replace function public.roamly_fail_stripe_webhook_event(
  p_stripe_event_id text,
  p_claim_token uuid,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.roamly_stripe_webhook_events
  set
    status = 'failed',
    last_error_code = left(nullif(trim(p_error_code), ''), 120),
    last_error_message = left(nullif(trim(p_error_message), ''), 500),
    updated_at = now()
  where stripe_event_id = p_stripe_event_id
    and claim_token = p_claim_token
    and status = 'processing'
  returning true;
$$;

revoke all on function public.roamly_claim_stripe_webhook_event(text, text, integer) from public, anon, authenticated;
revoke all on function public.roamly_complete_stripe_webhook_event(text, uuid) from public, anon, authenticated;
revoke all on function public.roamly_fail_stripe_webhook_event(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.roamly_claim_stripe_webhook_event(text, text, integer) to service_role;
grant execute on function public.roamly_complete_stripe_webhook_event(text, uuid) to service_role;
grant execute on function public.roamly_fail_stripe_webhook_event(text, uuid, text, text) to service_role;
