-- Roamly Phase 4 database schema
-- Safe to run in a separate Roamly Supabase project, or in a shared project
-- because every application table is prefixed with roamly_.

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

create table if not exists public.roamly_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  destination text not null,
  start_date date,
  end_date date,
  days_count integer check (days_count is null or days_count > 0),
  budget_amount numeric(12, 2) check (budget_amount is null or budget_amount >= 0),
  budget_currency text not null default 'CAD',
  travel_style text,
  interests text[] not null default '{}',
  accommodation_preference text,
  transportation_preference text,
  special_notes text,
  status text not null default 'draft' check (status in ('draft', 'preview', 'activated', 'archived')),
  is_activated boolean not null default false,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_itineraries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ai_summary text,
  full_json jsonb not null default '{}'::jsonb,
  preview_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  date date,
  title text,
  summary text,
  morning_plan text,
  afternoon_plan text,
  evening_plan text,
  food_suggestions text,
  transport_notes text,
  estimated_cost numeric(12, 2) check (estimated_cost is null or estimated_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, day_number)
);

create table if not exists public.roamly_trip_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  time_label text,
  title text not null,
  description text,
  location_name text,
  estimated_cost numeric(12, 2) check (estimated_cost is null or estimated_cost >= 0),
  category text,
  map_query text,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_trip_checklists (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  category text,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.roamly_trip_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  itinerary_generations integer not null default 0 check (itinerary_generations >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, usage_date)
);

create table if not exists public.roamly_trip_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  stripe_session_id text unique,
  stripe_payment_intent text,
  amount integer not null check (amount >= 0),
  currency text not null default 'cad',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.roamly_admin_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists roamly_profiles_email_idx on public.roamly_profiles (lower(email));
create index if not exists roamly_trips_user_status_idx on public.roamly_trips (user_id, status, created_at desc);
create index if not exists roamly_trips_activated_idx on public.roamly_trips (user_id, is_activated, activated_at desc);
create index if not exists roamly_itineraries_trip_idx on public.roamly_itineraries (trip_id, created_at desc);
create index if not exists roamly_itinerary_days_trip_idx on public.roamly_itinerary_days (trip_id, day_number);
create index if not exists roamly_trip_activities_trip_day_idx on public.roamly_trip_activities (trip_id, day_number, created_at);
create index if not exists roamly_trip_checklists_trip_idx on public.roamly_trip_checklists (trip_id, user_id);
create index if not exists roamly_trip_usage_user_date_idx on public.roamly_trip_usage (user_id, usage_date);
create index if not exists roamly_trip_payments_trip_idx on public.roamly_trip_payments (trip_id, user_id, created_at desc);

drop trigger if exists roamly_profiles_updated_at on public.roamly_profiles;
create trigger roamly_profiles_updated_at
before update on public.roamly_profiles
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_trips_updated_at on public.roamly_trips;
create trigger roamly_trips_updated_at
before update on public.roamly_trips
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_itineraries_updated_at on public.roamly_itineraries;
create trigger roamly_itineraries_updated_at
before update on public.roamly_itineraries
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_itinerary_days_updated_at on public.roamly_itinerary_days;
create trigger roamly_itinerary_days_updated_at
before update on public.roamly_itinerary_days
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_trip_activities_updated_at on public.roamly_trip_activities;
create trigger roamly_trip_activities_updated_at
before update on public.roamly_trip_activities
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_trip_usage_updated_at on public.roamly_trip_usage;
create trigger roamly_trip_usage_updated_at
before update on public.roamly_trip_usage
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_admin_settings_updated_at on public.roamly_admin_settings;
create trigger roamly_admin_settings_updated_at
before update on public.roamly_admin_settings
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_profiles enable row level security;
alter table public.roamly_trips enable row level security;
alter table public.roamly_itineraries enable row level security;
alter table public.roamly_itinerary_days enable row level security;
alter table public.roamly_trip_activities enable row level security;
alter table public.roamly_trip_checklists enable row level security;
alter table public.roamly_trip_usage enable row level security;
alter table public.roamly_trip_payments enable row level security;
alter table public.roamly_admin_settings enable row level security;

drop policy if exists "Roamly profiles are private" on public.roamly_profiles;
create policy "Roamly profiles are private"
on public.roamly_profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "Roamly users insert own profile" on public.roamly_profiles;
create policy "Roamly users insert own profile"
on public.roamly_profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Roamly users update own profile" on public.roamly_profiles;
create policy "Roamly users update own profile"
on public.roamly_profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Roamly users select own trips" on public.roamly_trips;
create policy "Roamly users select own trips"
on public.roamly_trips
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own trips" on public.roamly_trips;
create policy "Roamly users create own trips"
on public.roamly_trips
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own trips" on public.roamly_trips;
create policy "Roamly users update own trips"
on public.roamly_trips
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users archive own trips" on public.roamly_trips;
create policy "Roamly users archive own trips"
on public.roamly_trips
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users select own itineraries" on public.roamly_itineraries;
create policy "Roamly users select own itineraries"
on public.roamly_itineraries
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own itineraries" on public.roamly_itineraries;
create policy "Roamly users create own itineraries"
on public.roamly_itineraries
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own itineraries" on public.roamly_itineraries;
create policy "Roamly users update own itineraries"
on public.roamly_itineraries
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users select own itinerary days" on public.roamly_itinerary_days;
create policy "Roamly users select own itinerary days"
on public.roamly_itinerary_days
for select
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_itinerary_days.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users write own itinerary days" on public.roamly_itinerary_days;
create policy "Roamly users write own itinerary days"
on public.roamly_itinerary_days
for all
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_itinerary_days.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_itinerary_days.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users select own activities" on public.roamly_trip_activities;
create policy "Roamly users select own activities"
on public.roamly_trip_activities
for select
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_activities.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users write own activities" on public.roamly_trip_activities;
create policy "Roamly users write own activities"
on public.roamly_trip_activities
for all
to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_activities.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_activities.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users manage own checklist" on public.roamly_trip_checklists;
create policy "Roamly users manage own checklist"
on public.roamly_trip_checklists
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users manage own usage" on public.roamly_trip_usage;
create policy "Roamly users manage own usage"
on public.roamly_trip_usage
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users view own payments" on public.roamly_trip_payments;
create policy "Roamly users view own payments"
on public.roamly_trip_payments
for select
to authenticated
using (user_id = auth.uid());

-- No authenticated policy is added for roamly_admin_settings.
-- Admin writes should use server-side admin logic with SUPABASE_SERVICE_ROLE_KEY.
