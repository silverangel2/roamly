-- Roamly standalone production schema.
-- Run this in the Roamly Supabase project only.
-- It is idempotent and only creates/updates public.roamly_* objects.

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
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  full_name text,
  avatar_url text,
  auth_provider text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_profiles
  add column if not exists user_id uuid,
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists avatar_url text,
  add column if not exists auth_provider text,
  add column if not exists first_seen_at timestamptz default now(),
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.roamly_profiles alter column id set default gen_random_uuid();
alter table public.roamly_profiles alter column email drop not null;
alter table public.roamly_profiles drop constraint if exists roamly_profiles_id_fkey;

update public.roamly_profiles
set user_id = id
where user_id is null;

do $$
begin
  if not exists (select 1 from public.roamly_profiles where user_id is null) then
    alter table public.roamly_profiles alter column user_id set not null;
  end if;
end $$;

create table if not exists public.roamly_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text,
  destination text,
  destination_name text,
  destination_country text,
  destination_region text,
  destination_city text,
  origin text,
  start_date date,
  end_date date,
  days_count integer,
  travelers_count integer not null default 1,
  budget_amount numeric(12, 2),
  budget_currency text not null default 'CAD',
  budget_includes_flights boolean not null default true,
  budget_includes_hotel boolean not null default true,
  travel_style text,
  interests text[] not null default '{}',
  accommodation_preference text,
  transportation_preference text,
  special_notes text,
  status text not null default 'draft',
  is_activated boolean not null default false,
  activated_at timestamptz,
  itinerary_status text not null default 'draft',
  itinerary_locked boolean not null default false,
  itinerary_locked_at timestamptz,
  itinerary_generated_at timestamptz,
  itinerary_unlock_source text,
  itinerary_payment_status text not null default 'unpaid',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  tracking_unlocked boolean not null default false,
  tracking_unlock_source text,
  tracking_paid_at timestamptz,
  tracking_stripe_checkout_session_id text,
  tracking_stripe_payment_intent_id text,
  latest_price_discovery_id uuid,
  live_companion_unlocked boolean not null default false,
  live_companion_unlocked_at timestamptz,
  live_companion_source text,
  travel_country_info jsonb not null default '{}'::jsonb,
  packing_checklist jsonb not null default '[]'::jsonb,
  document_checklist jsonb not null default '[]'::jsonb,
  countdown_started_at timestamptz,
  trip_companion_status text not null default 'inactive',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_trips
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists destination text,
  add column if not exists destination_name text,
  add column if not exists destination_country text,
  add column if not exists destination_region text,
  add column if not exists destination_city text,
  add column if not exists origin text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists days_count integer,
  add column if not exists travelers_count integer not null default 1,
  add column if not exists budget_amount numeric(12, 2),
  add column if not exists budget_currency text not null default 'CAD',
  add column if not exists budget_includes_flights boolean not null default true,
  add column if not exists budget_includes_hotel boolean not null default true,
  add column if not exists travel_style text,
  add column if not exists interests text[] not null default '{}',
  add column if not exists accommodation_preference text,
  add column if not exists transportation_preference text,
  add column if not exists special_notes text,
  add column if not exists status text not null default 'draft',
  add column if not exists is_activated boolean not null default false,
  add column if not exists activated_at timestamptz,
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
  add column if not exists tracking_stripe_payment_intent_id text,
  add column if not exists latest_price_discovery_id uuid,
  add column if not exists live_companion_unlocked boolean not null default false,
  add column if not exists live_companion_unlocked_at timestamptz,
  add column if not exists live_companion_source text,
  add column if not exists travel_country_info jsonb not null default '{}'::jsonb,
  add column if not exists packing_checklist jsonb not null default '[]'::jsonb,
  add column if not exists document_checklist jsonb not null default '[]'::jsonb,
  add column if not exists countdown_started_at timestamptz,
  add column if not exists trip_companion_status text not null default 'inactive',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_itineraries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  user_id uuid not null,
  ai_summary text,
  full_json jsonb not null default '{}'::jsonb,
  preview_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_itineraries
  add column if not exists trip_id uuid,
  add column if not exists user_id uuid,
  add column if not exists ai_summary text,
  add column if not exists full_json jsonb not null default '{}'::jsonb,
  add column if not exists preview_json jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  day_number integer not null,
  date date,
  title text,
  summary text,
  morning_plan text,
  afternoon_plan text,
  evening_plan text,
  food_suggestions text,
  transport_notes text,
  estimated_cost numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_itinerary_days
  add column if not exists trip_id uuid,
  add column if not exists day_number integer,
  add column if not exists date date,
  add column if not exists title text,
  add column if not exists summary text,
  add column if not exists morning_plan text,
  add column if not exists afternoon_plan text,
  add column if not exists evening_plan text,
  add column if not exists food_suggestions text,
  add column if not exists transport_notes text,
  add column if not exists estimated_cost numeric(12, 2),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_trip_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  day_number integer not null,
  time_label text,
  title text not null,
  description text,
  location_name text,
  estimated_cost numeric(12, 2),
  category text,
  map_query text,
  status text not null default 'planned',
  checked_in_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_trip_activities
  add column if not exists trip_id uuid,
  add column if not exists day_number integer,
  add column if not exists time_label text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists location_name text,
  add column if not exists estimated_cost numeric(12, 2),
  add column if not exists category text,
  add column if not exists map_query text,
  add column if not exists status text not null default 'planned',
  add column if not exists checked_in_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_trip_checklists (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  user_id uuid not null,
  item text not null,
  category text,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.roamly_trip_checklists
  add column if not exists trip_id uuid,
  add column if not exists user_id uuid,
  add column if not exists item text,
  add column if not exists category text,
  add column if not exists is_done boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.roamly_trip_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  usage_date date not null default current_date,
  itinerary_generations integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_trip_usage
  add column if not exists user_id uuid,
  add column if not exists usage_date date not null default current_date,
  add column if not exists itinerary_generations integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_trip_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trip_id uuid not null,
  stripe_session_id text,
  stripe_payment_intent text,
  amount integer not null,
  currency text not null default 'cad',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.roamly_trip_payments
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists stripe_session_id text,
  add column if not exists stripe_payment_intent text,
  add column if not exists amount integer,
  add column if not exists currency text not null default 'cad',
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.roamly_admin_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.roamly_admin_settings
  add column if not exists key text,
  add column if not exists value jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  day_number integer not null,
  date date,
  title text,
  summary text,
  created_at timestamptz not null default now()
);

alter table public.roamly_trip_days
  add column if not exists trip_id uuid,
  add column if not exists day_number integer,
  add column if not exists date date,
  add column if not exists title text,
  add column if not exists summary text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.roamly_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  trip_day_id uuid,
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
  status text not null default 'planned',
  checked_in_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.roamly_activities
  add column if not exists trip_id uuid,
  add column if not exists trip_day_id uuid,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists category text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists country text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists radius_meters integer not null default 250,
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists sort_order integer not null default 0,
  add column if not exists status text not null default 'planned',
  add column if not exists checked_in_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.roamly_trip_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  trip_id uuid,
  activity_id uuid,
  event_type text not null,
  event_title text,
  event_body text,
  latitude double precision,
  longitude double precision,
  distance_meters integer,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.roamly_trip_events
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists activity_id uuid,
  add column if not exists event_type text,
  add column if not exists event_title text,
  add column if not exists event_body text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists distance_meters integer,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.roamly_location_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  location_tracking_enabled boolean not null default false,
  notification_enabled boolean not null default true,
  last_permission_state text,
  last_seen_latitude double precision,
  last_seen_longitude double precision,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_location_settings
  add column if not exists user_id uuid,
  add column if not exists location_tracking_enabled boolean not null default false,
  add column if not exists notification_enabled boolean not null default true,
  add column if not exists last_permission_state text,
  add column if not exists last_seen_latitude double precision,
  add column if not exists last_seen_longitude double precision,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_app_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
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

alter table public.roamly_app_events
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists user_id uuid,
  add column if not exists visitor_key text,
  add column if not exists event_type text,
  add column if not exists path text,
  add column if not exists url text,
  add column if not exists title text,
  add column if not exists referrer text,
  add column if not exists referrer_host text,
  add column if not exists device_type text,
  add column if not exists platform text,
  add column if not exists browser text,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.roamly_user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  free_itinerary_used_at timestamptz,
  free_itinerary_trip_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_user_entitlements
  add column if not exists user_id uuid,
  add column if not exists free_itinerary_used_at timestamptz,
  add column if not exists free_itinerary_trip_id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_itinerary_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trip_id uuid not null,
  purchase_type text not null,
  amount_cents integer not null,
  currency text not null default 'cad',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.roamly_itinerary_purchases
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists purchase_type text,
  add column if not exists amount_cents integer,
  add column if not exists currency text not null default 'cad',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists paid_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.roamly_price_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trip_id uuid,
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
  total_budget_cents integer,
  includes_flights boolean not null default true,
  includes_hotel boolean not null default true,
  estimated_flight_min_cents integer,
  estimated_flight_max_cents integer,
  estimated_hotel_min_cents integer,
  estimated_hotel_max_cents integer,
  estimated_activities_min_cents integer,
  estimated_activities_max_cents integer,
  estimated_food_min_cents integer,
  estimated_food_max_cents integer,
  estimated_transport_min_cents integer,
  estimated_transport_max_cents integer,
  estimated_total_min_cents integer,
  estimated_total_max_cents integer,
  remaining_budget_min_cents integer,
  remaining_budget_max_cents integer,
  budget_status text not null default 'within_budget',
  coverage_note text,
  sources jsonb not null default '[]'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.roamly_price_discoveries
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists origin text,
  add column if not exists destination text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists days_count integer,
  add column if not exists travelers_count integer not null default 1,
  add column if not exists budget_amount numeric(12, 2),
  add column if not exists budget_currency text not null default 'CAD',
  add column if not exists budget_includes_flights boolean not null default true,
  add column if not exists budget_includes_hotel boolean not null default true,
  add column if not exists flight_estimate_cents integer not null default 0,
  add column if not exists hotel_estimate_cents integer not null default 0,
  add column if not exists activities_estimate_cents integer not null default 0,
  add column if not exists food_estimate_cents integer not null default 0,
  add column if not exists local_transport_estimate_cents integer not null default 0,
  add column if not exists buffer_estimate_cents integer not null default 0,
  add column if not exists total_estimate_cents integer not null default 0,
  add column if not exists remaining_budget_cents integer,
  add column if not exists committed_budget_cents integer not null default 0,
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
  add column if not exists budget_status text not null default 'within_budget',
  add column if not exists coverage_note text,
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists source_summary jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.roamly_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trip_id uuid,
  booking_type text not null,
  provider_name text,
  title text,
  confirmation_number text,
  booking_status text not null default 'booked',
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
  extraction_confidence text not null default 'medium',
  screenshot_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_bookings
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists booking_type text,
  add column if not exists provider_name text,
  add column if not exists title text,
  add column if not exists confirmation_number text,
  add column if not exists booking_status text not null default 'booked',
  add column if not exists amount_cents integer,
  add column if not exists currency text not null default 'cad',
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists country text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists raw_extracted_text text,
  add column if not exists extraction_confidence text not null default 'medium',
  add column if not exists screenshot_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_trip_companion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trip_id uuid,
  booking_id uuid,
  event_type text not null,
  title text,
  body text,
  scheduled_for timestamptz,
  completed_at timestamptz,
  status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.roamly_trip_companion_events
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists booking_id uuid,
  add column if not exists event_type text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists scheduled_for timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists status text not null default 'scheduled',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.roamly_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_push_subscriptions
  add column if not exists user_id uuid,
  add column if not exists endpoint text,
  add column if not exists p256dh text,
  add column if not exists auth text,
  add column if not exists user_agent text,
  add column if not exists enabled boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roamly_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trip_id uuid,
  event_id uuid,
  type text not null,
  title text not null,
  body text,
  action_url text,
  status text not null default 'unread',
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  push_status text,
  push_error text,
  email_sent_at timestamptz,
  email_status text,
  email_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.roamly_notifications
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists event_id uuid,
  add column if not exists type text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists action_url text,
  add column if not exists status text not null default 'unread',
  add column if not exists scheduled_for timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists push_status text,
  add column if not exists push_error text,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_status text,
  add column if not exists email_error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.roamly_email_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  trip_id uuid,
  notification_id uuid,
  to_email text not null,
  subject text not null,
  provider text,
  status text not null default 'pending',
  provider_message_id text,
  idempotency_key text,
  template text,
  attempt_count integer not null default 1,
  error text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.roamly_email_logs
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists notification_id uuid,
  add column if not exists to_email text,
  add column if not exists subject text,
  add column if not exists provider text,
  add column if not exists status text not null default 'pending',
  add column if not exists provider_message_id text,
  add column if not exists idempotency_key text,
  add column if not exists template text,
  add column if not exists attempt_count integer not null default 1,
  add column if not exists error text,
  add column if not exists last_error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists sent_at timestamptz;

create table if not exists public.roamly_market_prices (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  provider text,
  source text,
  origin text,
  destination text,
  city text,
  country text,
  start_date date,
  end_date date,
  travelers integer,
  rooms integer,
  room_type text,
  title text not null,
  price_amount numeric,
  price_min numeric,
  price_max numeric,
  currency text default 'CAD',
  price_type text not null,
  confidence text not null,
  booking_url text,
  normal_search_url text,
  affiliate_url text,
  search_key text not null,
  searched_at timestamptz default now(),
  expires_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.roamly_market_prices
  add column if not exists category text,
  add column if not exists provider text,
  add column if not exists source text,
  add column if not exists origin text,
  add column if not exists destination text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists travelers integer,
  add column if not exists rooms integer,
  add column if not exists room_type text,
  add column if not exists title text,
  add column if not exists price_amount numeric,
  add column if not exists price_min numeric,
  add column if not exists price_max numeric,
  add column if not exists currency text default 'CAD',
  add column if not exists price_type text,
  add column if not exists confidence text,
  add column if not exists booking_url text,
  add column if not exists normal_search_url text,
  add column if not exists affiliate_url text,
  add column if not exists search_key text,
  add column if not exists searched_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

-- Foreign keys are named so reruns can replace them consistently.
alter table public.roamly_profiles drop constraint if exists roamly_profiles_user_id_fkey;
alter table public.roamly_profiles
  add constraint roamly_profiles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_trips drop constraint if exists roamly_trips_user_id_fkey;
alter table public.roamly_trips
  add constraint roamly_trips_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_itineraries drop constraint if exists roamly_itineraries_trip_id_fkey;
alter table public.roamly_itineraries drop constraint if exists roamly_itineraries_user_id_fkey;
alter table public.roamly_itineraries
  add constraint roamly_itineraries_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade,
  add constraint roamly_itineraries_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_itinerary_days drop constraint if exists roamly_itinerary_days_trip_id_fkey;
alter table public.roamly_itinerary_days
  add constraint roamly_itinerary_days_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_trip_activities drop constraint if exists roamly_trip_activities_trip_id_fkey;
alter table public.roamly_trip_activities
  add constraint roamly_trip_activities_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_trip_checklists drop constraint if exists roamly_trip_checklists_trip_id_fkey;
alter table public.roamly_trip_checklists drop constraint if exists roamly_trip_checklists_user_id_fkey;
alter table public.roamly_trip_checklists
  add constraint roamly_trip_checklists_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade,
  add constraint roamly_trip_checklists_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_trip_usage drop constraint if exists roamly_trip_usage_user_id_fkey;
alter table public.roamly_trip_usage
  add constraint roamly_trip_usage_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_trip_payments drop constraint if exists roamly_trip_payments_user_id_fkey;
alter table public.roamly_trip_payments drop constraint if exists roamly_trip_payments_trip_id_fkey;
alter table public.roamly_trip_payments
  add constraint roamly_trip_payments_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_trip_payments_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_trip_days drop constraint if exists roamly_trip_days_trip_id_fkey;
alter table public.roamly_trip_days
  add constraint roamly_trip_days_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_activities drop constraint if exists roamly_activities_trip_id_fkey;
alter table public.roamly_activities drop constraint if exists roamly_activities_trip_day_id_fkey;
alter table public.roamly_activities
  add constraint roamly_activities_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade,
  add constraint roamly_activities_trip_day_id_fkey foreign key (trip_day_id) references public.roamly_trip_days(id) on delete set null;

alter table public.roamly_trip_events drop constraint if exists roamly_trip_events_user_id_fkey;
alter table public.roamly_trip_events drop constraint if exists roamly_trip_events_trip_id_fkey;
alter table public.roamly_trip_events drop constraint if exists roamly_trip_events_activity_id_fkey;
alter table public.roamly_trip_events
  add constraint roamly_trip_events_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null,
  add constraint roamly_trip_events_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade,
  add constraint roamly_trip_events_activity_id_fkey foreign key (activity_id) references public.roamly_activities(id) on delete set null;

alter table public.roamly_location_settings drop constraint if exists roamly_location_settings_user_id_fkey;
alter table public.roamly_location_settings
  add constraint roamly_location_settings_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_app_events drop constraint if exists roamly_app_events_user_id_fkey;
alter table public.roamly_app_events
  add constraint roamly_app_events_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table public.roamly_user_entitlements drop constraint if exists roamly_user_entitlements_user_id_fkey;
alter table public.roamly_user_entitlements drop constraint if exists roamly_user_entitlements_free_trip_fk;
alter table public.roamly_user_entitlements
  add constraint roamly_user_entitlements_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_user_entitlements_free_trip_fk foreign key (free_itinerary_trip_id) references public.roamly_trips(id) on delete set null;

alter table public.roamly_itinerary_purchases drop constraint if exists roamly_itinerary_purchases_user_id_fkey;
alter table public.roamly_itinerary_purchases drop constraint if exists roamly_itinerary_purchases_trip_id_fkey;
alter table public.roamly_itinerary_purchases
  add constraint roamly_itinerary_purchases_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_itinerary_purchases_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_price_discoveries drop constraint if exists roamly_price_discoveries_user_id_fkey;
alter table public.roamly_price_discoveries drop constraint if exists roamly_price_discoveries_trip_id_fkey;
alter table public.roamly_price_discoveries
  add constraint roamly_price_discoveries_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_price_discoveries_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_trips drop constraint if exists roamly_trips_latest_price_discovery_fk;
alter table public.roamly_trips
  add constraint roamly_trips_latest_price_discovery_fk foreign key (latest_price_discovery_id) references public.roamly_price_discoveries(id) on delete set null;

alter table public.roamly_bookings drop constraint if exists roamly_bookings_user_id_fkey;
alter table public.roamly_bookings drop constraint if exists roamly_bookings_trip_id_fkey;
alter table public.roamly_bookings
  add constraint roamly_bookings_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_bookings_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade;

alter table public.roamly_trip_companion_events drop constraint if exists roamly_trip_companion_events_user_id_fkey;
alter table public.roamly_trip_companion_events drop constraint if exists roamly_trip_companion_events_trip_id_fkey;
alter table public.roamly_trip_companion_events drop constraint if exists roamly_trip_companion_events_booking_id_fkey;
alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_trip_companion_events_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade,
  add constraint roamly_trip_companion_events_booking_id_fkey foreign key (booking_id) references public.roamly_bookings(id) on delete set null;

alter table public.roamly_push_subscriptions drop constraint if exists roamly_push_subscriptions_user_id_fkey;
alter table public.roamly_push_subscriptions
  add constraint roamly_push_subscriptions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.roamly_notifications drop constraint if exists roamly_notifications_user_id_fkey;
alter table public.roamly_notifications drop constraint if exists roamly_notifications_trip_id_fkey;
alter table public.roamly_notifications drop constraint if exists roamly_notifications_event_id_fkey;
alter table public.roamly_notifications
  add constraint roamly_notifications_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint roamly_notifications_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete cascade,
  add constraint roamly_notifications_event_id_fkey foreign key (event_id) references public.roamly_trip_companion_events(id) on delete set null;

alter table public.roamly_email_logs drop constraint if exists roamly_email_logs_user_id_fkey;
alter table public.roamly_email_logs drop constraint if exists roamly_email_logs_trip_id_fkey;
alter table public.roamly_email_logs drop constraint if exists roamly_email_logs_notification_id_fkey;
alter table public.roamly_email_logs
  add constraint roamly_email_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null,
  add constraint roamly_email_logs_trip_id_fkey foreign key (trip_id) references public.roamly_trips(id) on delete set null,
  add constraint roamly_email_logs_notification_id_fkey foreign key (notification_id) references public.roamly_notifications(id) on delete set null;

-- Checks are rebuilt to include the values currently used by the app.
alter table public.roamly_trips
  drop constraint if exists roamly_trips_days_count_check,
  drop constraint if exists roamly_trips_budget_amount_check,
  drop constraint if exists roamly_trips_travelers_count_check,
  drop constraint if exists roamly_trips_status_check,
  drop constraint if exists roamly_trips_itinerary_status_check,
  drop constraint if exists roamly_trips_itinerary_unlock_source_check,
  drop constraint if exists roamly_trips_itinerary_payment_status_check,
  drop constraint if exists roamly_trips_tracking_unlock_source_check,
  drop constraint if exists roamly_trips_live_companion_source_check,
  drop constraint if exists roamly_trips_trip_companion_status_check;

alter table public.roamly_trips
  add constraint roamly_trips_days_count_check check (days_count is null or days_count > 0),
  add constraint roamly_trips_budget_amount_check check (budget_amount is null or budget_amount >= 0),
  add constraint roamly_trips_travelers_count_check check (travelers_count > 0),
  add constraint roamly_trips_status_check check (status in ('draft', 'preview', 'payment_required', 'generating', 'generated', 'locked', 'activated', 'archived', 'planned', 'active', 'completed', 'cancelled')),
  add constraint roamly_trips_itinerary_status_check check (itinerary_status in ('draft', 'preview', 'payment_required', 'generating', 'generated', 'locked')),
  add constraint roamly_trips_itinerary_unlock_source_check check (itinerary_unlock_source is null or itinerary_unlock_source in ('free', 'paid', 'bundle', 'admin')),
  add constraint roamly_trips_itinerary_payment_status_check check (itinerary_payment_status in ('unpaid', 'paid', 'free', 'bundled')),
  add constraint roamly_trips_tracking_unlock_source_check check (tracking_unlock_source is null or tracking_unlock_source in ('paid', 'bundle', 'admin')),
  add constraint roamly_trips_live_companion_source_check check (live_companion_source is null or live_companion_source in ('paid', 'bundle', 'admin')),
  add constraint roamly_trips_trip_companion_status_check check (trip_companion_status in ('inactive', 'scheduled', 'active', 'completed'));

alter table public.roamly_itinerary_days
  drop constraint if exists roamly_itinerary_days_day_number_check,
  drop constraint if exists roamly_itinerary_days_estimated_cost_check;
alter table public.roamly_itinerary_days
  add constraint roamly_itinerary_days_day_number_check check (day_number > 0),
  add constraint roamly_itinerary_days_estimated_cost_check check (estimated_cost is null or estimated_cost >= 0);

alter table public.roamly_trip_activities
  drop constraint if exists roamly_trip_activities_day_number_check,
  drop constraint if exists roamly_trip_activities_estimated_cost_check,
  drop constraint if exists roamly_trip_activities_status_check,
  drop constraint if exists roamly_trip_activities_status_live_check;
alter table public.roamly_trip_activities
  add constraint roamly_trip_activities_day_number_check check (day_number > 0),
  add constraint roamly_trip_activities_estimated_cost_check check (estimated_cost is null or estimated_cost >= 0),
  add constraint roamly_trip_activities_status_check check (status in ('planned', 'active', 'nearby', 'checked_in', 'completed', 'skipped', 'missed'));

alter table public.roamly_trip_usage
  drop constraint if exists roamly_trip_usage_itinerary_generations_check;
alter table public.roamly_trip_usage
  add constraint roamly_trip_usage_itinerary_generations_check check (itinerary_generations >= 0);

alter table public.roamly_trip_payments
  drop constraint if exists roamly_trip_payments_amount_check;
alter table public.roamly_trip_payments
  add constraint roamly_trip_payments_amount_check check (amount >= 0);

alter table public.roamly_trip_days
  drop constraint if exists roamly_trip_days_day_number_check;
alter table public.roamly_trip_days
  add constraint roamly_trip_days_day_number_check check (day_number > 0);

alter table public.roamly_activities
  drop constraint if exists roamly_activities_radius_meters_check,
  drop constraint if exists roamly_activities_status_check,
  drop constraint if exists roamly_activities_status_live_check;
alter table public.roamly_activities
  add constraint roamly_activities_radius_meters_check check (radius_meters > 0),
  add constraint roamly_activities_status_check check (status in ('planned', 'nearby', 'checked_in', 'completed', 'skipped', 'missed'));

alter table public.roamly_itinerary_purchases
  drop constraint if exists roamly_itinerary_purchases_amount_cents_check,
  drop constraint if exists roamly_itinerary_purchases_purchase_type_check,
  drop constraint if exists roamly_itinerary_purchases_status_check;
alter table public.roamly_itinerary_purchases
  add constraint roamly_itinerary_purchases_amount_cents_check check (amount_cents >= 0),
  add constraint roamly_itinerary_purchases_purchase_type_check check (purchase_type in ('itinerary', 'features', 'complete_trip', 'itinerary_unlock', 'tracking_addon', 'bundle')),
  add constraint roamly_itinerary_purchases_status_check check (status in ('pending', 'paid', 'failed', 'cancelled'));

alter table public.roamly_price_discoveries
  drop constraint if exists roamly_price_discoveries_budget_status_check;
alter table public.roamly_price_discoveries
  add constraint roamly_price_discoveries_budget_status_check check (budget_status in ('within_budget', 'tight', 'over_budget', 'unknown'));

alter table public.roamly_bookings
  drop constraint if exists roamly_bookings_booking_type_check,
  drop constraint if exists roamly_bookings_booking_status_check,
  drop constraint if exists roamly_bookings_extraction_confidence_check;
alter table public.roamly_bookings
  add constraint roamly_bookings_booking_type_check check (booking_type in ('flight', 'hotel', 'attraction', 'restaurant', 'transport', 'car_rental', 'event', 'other')),
  add constraint roamly_bookings_booking_status_check check (booking_status in ('booked', 'paid', 'reserved', 'cancelled', 'unknown')),
  add constraint roamly_bookings_extraction_confidence_check check (extraction_confidence in ('low', 'medium', 'high'));

alter table public.roamly_trip_companion_events
  drop constraint if exists roamly_trip_companion_events_event_type_check,
  drop constraint if exists roamly_trip_companion_events_type_live_check,
  drop constraint if exists roamly_trip_companion_events_status_check;
alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_event_type_check check (event_type in (
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
    'navigation_opened',
    'activity_checked_in',
    'activity_skipped',
    'activity_completed',
    'test_notification'
  )),
  add constraint roamly_trip_companion_events_status_check check (status in ('scheduled', 'shown', 'completed', 'skipped', 'cancelled'));

alter table public.roamly_notifications
  drop constraint if exists roamly_notifications_status_check;
alter table public.roamly_notifications
  add constraint roamly_notifications_status_check check (status in ('unread', 'read', 'dismissed', 'sent', 'failed'));

alter table public.roamly_email_logs
  drop constraint if exists roamly_email_logs_status_check;
alter table public.roamly_email_logs
  drop constraint if exists roamly_email_logs_attempt_count_check;
alter table public.roamly_email_logs
  add constraint roamly_email_logs_status_check check (status in ('pending', 'sent', 'failed', 'skipped', 'captured')),
  add constraint roamly_email_logs_attempt_count_check check (attempt_count >= 0);

alter table public.roamly_market_prices
  drop constraint if exists roamly_market_prices_category_check,
  drop constraint if exists roamly_market_prices_source_check,
  drop constraint if exists roamly_market_prices_price_type_check,
  drop constraint if exists roamly_market_prices_confidence_check;
alter table public.roamly_market_prices
  add constraint roamly_market_prices_category_check check (category in ('flight', 'hotel', 'attraction', 'tour', 'transport')),
  add constraint roamly_market_prices_source_check check (source is null or source in ('travelpayouts', 'stay22', 'getyourguide', 'viator', 'klook', 'google_search', 'fallback_estimate')),
  add constraint roamly_market_prices_price_type_check check (price_type in ('live_partner', 'cached_recent', 'search_ready', 'estimated_fallback', 'unknown')),
  add constraint roamly_market_prices_confidence_check check (confidence in ('high', 'medium', 'low'));

-- Unique indexes and query indexes used by the app.
create unique index if not exists roamly_profiles_user_id_key on public.roamly_profiles (user_id);
create index if not exists roamly_profiles_email_idx on public.roamly_profiles (lower(email));
create index if not exists roamly_profiles_user_id_idx on public.roamly_profiles (user_id);
create index if not exists roamly_profiles_auth_provider_idx on public.roamly_profiles (auth_provider);

create index if not exists roamly_trips_user_status_idx on public.roamly_trips (user_id, status, created_at desc);
create index if not exists roamly_trips_activated_idx on public.roamly_trips (user_id, is_activated, activated_at desc);
create index if not exists roamly_trips_itinerary_state_idx on public.roamly_trips (user_id, itinerary_status, itinerary_locked, created_at desc);
create index if not exists roamly_trips_tracking_idx on public.roamly_trips (user_id, tracking_unlocked, tracking_paid_at desc);

create index if not exists roamly_itineraries_trip_idx on public.roamly_itineraries (trip_id, created_at desc);
create unique index if not exists roamly_itinerary_days_trip_day_key on public.roamly_itinerary_days (trip_id, day_number);
create index if not exists roamly_itinerary_days_trip_idx on public.roamly_itinerary_days (trip_id, day_number);
create index if not exists roamly_trip_activities_trip_day_idx on public.roamly_trip_activities (trip_id, day_number, created_at);
create index if not exists roamly_trip_activities_status_idx on public.roamly_trip_activities (trip_id, status);
create index if not exists roamly_trip_checklists_trip_idx on public.roamly_trip_checklists (trip_id, user_id);
create unique index if not exists roamly_trip_usage_user_date_key on public.roamly_trip_usage (user_id, usage_date);
create index if not exists roamly_trip_usage_user_date_idx on public.roamly_trip_usage (user_id, usage_date);
create unique index if not exists roamly_trip_payments_stripe_session_id_key on public.roamly_trip_payments (stripe_session_id);
create index if not exists roamly_trip_payments_trip_idx on public.roamly_trip_payments (trip_id, user_id, created_at desc);
create unique index if not exists roamly_admin_settings_key_key on public.roamly_admin_settings (key);

create unique index if not exists roamly_trip_days_trip_day_key on public.roamly_trip_days (trip_id, day_number);
create index if not exists roamly_trip_days_trip_idx on public.roamly_trip_days (trip_id, day_number);
create index if not exists roamly_activities_trip_idx on public.roamly_activities (trip_id, sort_order);
create index if not exists roamly_activities_status_idx on public.roamly_activities (status, created_at desc);
create index if not exists roamly_activities_lat_lon_idx on public.roamly_activities (latitude, longitude);
create index if not exists roamly_activities_live_status_idx on public.roamly_activities (trip_id, status, sort_order);
create index if not exists roamly_trip_events_created_idx on public.roamly_trip_events (created_at desc);
create index if not exists roamly_trip_events_trip_idx on public.roamly_trip_events (trip_id, created_at desc);
create index if not exists roamly_trip_events_user_idx on public.roamly_trip_events (user_id, created_at desc);
create index if not exists roamly_trip_events_type_idx on public.roamly_trip_events (event_type, created_at desc);
create unique index if not exists roamly_location_settings_user_key on public.roamly_location_settings (user_id);
create index if not exists roamly_location_settings_user_idx on public.roamly_location_settings (user_id);
create index if not exists roamly_app_events_created_idx on public.roamly_app_events (created_at desc);
create index if not exists roamly_app_events_user_idx on public.roamly_app_events (user_id, created_at desc);
create index if not exists roamly_app_events_visitor_idx on public.roamly_app_events (visitor_key, created_at desc);
create index if not exists roamly_app_events_type_idx on public.roamly_app_events (event_type, created_at desc);
create index if not exists roamly_app_events_path_idx on public.roamly_app_events (path, created_at desc);

create unique index if not exists roamly_user_entitlements_user_key on public.roamly_user_entitlements (user_id);
create index if not exists roamly_user_entitlements_user_idx on public.roamly_user_entitlements (user_id);
create unique index if not exists roamly_itinerary_purchases_stripe_checkout_session_id_key on public.roamly_itinerary_purchases (stripe_checkout_session_id);
create index if not exists roamly_itinerary_purchases_trip_idx on public.roamly_itinerary_purchases (trip_id, user_id, created_at desc);
create index if not exists roamly_itinerary_purchases_type_idx on public.roamly_itinerary_purchases (purchase_type, status, created_at desc);
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
create unique index if not exists roamly_push_subscriptions_endpoint_key on public.roamly_push_subscriptions (endpoint);
create index if not exists roamly_push_subscriptions_user_idx on public.roamly_push_subscriptions (user_id);
create index if not exists roamly_push_subscriptions_endpoint_idx on public.roamly_push_subscriptions (endpoint);
create index if not exists roamly_push_subscriptions_enabled_idx on public.roamly_push_subscriptions (enabled);
create index if not exists roamly_notifications_user_idx on public.roamly_notifications (user_id, created_at desc);
create index if not exists roamly_notifications_trip_idx on public.roamly_notifications (trip_id, created_at desc);
create index if not exists roamly_notifications_type_idx on public.roamly_notifications (type);
create index if not exists roamly_notifications_status_idx on public.roamly_notifications (status, scheduled_for);
create index if not exists roamly_notifications_scheduled_idx on public.roamly_notifications (scheduled_for);
create index if not exists roamly_notifications_push_status_idx on public.roamly_notifications (push_status, created_at desc);
create index if not exists roamly_notifications_sent_at_idx on public.roamly_notifications (sent_at desc);
create index if not exists roamly_email_logs_user_idx on public.roamly_email_logs (user_id);
create index if not exists roamly_email_logs_trip_idx on public.roamly_email_logs (trip_id);
create index if not exists roamly_email_logs_notification_idx on public.roamly_email_logs (notification_id);
create index if not exists roamly_email_logs_status_idx on public.roamly_email_logs (status);
create index if not exists roamly_email_logs_provider_idx on public.roamly_email_logs (provider);
create index if not exists roamly_email_logs_template_idx on public.roamly_email_logs (template);
create index if not exists roamly_email_logs_created_idx on public.roamly_email_logs (created_at desc);
create index if not exists roamly_email_logs_sent_idx on public.roamly_email_logs (sent_at desc) where sent_at is not null;
create index if not exists roamly_email_logs_idempotency_idx on public.roamly_email_logs (idempotency_key) where idempotency_key is not null;
create index if not exists roamly_market_prices_search_key_idx on public.roamly_market_prices (search_key);
create index if not exists roamly_market_prices_category_idx on public.roamly_market_prices (category);
create index if not exists roamly_market_prices_expires_at_idx on public.roamly_market_prices (expires_at);
create index if not exists roamly_market_prices_dates_idx on public.roamly_market_prices (start_date, end_date);

-- Updated-at triggers.
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

drop trigger if exists roamly_activities_updated_at on public.roamly_activities;
create trigger roamly_activities_updated_at
before update on public.roamly_activities
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_location_settings_updated_at on public.roamly_location_settings;
create trigger roamly_location_settings_updated_at
before update on public.roamly_location_settings
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_user_entitlements_updated_at on public.roamly_user_entitlements;
create trigger roamly_user_entitlements_updated_at
before update on public.roamly_user_entitlements
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_bookings_updated_at on public.roamly_bookings;
create trigger roamly_bookings_updated_at
before update on public.roamly_bookings
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_push_subscriptions_updated_at on public.roamly_push_subscriptions;
create trigger roamly_push_subscriptions_updated_at
before update on public.roamly_push_subscriptions
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
alter table public.roamly_trip_days enable row level security;
alter table public.roamly_activities enable row level security;
alter table public.roamly_trip_events enable row level security;
alter table public.roamly_location_settings enable row level security;
alter table public.roamly_app_events enable row level security;
alter table public.roamly_user_entitlements enable row level security;
alter table public.roamly_itinerary_purchases enable row level security;
alter table public.roamly_price_discoveries enable row level security;
alter table public.roamly_bookings enable row level security;
alter table public.roamly_trip_companion_events enable row level security;
alter table public.roamly_push_subscriptions enable row level security;
alter table public.roamly_notifications enable row level security;
alter table public.roamly_email_logs enable row level security;
alter table public.roamly_market_prices enable row level security;

-- Drop legacy policy names before creating the consolidated policies.
drop policy if exists "Roamly profiles are private" on public.roamly_profiles;
drop policy if exists "Roamly users insert own profile" on public.roamly_profiles;
drop policy if exists "Roamly users update own profile" on public.roamly_profiles;
drop policy if exists "Roamly users manage own profile" on public.roamly_profiles;

drop policy if exists "Roamly users select own trips" on public.roamly_trips;
drop policy if exists "Roamly users create own trips" on public.roamly_trips;
drop policy if exists "Roamly users update own trips" on public.roamly_trips;
drop policy if exists "Roamly users archive own trips" on public.roamly_trips;
drop policy if exists "Roamly users manage own trips" on public.roamly_trips;

drop policy if exists "Roamly users select own itineraries" on public.roamly_itineraries;
drop policy if exists "Roamly users create own itineraries" on public.roamly_itineraries;
drop policy if exists "Roamly users update own itineraries" on public.roamly_itineraries;
drop policy if exists "Roamly users manage own itineraries" on public.roamly_itineraries;

drop policy if exists "Roamly users select own itinerary days" on public.roamly_itinerary_days;
drop policy if exists "Roamly users write own itinerary days" on public.roamly_itinerary_days;
drop policy if exists "Roamly users manage own itinerary days" on public.roamly_itinerary_days;

drop policy if exists "Roamly users select own activities" on public.roamly_trip_activities;
drop policy if exists "Roamly users write own activities" on public.roamly_trip_activities;
drop policy if exists "Roamly users manage own trip activities" on public.roamly_trip_activities;

drop policy if exists "Roamly users manage own checklist" on public.roamly_trip_checklists;
drop policy if exists "Roamly users manage own usage" on public.roamly_trip_usage;
drop policy if exists "Roamly users view own payments" on public.roamly_trip_payments;
drop policy if exists "Roamly users insert own pending payments" on public.roamly_trip_payments;
drop policy if exists "Roamly service role manages admin settings" on public.roamly_admin_settings;

drop policy if exists "Roamly users read own trip days" on public.roamly_trip_days;
drop policy if exists "Roamly users manage own trip days" on public.roamly_trip_days;
drop policy if exists "Roamly users read own activities" on public.roamly_activities;
drop policy if exists "Roamly users manage own activities" on public.roamly_activities;
drop policy if exists "Roamly users read own trip events" on public.roamly_trip_events;
drop policy if exists "Roamly users create own trip events" on public.roamly_trip_events;
drop policy if exists "Roamly users manage own trip events" on public.roamly_trip_events;
drop policy if exists "Roamly users manage own location settings" on public.roamly_location_settings;
drop policy if exists "Roamly users create app events" on public.roamly_app_events;
drop policy if exists "Roamly users read own app events" on public.roamly_app_events;
drop policy if exists "Roamly users manage own app events" on public.roamly_app_events;

drop policy if exists "Roamly users read own entitlements" on public.roamly_user_entitlements;
drop policy if exists "Roamly users insert own entitlements" on public.roamly_user_entitlements;
drop policy if exists "Roamly users update own entitlements" on public.roamly_user_entitlements;
drop policy if exists "Roamly users manage own entitlements" on public.roamly_user_entitlements;
drop policy if exists "Roamly users read own purchases" on public.roamly_itinerary_purchases;
drop policy if exists "Roamly users insert own pending purchases" on public.roamly_itinerary_purchases;
drop policy if exists "Roamly users read own price discoveries" on public.roamly_price_discoveries;
drop policy if exists "Roamly users create own price discoveries" on public.roamly_price_discoveries;
drop policy if exists "Roamly users manage own price discoveries" on public.roamly_price_discoveries;
drop policy if exists "Roamly users read own bookings" on public.roamly_bookings;
drop policy if exists "Roamly users create own bookings" on public.roamly_bookings;
drop policy if exists "Roamly users update own bookings" on public.roamly_bookings;
drop policy if exists "Roamly users manage own bookings" on public.roamly_bookings;
drop policy if exists "Roamly users read own companion events" on public.roamly_trip_companion_events;
drop policy if exists "Roamly users create own companion events" on public.roamly_trip_companion_events;
drop policy if exists "Roamly users update own companion events" on public.roamly_trip_companion_events;
drop policy if exists "Roamly users manage own companion events" on public.roamly_trip_companion_events;
drop policy if exists "Roamly users manage own push subscriptions" on public.roamly_push_subscriptions;
drop policy if exists "Roamly users read own notifications" on public.roamly_notifications;
drop policy if exists "Roamly users update own notifications" on public.roamly_notifications;
drop policy if exists "Roamly users manage own notifications" on public.roamly_notifications;
drop policy if exists "Roamly users read own email logs" on public.roamly_email_logs;
drop policy if exists "Roamly service role manages email logs" on public.roamly_email_logs;
drop policy if exists "Roamly authenticated users read market prices" on public.roamly_market_prices;
drop policy if exists "Roamly authenticated users insert market prices" on public.roamly_market_prices;
drop policy if exists "Roamly authenticated users update market prices" on public.roamly_market_prices;

create policy "Roamly users manage own profile"
on public.roamly_profiles
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Roamly users manage own trips"
on public.roamly_trips
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Roamly users manage own itineraries"
on public.roamly_itineraries
for all
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_itineraries.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_itineraries.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

create policy "Roamly users manage own itinerary days"
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

create policy "Roamly users manage own trip activities"
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

create policy "Roamly users manage own checklist"
on public.roamly_trip_checklists
for all
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_checklists.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_checklists.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

create policy "Roamly users manage own usage"
on public.roamly_trip_usage
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Roamly users view own payments"
on public.roamly_trip_payments
for select
to authenticated
using (user_id = auth.uid());

create policy "Roamly users insert own pending payments"
on public.roamly_trip_payments
for insert
to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_payments.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

create policy "Roamly service role manages admin settings"
on public.roamly_admin_settings
for all
to service_role
using (true)
with check (true);

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

create policy "Roamly users manage own trip events"
on public.roamly_trip_events
for all
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_events.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  (user_id is null or user_id = auth.uid())
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_trip_events.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
);

create policy "Roamly users manage own location settings"
on public.roamly_location_settings
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Roamly users manage own app events"
on public.roamly_app_events
for all
to authenticated
using (user_id = auth.uid())
with check (user_id is null or user_id = auth.uid());

create policy "Roamly users manage own entitlements"
on public.roamly_user_entitlements
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Roamly users read own purchases"
on public.roamly_itinerary_purchases
for select
to authenticated
using (user_id = auth.uid());

create policy "Roamly users insert own pending purchases"
on public.roamly_itinerary_purchases
for insert
to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_itinerary_purchases.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

create policy "Roamly users manage own price discoveries"
on public.roamly_price_discoveries
for all
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_price_discoveries.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_price_discoveries.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
);

create policy "Roamly users manage own bookings"
on public.roamly_bookings
for all
to authenticated
using (
  user_id = auth.uid()
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_bookings.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
)
with check (
  user_id = auth.uid()
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_bookings.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
);

create policy "Roamly users manage own companion events"
on public.roamly_trip_companion_events
for all
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_trip_companion_events.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_trip_companion_events.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
);

create policy "Roamly users manage own push subscriptions"
on public.roamly_push_subscriptions
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Roamly users manage own notifications"
on public.roamly_notifications
for all
to authenticated
using (
  user_id = auth.uid()
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_notifications.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
)
with check (
  user_id = auth.uid()
  and (
    trip_id is null
    or exists (
      select 1 from public.roamly_trips
      where roamly_trips.id = roamly_notifications.trip_id
        and roamly_trips.user_id = auth.uid()
    )
  )
);

create policy "Roamly users read own email logs"
on public.roamly_email_logs
for select
to authenticated
using (user_id = auth.uid());

create policy "Roamly service role manages email logs"
on public.roamly_email_logs
for all
to service_role
using (true)
with check (true);

create policy "Roamly authenticated users read market prices"
on public.roamly_market_prices
for select
to authenticated
using (true);

create policy "Roamly authenticated users insert market prices"
on public.roamly_market_prices
for insert
to authenticated
with check (true);

create policy "Roamly authenticated users update market prices"
on public.roamly_market_prices
for update
to authenticated
using (true)
with check (true);

notify pgrst, 'reload schema';
