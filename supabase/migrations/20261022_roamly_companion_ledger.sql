-- Roamly production wiring, Phase 7 (M2): the append-only Live
-- Companion interaction ledger (DESIGN-PRODUCTION.md §6 M2,
-- contradiction C6: today's activity statuses are destructive
-- overwrites — this table is the additive trail behind them).
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by
-- the Phase 7 build.
--
-- One row per lived interaction: DIRECTIONS_VIEWED / CHECKED_IN /
-- SKIPPED / MISSED, each with its trip-local minute, dwell (derived
-- consumers compute it; a stored close-out value is allowed), and
-- field provenance. STALE / EXPIRED are deliberately never written
-- by the live path — they are derived view state
-- (lib/roamly/companionPanel.ts evaluateItemLifecycle); the
-- classifications exist in the CHECK for the Phase 10 as-lived
-- snapshot.
--
-- Append-only is enforced three ways:
--   1. entry_id is the Phase 1 content ID (trip, activity,
--      classification, minute) and UNIQUE — re-appending the same
--      action (offline re-flush, double tap) is a no-op.
--   2. Grants are SELECT + INSERT only, for every role. No UPDATE
--      or DELETE grant exists on this table.
--   3. A trigger refuses UPDATE outright, and refuses DELETE
--      unless the transaction sets roamly.allow_purge = 'on' —
--      the Phase 11 purge job is the one legitimate deleter, and it
--      must say so explicitly, in its transaction.
-- Undo is a NEW row carrying the undone row's classification with
-- undo_of_entry_id pointing at it (the Phase 1 vocabulary has no
-- UNDO classification); readers annul the target. History is never
-- erased by an Undo.
--
-- RLS differs from M1's service-role-only shape on purpose: gate
-- records are evidence ABOUT the traveler (server-managed), while
-- ledger rows are the traveler's OWN action record — the panel's
-- session client writes and reads its owner's rows, mirroring the
-- sibling roamly_trip_companion_events access pattern. The service
-- role keeps full read/insert for server-side writers.

create extension if not exists pgcrypto;

create table if not exists public.roamly_companion_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  activity_ref text not null,
  classification text not null
    check (classification in (
      'DIRECTIONS_VIEWED', 'CHECKED_IN', 'SKIPPED', 'MISSED', 'STALE', 'EXPIRED'
    )),
  at timestamptz not null,
  at_minute_of_trip integer not null check (at_minute_of_trip >= 0),
  dwell_minutes integer check (dwell_minutes is null or dwell_minutes >= 0),
  undo_of_entry_id text,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_companion_ledger_entry_unique unique (entry_id),
  constraint roamly_companion_ledger_activity_check check (char_length(activity_ref) between 1 and 300)
);

create index if not exists roamly_companion_ledger_trip_idx
  on public.roamly_companion_ledger (trip_id, at_minute_of_trip, at);
create index if not exists roamly_companion_ledger_user_idx
  on public.roamly_companion_ledger (user_id, created_at desc);

-- Append-only guard: UPDATE is refused for every role; DELETE is
-- refused unless the deleting transaction declares the purge.
create or replace function public.roamly_companion_ledger_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'roamly_companion_ledger is append-only: UPDATE is refused (corrections are new rows)';
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('roamly.allow_purge', true), '') <> 'on' then
    raise exception 'roamly_companion_ledger is append-only: DELETE requires the Phase 11 purge (SET LOCAL roamly.allow_purge = ''on'')';
  end if;
  return old;
end;
$$;

drop trigger if exists roamly_companion_ledger_append_only on public.roamly_companion_ledger;
create trigger roamly_companion_ledger_append_only
before update or delete on public.roamly_companion_ledger
for each row execute function public.roamly_companion_ledger_append_only();

-- ---------------------------------------------------------------------
-- RLS + Data API grants (DATA-INFRA §8: explicit grants in-file).
-- SELECT + INSERT only — append-only at the grant layer too.
-- ---------------------------------------------------------------------
alter table public.roamly_companion_ledger enable row level security;

drop policy if exists "Roamly service role manages companion ledger" on public.roamly_companion_ledger;
create policy "Roamly service role manages companion ledger"
  on public.roamly_companion_ledger for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Travelers read their own companion ledger" on public.roamly_companion_ledger;
create policy "Travelers read their own companion ledger"
  on public.roamly_companion_ledger for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Travelers append their own companion ledger" on public.roamly_companion_ledger;
create policy "Travelers append their own companion ledger"
  on public.roamly_companion_ledger for insert
  to authenticated
  with check (user_id = auth.uid());

grant select, insert on table public.roamly_companion_ledger to service_role;
grant select, insert on table public.roamly_companion_ledger to authenticated;
