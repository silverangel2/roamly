create table if not exists public.roamly_background_health (
  system_key text primary key,
  monitoring_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.roamly_background_health enable row level security;

revoke all on table public.roamly_background_health from public, anon, authenticated;
grant all privileges on table public.roamly_background_health to service_role;

insert into public.roamly_background_health (system_key, monitoring_started_at)
select 'booking_monitor', coalesce(min(started_at), now())
from public.roamly_booking_monitor_runs
on conflict (system_key) do nothing;
