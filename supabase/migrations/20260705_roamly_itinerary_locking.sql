create or replace function public.roamly_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.roamly_user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  free_itinerary_used_at timestamptz,
  free_itinerary_trip_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_user_entitlements
  drop constraint if exists roamly_user_entitlements_free_trip_fk;

alter table public.roamly_user_entitlements
  add constraint roamly_user_entitlements_free_trip_fk
  foreign key (free_itinerary_trip_id) references public.roamly_trips(id) on delete set null;

alter table public.roamly_trips
  add column if not exists itinerary_status text not null default 'draft',
  add column if not exists itinerary_locked boolean not null default false,
  add column if not exists itinerary_locked_at timestamptz,
  add column if not exists itinerary_generated_at timestamptz,
  add column if not exists itinerary_unlock_source text,
  add column if not exists itinerary_payment_status text not null default 'unpaid',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists tracking_unlocked boolean not null default false,
  add column if not exists tracking_unlock_source text,
  add column if not exists tracking_paid_at timestamptz,
  add column if not exists tracking_stripe_checkout_session_id text,
  add column if not exists tracking_stripe_payment_intent_id text;

alter table public.roamly_trips
  drop constraint if exists roamly_trips_status_check,
  drop constraint if exists roamly_trips_itinerary_status_check,
  drop constraint if exists roamly_trips_itinerary_unlock_source_check,
  drop constraint if exists roamly_trips_itinerary_payment_status_check,
  drop constraint if exists roamly_trips_tracking_unlock_source_check;

alter table public.roamly_trips
  add constraint roamly_trips_status_check
  check (status in ('draft', 'preview', 'payment_required', 'generating', 'generated', 'locked', 'activated', 'archived', 'planned', 'active', 'completed', 'cancelled')),
  add constraint roamly_trips_itinerary_status_check
  check (itinerary_status in ('draft', 'preview', 'payment_required', 'generating', 'generated', 'locked')),
  add constraint roamly_trips_itinerary_unlock_source_check
  check (itinerary_unlock_source is null or itinerary_unlock_source in ('free', 'paid', 'bundle', 'admin')),
  add constraint roamly_trips_itinerary_payment_status_check
  check (itinerary_payment_status in ('unpaid', 'paid', 'free', 'bundled')),
  add constraint roamly_trips_tracking_unlock_source_check
  check (tracking_unlock_source is null or tracking_unlock_source in ('paid', 'bundle', 'admin'));

create table if not exists public.roamly_itinerary_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  purchase_type text not null check (purchase_type in ('itinerary_unlock', 'tracking_addon', 'bundle')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'cad',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists roamly_user_entitlements_user_idx
on public.roamly_user_entitlements (user_id);

create index if not exists roamly_trips_itinerary_state_idx
on public.roamly_trips (user_id, itinerary_status, itinerary_locked, created_at desc);

create index if not exists roamly_trips_tracking_idx
on public.roamly_trips (user_id, tracking_unlocked, tracking_paid_at desc);

create index if not exists roamly_itinerary_purchases_trip_idx
on public.roamly_itinerary_purchases (trip_id, user_id, created_at desc);

create index if not exists roamly_itinerary_purchases_type_idx
on public.roamly_itinerary_purchases (purchase_type, status, created_at desc);

drop trigger if exists roamly_user_entitlements_updated_at on public.roamly_user_entitlements;
create trigger roamly_user_entitlements_updated_at
before update on public.roamly_user_entitlements
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_user_entitlements enable row level security;
alter table public.roamly_itinerary_purchases enable row level security;

drop policy if exists "Roamly users read own entitlements" on public.roamly_user_entitlements;
create policy "Roamly users read own entitlements"
on public.roamly_user_entitlements
for select
using (auth.uid() = user_id);

drop policy if exists "Roamly users insert own entitlements" on public.roamly_user_entitlements;
create policy "Roamly users insert own entitlements"
on public.roamly_user_entitlements
for insert
with check (auth.uid() = user_id);

drop policy if exists "Roamly users update own entitlements" on public.roamly_user_entitlements;

drop policy if exists "Roamly users read own purchases" on public.roamly_itinerary_purchases;
create policy "Roamly users read own purchases"
on public.roamly_itinerary_purchases
for select
using (auth.uid() = user_id);
