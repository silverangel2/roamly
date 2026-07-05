-- Roamly budget discovery, booking import, Live Trip Companion, and notifications.
-- Idempotent and Roamly-prefixed so it is safe in the shared ReviewIntel Supabase project.

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

alter table public.roamly_trips
  add column if not exists origin text,
  add column if not exists travelers_count integer not null default 1,
  add column if not exists budget_includes_flights boolean not null default true,
  add column if not exists budget_includes_hotel boolean not null default true,
  add column if not exists latest_price_discovery_id uuid,
  add column if not exists live_companion_unlocked boolean not null default false,
  add column if not exists live_companion_unlocked_at timestamptz,
  add column if not exists live_companion_source text,
  add column if not exists travel_country_info jsonb not null default '{}'::jsonb,
  add column if not exists packing_checklist jsonb not null default '[]'::jsonb,
  add column if not exists document_checklist jsonb not null default '[]'::jsonb,
  add column if not exists countdown_started_at timestamptz,
  add column if not exists trip_companion_status text not null default 'inactive';

alter table public.roamly_trips
  drop constraint if exists roamly_trips_live_companion_source_check,
  drop constraint if exists roamly_trips_trip_companion_status_check;

alter table public.roamly_trips
  add constraint roamly_trips_live_companion_source_check
  check (live_companion_source is null or live_companion_source in ('paid', 'bundle', 'admin')),
  add constraint roamly_trips_trip_companion_status_check
  check (trip_companion_status in ('inactive', 'scheduled', 'active', 'completed'));

alter table public.roamly_itinerary_purchases
  drop constraint if exists roamly_itinerary_purchases_purchase_type_check;

alter table public.roamly_itinerary_purchases
  add constraint roamly_itinerary_purchases_purchase_type_check
  check (purchase_type in ('itinerary', 'features', 'complete_trip', 'itinerary_unlock', 'tracking_addon', 'bundle'));

create table if not exists public.roamly_price_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  origin text,
  destination text not null,
  start_date date,
  end_date date,
  days_count integer,
  travelers_count integer not null default 1,
  budget_amount numeric(12, 2),
  budget_currency text not null default 'CAD',
  budget_includes_flights boolean not null default true,
  budget_includes_hotel boolean not null default true,
  flight_estimate_cents integer not null default 0,
  hotel_estimate_cents integer not null default 0,
  activities_estimate_cents integer not null default 0,
  food_estimate_cents integer not null default 0,
  local_transport_estimate_cents integer not null default 0,
  buffer_estimate_cents integer not null default 0,
  total_estimate_cents integer not null default 0,
  remaining_budget_cents integer,
  committed_budget_cents integer not null default 0,
  budget_status text not null default 'within_budget' check (budget_status in ('within_budget', 'tight', 'over_budget')),
  coverage_note text,
  sources jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.roamly_price_discoveries
  add column if not exists total_budget_cents integer,
  add column if not exists includes_flights boolean not null default true,
  add column if not exists includes_hotel boolean not null default true,
  add column if not exists estimated_flight_min_cents integer,
  add column if not exists estimated_flight_max_cents integer,
  add column if not exists estimated_hotel_min_cents integer,
  add column if not exists estimated_hotel_max_cents integer,
  add column if not exists estimated_activities_min_cents integer,
  add column if not exists estimated_activities_max_cents integer,
  add column if not exists estimated_food_min_cents integer,
  add column if not exists estimated_food_max_cents integer,
  add column if not exists estimated_transport_min_cents integer,
  add column if not exists estimated_transport_max_cents integer,
  add column if not exists estimated_total_min_cents integer,
  add column if not exists estimated_total_max_cents integer,
  add column if not exists remaining_budget_min_cents integer,
  add column if not exists remaining_budget_max_cents integer,
  add column if not exists source_summary jsonb not null default '{}'::jsonb;

alter table public.roamly_price_discoveries
  drop constraint if exists roamly_price_discoveries_budget_status_check;

alter table public.roamly_price_discoveries
  add constraint roamly_price_discoveries_budget_status_check
  check (budget_status in ('within_budget', 'tight', 'over_budget', 'unknown'));

alter table public.roamly_trips
  drop constraint if exists roamly_trips_latest_price_discovery_fk;

alter table public.roamly_trips
  add constraint roamly_trips_latest_price_discovery_fk
  foreign key (latest_price_discovery_id) references public.roamly_price_discoveries(id) on delete set null;

create table if not exists public.roamly_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  booking_type text not null check (booking_type in ('flight', 'hotel', 'attraction', 'restaurant', 'transport', 'car_rental', 'event', 'other')),
  provider_name text,
  title text,
  confirmation_number text,
  booking_status text not null default 'booked' check (booking_status in ('booked', 'paid', 'reserved', 'cancelled', 'unknown')),
  amount_cents integer,
  currency text not null default 'cad',
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  address text,
  city text,
  region text,
  country text,
  latitude double precision,
  longitude double precision,
  raw_extracted_text text,
  extraction_confidence text not null default 'medium' check (extraction_confidence in ('low', 'medium', 'high')),
  screenshot_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_trip_companion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  booking_id uuid references public.roamly_bookings(id) on delete set null,
  event_type text not null check (event_type in (
    'one_week_before',
    'one_day_before',
    'countdown_24h',
    'document_check',
    'packing_check',
    'country_info',
    'check_in_reminder',
    'travel_day_started',
    'trip_activated',
    'nearby_activity',
    'up_next_activity',
    'booking_reminder',
    'budget_warning',
    'navigation_opened'
  )),
  title text,
  body text,
  scheduled_for timestamptz,
  completed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'shown', 'completed', 'skipped', 'cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.roamly_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text,
  auth text,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  event_id uuid,
  type text not null,
  title text not null,
  body text,
  action_url text,
  status text not null default 'unread' check (status in ('unread', 'read', 'dismissed', 'sent', 'failed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists roamly_price_discoveries_user_idx on public.roamly_price_discoveries (user_id, created_at desc);
create index if not exists roamly_price_discoveries_trip_idx on public.roamly_price_discoveries (trip_id, created_at desc);
create index if not exists roamly_price_discoveries_budget_status_idx on public.roamly_price_discoveries (budget_status, created_at desc);

create index if not exists roamly_bookings_user_idx on public.roamly_bookings (user_id, created_at desc);
create index if not exists roamly_bookings_trip_idx on public.roamly_bookings (trip_id, start_date, created_at desc);
create index if not exists roamly_bookings_type_idx on public.roamly_bookings (booking_type);
create index if not exists roamly_bookings_start_date_idx on public.roamly_bookings (start_date);
create index if not exists roamly_bookings_created_idx on public.roamly_bookings (created_at desc);

create index if not exists roamly_trip_companion_events_user_idx on public.roamly_trip_companion_events (user_id, created_at desc);
create index if not exists roamly_trip_companion_events_trip_idx on public.roamly_trip_companion_events (trip_id, scheduled_for);
create index if not exists roamly_trip_companion_events_booking_idx on public.roamly_trip_companion_events (booking_id);
create index if not exists roamly_trip_companion_events_type_idx on public.roamly_trip_companion_events (event_type);
create index if not exists roamly_trip_companion_events_status_idx on public.roamly_trip_companion_events (status, scheduled_for);

create index if not exists roamly_push_subscriptions_user_idx on public.roamly_push_subscriptions (user_id);
create index if not exists roamly_push_subscriptions_endpoint_idx on public.roamly_push_subscriptions (endpoint);
create index if not exists roamly_push_subscriptions_enabled_idx on public.roamly_push_subscriptions (enabled);

create index if not exists roamly_notifications_user_idx on public.roamly_notifications (user_id, created_at desc);
create index if not exists roamly_notifications_trip_idx on public.roamly_notifications (trip_id, created_at desc);
create index if not exists roamly_notifications_type_idx on public.roamly_notifications (type);
create index if not exists roamly_notifications_status_idx on public.roamly_notifications (status, scheduled_for);
create index if not exists roamly_notifications_scheduled_idx on public.roamly_notifications (scheduled_for);

drop trigger if exists roamly_bookings_updated_at on public.roamly_bookings;
create trigger roamly_bookings_updated_at
before update on public.roamly_bookings
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_push_subscriptions_updated_at on public.roamly_push_subscriptions;
create trigger roamly_push_subscriptions_updated_at
before update on public.roamly_push_subscriptions
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_price_discoveries enable row level security;
alter table public.roamly_bookings enable row level security;
alter table public.roamly_trip_companion_events enable row level security;
alter table public.roamly_push_subscriptions enable row level security;
alter table public.roamly_notifications enable row level security;

drop policy if exists "Roamly users read own price discoveries" on public.roamly_price_discoveries;
create policy "Roamly users read own price discoveries"
on public.roamly_price_discoveries
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own price discoveries" on public.roamly_price_discoveries;
create policy "Roamly users create own price discoveries"
on public.roamly_price_discoveries
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users read own bookings" on public.roamly_bookings;
create policy "Roamly users read own bookings"
on public.roamly_bookings
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own bookings" on public.roamly_bookings;
create policy "Roamly users create own bookings"
on public.roamly_bookings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own bookings" on public.roamly_bookings;
create policy "Roamly users update own bookings"
on public.roamly_bookings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users read own companion events" on public.roamly_trip_companion_events;
create policy "Roamly users read own companion events"
on public.roamly_trip_companion_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own companion events" on public.roamly_trip_companion_events;
create policy "Roamly users create own companion events"
on public.roamly_trip_companion_events
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own companion events" on public.roamly_trip_companion_events;
create policy "Roamly users update own companion events"
on public.roamly_trip_companion_events
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users manage own push subscriptions" on public.roamly_push_subscriptions;
create policy "Roamly users manage own push subscriptions"
on public.roamly_push_subscriptions
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users read own notifications" on public.roamly_notifications;
create policy "Roamly users read own notifications"
on public.roamly_notifications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users update own notifications" on public.roamly_notifications;
create policy "Roamly users update own notifications"
on public.roamly_notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
