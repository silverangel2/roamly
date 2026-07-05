-- Roamly remaining live companion controls, admin test mode, and affiliate readiness.
-- Safe for shared Supabase projects because only roamly_ tables are touched.

alter table public.roamly_trip_activities add column if not exists checked_in_at timestamptz;
alter table public.roamly_trip_activities add column if not exists completed_at timestamptz;
alter table public.roamly_trip_activities add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.roamly_activities add column if not exists checked_in_at timestamptz;
alter table public.roamly_activities add column if not exists completed_at timestamptz;

alter table public.roamly_notifications add column if not exists sent_at timestamptz;
alter table public.roamly_notifications add column if not exists push_status text;
alter table public.roamly_notifications add column if not exists push_error text;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.roamly_trip_activities'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.roamly_trip_activities drop constraint if exists %I', constraint_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.roamly_trip_activities'::regclass
      and conname = 'roamly_trip_activities_status_live_check'
  ) then
    alter table public.roamly_trip_activities
      add constraint roamly_trip_activities_status_live_check
      check (status in ('planned', 'active', 'nearby', 'checked_in', 'completed', 'skipped', 'missed'));
  end if;
end $$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.roamly_activities'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.roamly_activities drop constraint if exists %I', constraint_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.roamly_activities'::regclass
      and conname = 'roamly_activities_status_live_check'
  ) then
    alter table public.roamly_activities
      add constraint roamly_activities_status_live_check
      check (status in ('planned', 'nearby', 'checked_in', 'completed', 'skipped', 'missed'));
  end if;
end $$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.roamly_trip_companion_events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%event_type%'
  loop
    execute format('alter table public.roamly_trip_companion_events drop constraint if exists %I', constraint_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.roamly_trip_companion_events'::regclass
      and conname = 'roamly_trip_companion_events_type_live_check'
  ) then
    alter table public.roamly_trip_companion_events
      add constraint roamly_trip_companion_events_type_live_check
      check (event_type in (
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
      ));
  end if;
end $$;

create index if not exists roamly_trip_activities_status_idx on public.roamly_trip_activities (trip_id, status);
create index if not exists roamly_activities_live_status_idx on public.roamly_activities (trip_id, status, sort_order);
create index if not exists roamly_notifications_push_status_idx on public.roamly_notifications (push_status, created_at desc);
create index if not exists roamly_notifications_sent_at_idx on public.roamly_notifications (sent_at desc);
