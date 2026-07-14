-- Companion change-event engine.

create table if not exists public.booking_change_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.roamly_bookings(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  old_value_json jsonb not null default '{}'::jsonb,
  new_value_json jsonb not null default '{}'::jsonb,
  source text not null,
  detected_at timestamptz not null default now(),
  effective_at timestamptz,
  severity text not null default 'minor',
  event_fingerprint text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.companion_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_booking_id uuid references public.roamly_bookings(id) on delete set null,
  event_type text not null,
  severity text not null default 'minor',
  status text not null default 'new',
  title text not null,
  summary text not null,
  affected_layers text[] not null default '{}'::text[],
  requires_user_approval boolean not null default false,
  event_fingerprint text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_change_events
  drop constraint if exists booking_change_events_severity_check,
  add constraint booking_change_events_severity_check check (severity in ('minor', 'routine', 'important', 'critical'));

alter table public.companion_events
  drop constraint if exists companion_events_severity_check,
  drop constraint if exists companion_events_status_check,
  add constraint companion_events_severity_check check (severity in ('minor', 'routine', 'important', 'critical')),
  add constraint companion_events_status_check check (status in ('new', 'processing', 'proposed', 'applied', 'dismissed', 'resolved', 'suppressed'));

create unique index if not exists booking_change_events_fingerprint_uidx
  on public.booking_change_events (user_id, event_fingerprint);

create unique index if not exists companion_events_fingerprint_uidx
  on public.companion_events (user_id, event_fingerprint);

create index if not exists booking_change_events_trip_idx
  on public.booking_change_events (trip_id, detected_at desc);

create index if not exists companion_events_trip_status_idx
  on public.companion_events (trip_id, status, detected_at desc);

drop trigger if exists companion_events_updated_at on public.companion_events;
create trigger companion_events_updated_at
before update on public.companion_events
for each row execute function public.roamly_set_updated_at();

alter table public.booking_change_events enable row level security;
alter table public.companion_events enable row level security;

drop policy if exists "Roamly users read own booking change events" on public.booking_change_events;
create policy "Roamly users read own booking change events"
on public.booking_change_events
for select
using (user_id = auth.uid());

drop policy if exists "Roamly users read own companion events" on public.companion_events;
create policy "Roamly users read own companion events"
on public.companion_events
for select
using (user_id = auth.uid());
