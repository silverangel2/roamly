create table if not exists public.roamly_cron_locks (
  lock_name text primary key,
  locked_until timestamptz not null default now(),
  locked_by text,
  updated_at timestamptz not null default now()
);

alter table public.roamly_cron_locks enable row level security;

create table if not exists public.roamly_booking_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  connections_found integer not null default 0,
  connections_processed integer not null default 0,
  messages_processed integer not null default 0,
  failures integer not null default 0,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.roamly_booking_monitor_runs
  drop constraint if exists roamly_booking_monitor_status_check;

alter table public.roamly_booking_monitor_runs
  add constraint roamly_booking_monitor_status_check
  check (status in ('running', 'completed', 'partial', 'failed', 'skipped'));

alter table public.roamly_booking_monitor_runs enable row level security;

create index if not exists roamly_booking_monitor_runs_started_idx
  on public.roamly_booking_monitor_runs (started_at desc);
