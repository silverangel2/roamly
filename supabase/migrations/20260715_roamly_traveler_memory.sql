-- Durable traveler preference memory for Roamly personalization.

create extension if not exists pgcrypto;

create table if not exists public.traveler_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  preferred_travel_pace text,
  maximum_comfortable_driving_hours numeric,
  preferred_departure_windows jsonb not null default '[]'::jsonb,
  airport_preferences jsonb not null default '[]'::jsonb,
  transportation_preferences jsonb not null default '[]'::jsonb,
  maximum_acceptable_transfers integer,
  accommodation_types jsonb not null default '[]'::jsonb,
  hotel_priorities jsonb not null default '[]'::jsonb,
  preferred_neighbourhood_style text,
  nightlife_interests text,
  food_interests jsonb not null default '[]'::jsonb,
  culture_interests jsonb not null default '[]'::jsonb,
  nature_interests jsonb not null default '[]'::jsonb,
  shopping_interests text,
  walking_tolerance text,
  room_preferences jsonb not null default '[]'::jsonb,
  hotel_change_tolerance text,
  typical_budget_level text,
  likes jsonb not null default '[]'::jsonb,
  dislikes jsonb not null default '[]'::jsonb,
  confirmed_preferences jsonb not null default '{}'::jsonb,
  inferred_preferences jsonb not null default '{}'::jsonb,
  preference_confidence jsonb not null default '{}'::jsonb,
  personalization_enabled boolean not null default true,
  last_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  check (maximum_comfortable_driving_hours is null or maximum_comfortable_driving_hours >= 0),
  check (maximum_acceptable_transfers is null or maximum_acceptable_transfers >= 0)
);

create table if not exists public.traveler_preference_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.traveler_profiles(id) on delete cascade,
  source_trip_id uuid references public.roamly_trips(id) on delete set null,
  source_feedback_id uuid,
  preference_key text not null,
  previous_value jsonb,
  proposed_value jsonb,
  reason text,
  source text not null default 'system',
  confidence numeric,
  status text not null default 'proposed',
  accepted_at timestamptz,
  rejected_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  check (status in ('proposed', 'accepted', 'rejected', 'reverted', 'deleted')),
  check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists traveler_profiles_user_idx on public.traveler_profiles (user_id);
create index if not exists traveler_preference_events_user_idx on public.traveler_preference_events (user_id, created_at desc);
create index if not exists traveler_preference_events_profile_idx on public.traveler_preference_events (profile_id, created_at desc);
create index if not exists traveler_preference_events_status_idx on public.traveler_preference_events (status, created_at desc);

drop trigger if exists traveler_profiles_updated_at on public.traveler_profiles;
create trigger traveler_profiles_updated_at
before update on public.traveler_profiles
for each row execute function public.roamly_set_updated_at();

alter table public.traveler_profiles enable row level security;
alter table public.traveler_preference_events enable row level security;

drop policy if exists "Roamly users read own traveler profile" on public.traveler_profiles;
create policy "Roamly users read own traveler profile"
on public.traveler_profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users insert own traveler profile" on public.traveler_profiles;
create policy "Roamly users insert own traveler profile"
on public.traveler_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own traveler profile" on public.traveler_profiles;
create policy "Roamly users update own traveler profile"
on public.traveler_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users delete own traveler profile" on public.traveler_profiles;
create policy "Roamly users delete own traveler profile"
on public.traveler_profiles
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages traveler profiles" on public.traveler_profiles;
create policy "Roamly service role manages traveler profiles"
on public.traveler_profiles
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly users read own preference events" on public.traveler_preference_events;
create policy "Roamly users read own preference events"
on public.traveler_preference_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own preference events" on public.traveler_preference_events;
create policy "Roamly users create own preference events"
on public.traveler_preference_events
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own preference events" on public.traveler_preference_events;
create policy "Roamly users update own preference events"
on public.traveler_preference_events
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users delete own preference events" on public.traveler_preference_events;
create policy "Roamly users delete own preference events"
on public.traveler_preference_events
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages preference events" on public.traveler_preference_events;
create policy "Roamly service role manages preference events"
on public.traveler_preference_events
for all
to service_role
using (true)
with check (true);
