-- Roamly admin, traffic, trip activation, and activity tracking schema.
-- This migration extends the existing Roamly schema safely. It does not touch
-- ReviewIntel tables and keeps existing Roamly trip/payment/itinerary behavior.

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
  add column if not exists destination_name text,
  add column if not exists destination_country text,
  add column if not exists destination_region text,
  add column if not exists destination_city text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.roamly_trips drop constraint if exists roamly_trips_status_check;
alter table public.roamly_trips
  add constraint roamly_trips_status_check
  check (status in ('draft', 'preview', 'activated', 'archived', 'planned', 'active', 'completed', 'cancelled'));

create table if not exists public.roamly_trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  date date,
  title text,
  summary text,
  created_at timestamptz not null default now(),
  unique (trip_id, day_number)
);

create table if not exists public.roamly_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  trip_day_id uuid references public.roamly_trip_days(id) on delete set null,
  title text not null,
  description text,
  category text,
  address text,
  city text,
  region text,
  country text,
  latitude double precision,
  longitude double precision,
  radius_meters integer not null default 250,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  sort_order integer not null default 0,
  status text not null default 'planned' check (status in ('planned', 'nearby', 'checked_in', 'completed', 'skipped')),
  checked_in_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.roamly_trip_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  activity_id uuid references public.roamly_activities(id) on delete set null,
  event_type text not null,
  event_title text,
  event_body text,
  latitude double precision,
  longitude double precision,
  distance_meters integer,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.roamly_location_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  location_tracking_enabled boolean not null default false,
  notification_enabled boolean not null default true,
  last_permission_state text,
  last_seen_latitude double precision,
  last_seen_longitude double precision,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_app_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  visitor_key text,
  event_type text not null,
  path text,
  url text,
  title text,
  referrer text,
  referrer_host text,
  device_type text,
  platform text,
  browser text,
  country text,
  region text,
  city text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists roamly_trip_days_trip_idx on public.roamly_trip_days (trip_id, day_number);
create index if not exists roamly_activities_trip_idx on public.roamly_activities (trip_id, sort_order);
create index if not exists roamly_activities_status_idx on public.roamly_activities (status, created_at desc);
create index if not exists roamly_activities_lat_lon_idx on public.roamly_activities (latitude, longitude);
create index if not exists roamly_trip_events_created_idx on public.roamly_trip_events (created_at desc);
create index if not exists roamly_trip_events_trip_idx on public.roamly_trip_events (trip_id, created_at desc);
create index if not exists roamly_trip_events_user_idx on public.roamly_trip_events (user_id, created_at desc);
create index if not exists roamly_trip_events_type_idx on public.roamly_trip_events (event_type, created_at desc);
create index if not exists roamly_location_settings_user_idx on public.roamly_location_settings (user_id);
create index if not exists roamly_app_events_created_idx on public.roamly_app_events (created_at desc);
create index if not exists roamly_app_events_user_idx on public.roamly_app_events (user_id, created_at desc);
create index if not exists roamly_app_events_visitor_idx on public.roamly_app_events (visitor_key, created_at desc);
create index if not exists roamly_app_events_type_idx on public.roamly_app_events (event_type, created_at desc);
create index if not exists roamly_app_events_path_idx on public.roamly_app_events (path, created_at desc);

drop trigger if exists roamly_activities_updated_at on public.roamly_activities;
create trigger roamly_activities_updated_at
before update on public.roamly_activities
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_location_settings_updated_at on public.roamly_location_settings;
create trigger roamly_location_settings_updated_at
before update on public.roamly_location_settings
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_trip_days enable row level security;
alter table public.roamly_activities enable row level security;
alter table public.roamly_trip_events enable row level security;
alter table public.roamly_location_settings enable row level security;
alter table public.roamly_app_events enable row level security;

drop policy if exists "Roamly users read own trip days" on public.roamly_trip_days;
create policy "Roamly users read own trip days"
on public.roamly_trip_days
for select
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_days.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users manage own trip days" on public.roamly_trip_days;
create policy "Roamly users manage own trip days"
on public.roamly_trip_days
for all
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_days.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_days.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users read own activities" on public.roamly_activities;
create policy "Roamly users read own activities"
on public.roamly_activities
for select
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_activities.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users manage own activities" on public.roamly_activities;
create policy "Roamly users manage own activities"
on public.roamly_activities
for all
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_activities.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_activities.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users read own trip events" on public.roamly_trip_events;
create policy "Roamly users read own trip events"
on public.roamly_trip_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own trip events" on public.roamly_trip_events;
create policy "Roamly users create own trip events"
on public.roamly_trip_events
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users manage own location settings" on public.roamly_location_settings;
create policy "Roamly users manage own location settings"
on public.roamly_location_settings
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users create app events" on public.roamly_app_events;
create policy "Roamly users create app events"
on public.roamly_app_events
for insert
to authenticated
with check (user_id is null or user_id = auth.uid());

drop policy if exists "Roamly users read own app events" on public.roamly_app_events;
create policy "Roamly users read own app events"
on public.roamly_app_events
for select
to authenticated
using (user_id = auth.uid());
