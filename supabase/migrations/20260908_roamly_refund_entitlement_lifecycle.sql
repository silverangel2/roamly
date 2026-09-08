-- Add authoritative Stripe refund/dispute state without changing customer travel data.
alter table public.roamly_itinerary_purchases
  add column if not exists billing_state text not null default 'active',
  add column if not exists refunded_amount_cents integer not null default 0,
  add column if not exists billing_state_updated_at timestamptz,
  add column if not exists billing_state_event_id text,
  add column if not exists billing_state_event_priority integer not null default 0,
  add column if not exists billing_reason text,
  add column if not exists stripe_dispute_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_current_period_end timestamptz;

create unique index if not exists roamly_itinerary_purchases_subscription_id_idx
  on public.roamly_itinerary_purchases (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.roamly_itinerary_purchases
  drop constraint if exists roamly_itinerary_purchases_billing_state_check,
  drop constraint if exists roamly_itinerary_purchases_refunded_amount_check;

alter table public.roamly_itinerary_purchases
  add constraint roamly_itinerary_purchases_billing_state_check
  check (billing_state in ('active', 'partially_refunded', 'refunded', 'disputed', 'revoked')),
  add constraint roamly_itinerary_purchases_refunded_amount_check
  check (refunded_amount_cents >= 0 and refunded_amount_cents <= amount_cents);

-- The historical purchase constraint omitted the state used by checkout.session.expired.
alter table public.roamly_itinerary_purchases
  drop constraint if exists roamly_itinerary_purchases_status_check;
alter table public.roamly_itinerary_purchases
  add constraint roamly_itinerary_purchases_status_check
  check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired'));

create table if not exists public.roamly_stripe_billing_events (
  stripe_event_id text primary key,
  purchase_id uuid references public.roamly_itinerary_purchases(id) on delete set null,
  stripe_event_type text not null,
  billing_state text not null
    check (billing_state in ('active', 'partially_refunded', 'refunded', 'disputed', 'revoked')),
  stripe_event_created_at timestamptz not null,
  state_priority integer not null default 0,
  refunded_amount_cents integer not null default 0 check (refunded_amount_cents >= 0),
  billing_reason text,
  stripe_dispute_id text,
  created_at timestamptz not null default now()
);

create index if not exists roamly_stripe_billing_events_purchase_idx
  on public.roamly_stripe_billing_events (purchase_id, stripe_event_created_at desc);

alter table public.roamly_stripe_billing_events enable row level security;
drop policy if exists "Roamly service role manages Stripe billing events"
  on public.roamly_stripe_billing_events;
create policy "Roamly service role manages Stripe billing events"
on public.roamly_stripe_billing_events
for all
to service_role
using (true)
with check (true);
grant all privileges on table public.roamly_stripe_billing_events to service_role;

create or replace function public.roamly_apply_stripe_billing_state(
  p_stripe_event_id text,
  p_purchase_id uuid,
  p_stripe_event_type text,
  p_billing_state text,
  p_stripe_event_created_at timestamptz,
  p_state_priority integer default 0,
  p_refunded_amount_cents integer default 0,
  p_billing_reason text default null,
  p_stripe_dispute_id text default null,
  p_subscription_id text default null,
  p_subscription_status text default null,
  p_subscription_current_period_end timestamptz default null
)
returns table (
  applied boolean,
  duplicate boolean,
  stale boolean,
  current_billing_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  purchase_row public.roamly_itinerary_purchases%rowtype;
  inserted_event_id text;
  next_state text := p_billing_state;
  next_refunded_amount integer := greatest(0, coalesce(p_refunded_amount_cents, 0));
begin
  if nullif(trim(coalesce(p_stripe_event_id, '')), '') is null
    or p_purchase_id is null
    or p_stripe_event_created_at is null
    or p_billing_state not in ('active', 'partially_refunded', 'refunded', 'disputed', 'revoked') then
    return query select false, false, true, null::text;
    return;
  end if;

  insert into public.roamly_stripe_billing_events (
    stripe_event_id,
    purchase_id,
    stripe_event_type,
    billing_state,
    stripe_event_created_at,
    state_priority,
    refunded_amount_cents,
    billing_reason,
    stripe_dispute_id
  )
  values (
    p_stripe_event_id,
    p_purchase_id,
    coalesce(nullif(trim(p_stripe_event_type), ''), 'unknown'),
    p_billing_state,
    p_stripe_event_created_at,
    coalesce(p_state_priority, 0),
    next_refunded_amount,
    left(nullif(trim(p_billing_reason), ''), 240),
    nullif(trim(p_stripe_dispute_id), '')
  )
  on conflict (stripe_event_id) do nothing
  returning stripe_event_id into inserted_event_id;

  select *
  into purchase_row
  from public.roamly_itinerary_purchases
  where id = p_purchase_id
  for update;

  if not found then
    return query select false, inserted_event_id is null, true, null::text;
    return;
  end if;

  if inserted_event_id is null then
    return query select false, true, false, purchase_row.billing_state;
    return;
  end if;

  if purchase_row.billing_state_updated_at is not null and (
    p_stripe_event_created_at < purchase_row.billing_state_updated_at
    or (
      p_stripe_event_created_at = purchase_row.billing_state_updated_at
      and coalesce(p_state_priority, 0) < purchase_row.billing_state_event_priority
    )
    or (
      p_stripe_event_created_at = purchase_row.billing_state_updated_at
      and coalesce(p_state_priority, 0) = purchase_row.billing_state_event_priority
      and coalesce(p_stripe_event_id, '') <= coalesce(purchase_row.billing_state_event_id, '')
    )
  ) then
    return query select false, false, true, purchase_row.billing_state;
    return;
  end if;

  if next_state = 'active' and next_refunded_amount > 0 then
    next_state := case when next_refunded_amount >= purchase_row.amount_cents then 'refunded' else 'partially_refunded' end;
  end if;

  update public.roamly_itinerary_purchases
  set
    billing_state = next_state,
    refunded_amount_cents = greatest(refunded_amount_cents, next_refunded_amount),
    billing_state_updated_at = p_stripe_event_created_at,
    billing_state_event_id = p_stripe_event_id,
    billing_state_event_priority = coalesce(p_state_priority, 0),
    billing_reason = left(nullif(trim(p_billing_reason), ''), 240),
    stripe_dispute_id = coalesce(nullif(trim(p_stripe_dispute_id), ''), stripe_dispute_id),
    stripe_subscription_id = coalesce(nullif(trim(p_subscription_id), ''), stripe_subscription_id),
    subscription_status = coalesce(nullif(trim(p_subscription_status), ''), subscription_status),
    subscription_current_period_end = coalesce(p_subscription_current_period_end, subscription_current_period_end)
  where id = p_purchase_id;

  return query select true, false, false, next_state;
end;
$$;

revoke all on function public.roamly_apply_stripe_billing_state(text, uuid, text, text, timestamptz, integer, integer, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.roamly_apply_stripe_billing_state(text, uuid, text, text, timestamptz, integer, integer, text, text, text, text, timestamptz)
  to service_role;
