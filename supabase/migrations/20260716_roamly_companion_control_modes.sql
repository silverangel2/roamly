-- Traveler control over Roamly Companion itinerary repairs.

create table if not exists public.roamly_companion_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,

  control_mode text not null default 'suggest_changes',

  allow_free_schedule_changes boolean not null default false,
  allow_optional_activity_changes boolean not null default false,
  allow_meal_changes boolean not null default false,
  allow_route_time_updates boolean not null default false,

  max_automatic_cost_change numeric not null default 0,
  currency text,

  daily_briefing_enabled boolean not null default true,
  important_travel_alerts_enabled boolean not null default true,
  booking_notifications_enabled boolean not null default true,
  check_in_reminders_enabled boolean not null default true,
  marketing_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_companion_preferences
  drop constraint if exists roamly_companion_preferences_control_mode_check;

alter table public.roamly_companion_preferences
  add constraint roamly_companion_preferences_control_mode_check
  check (
    control_mode in (
      'suggest_changes',
      'fix_simple_changes',
      'fix_within_rules'
    )
  );

create unique index if not exists roamly_companion_preferences_user_trip_uidx
  on public.roamly_companion_preferences (
    user_id,
    coalesce(trip_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists roamly_companion_preferences_trip_idx
  on public.roamly_companion_preferences (trip_id);

drop trigger if exists roamly_companion_preferences_updated_at
  on public.roamly_companion_preferences;

create trigger roamly_companion_preferences_updated_at
before update on public.roamly_companion_preferences
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_companion_preferences enable row level security;

drop policy if exists "Roamly users read own companion preferences"
  on public.roamly_companion_preferences;

create policy "Roamly users read own companion preferences"
on public.roamly_companion_preferences
for select
using (user_id = auth.uid());

drop policy if exists "Roamly users create own companion preferences"
  on public.roamly_companion_preferences;

create policy "Roamly users create own companion preferences"
on public.roamly_companion_preferences
for insert
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own companion preferences"
  on public.roamly_companion_preferences;

create policy "Roamly users update own companion preferences"
on public.roamly_companion_preferences
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users delete own companion preferences"
  on public.roamly_companion_preferences;

create policy "Roamly users delete own companion preferences"
on public.roamly_companion_preferences
for delete
using (user_id = auth.uid());
