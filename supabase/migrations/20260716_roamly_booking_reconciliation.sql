-- Companion booking reconciliation stage runs and audit trail.

create table if not exists public.booking_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_booking_id uuid references public.trip_bookings(id) on delete set null,
  status text not null default 'completed',
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  affected_layers text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_reconciliation_runs
  drop constraint if exists booking_reconciliation_runs_status_check,
  add constraint booking_reconciliation_runs_status_check check (status in ('completed', 'needs_confirmation', 'failed'));

create index if not exists booking_reconciliation_runs_trip_idx
  on public.booking_reconciliation_runs (trip_id, created_at desc);

create index if not exists booking_reconciliation_runs_user_idx
  on public.booking_reconciliation_runs (user_id, created_at desc);

create index if not exists booking_reconciliation_runs_source_booking_idx
  on public.booking_reconciliation_runs (source_booking_id);

drop trigger if exists booking_reconciliation_runs_updated_at on public.booking_reconciliation_runs;
create trigger booking_reconciliation_runs_updated_at
before update on public.booking_reconciliation_runs
for each row execute function public.roamly_set_updated_at();

alter table public.booking_reconciliation_runs enable row level security;

drop policy if exists "Roamly users read own booking reconciliation runs" on public.booking_reconciliation_runs;
create policy "Roamly users read own booking reconciliation runs"
on public.booking_reconciliation_runs
for select
using (user_id = auth.uid());
