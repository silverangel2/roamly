-- Canonical live-provider snapshots for Roamly Companion.

create table if not exists public.live_provider_status_snapshots (
  id uuid primary key default gen_random_uuid(),

  trip_id uuid references public.roamly_trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  booking_id uuid references public.roamly_bookings(id) on delete set null,

  provider_kind text not null,
  provider text not null,
  source text not null,

  status text not null,
  confidence numeric not null default 0,
  stale_status text not null default 'unknown',

  result_json jsonb not null default '{}'::jsonb,
  errors_json jsonb not null default '[]'::jsonb,

  retrieved_at timestamptz not null default now(),
  effective_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.live_provider_status_snapshots
  drop constraint if exists live_provider_status_snapshots_booking_id_fkey;

alter table public.live_provider_status_snapshots
  add constraint live_provider_status_snapshots_booking_id_fkey
  foreign key (booking_id)
  references public.roamly_bookings(id)
  on delete set null;

alter table public.live_provider_status_snapshots
  drop constraint if exists live_provider_status_kind_check,
  drop constraint if exists live_provider_status_stale_check,
  drop constraint if exists live_provider_status_confidence_check;

alter table public.live_provider_status_snapshots
  add constraint live_provider_status_kind_check
  check (
    provider_kind in (
      'live_flight_status',
      'airport_gate',
      'train_status',
      'local_transit_disruption',
      'weather',
      'traffic',
      'attraction_closure'
    )
  ),
  add constraint live_provider_status_stale_check
  check (
    stale_status in (
      'fresh',
      'stale',
      'unknown',
      'not_applicable'
    )
  ),
  add constraint live_provider_status_confidence_check
  check (confidence >= 0 and confidence <= 1);

create index if not exists live_provider_status_trip_idx
  on public.live_provider_status_snapshots (
    trip_id,
    retrieved_at desc
  );

create index if not exists live_provider_status_booking_idx
  on public.live_provider_status_snapshots (
    booking_id,
    retrieved_at desc
  );

create index if not exists live_provider_status_kind_idx
  on public.live_provider_status_snapshots (
    provider_kind,
    provider,
    retrieved_at desc
  );

alter table public.live_provider_status_snapshots
  enable row level security;

drop policy if exists
  "Roamly users read own live provider snapshots"
  on public.live_provider_status_snapshots;

create policy
  "Roamly users read own live provider snapshots"
on public.live_provider_status_snapshots
for select
using (user_id = auth.uid());
