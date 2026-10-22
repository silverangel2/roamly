-- Roamly production wiring, Phase 11 (M4): the persisted trip
-- lifecycle — state, history, review window, archive transition
-- record, and the tombstone pointer (DESIGN-PRODUCTION.md §6 M4,
-- Phase 11; contradiction C2's companion piece).
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by
-- the Phase 11 build; it lands with the Phase 11 release, in order,
-- with read-back verification.
--
-- One row per trip, created when the lifecycle machine first sees
-- the trip and RETAINED FOREVER: after the Phase 11 purge deletes
-- the trip's live copies, this row is the tombstone — late events,
-- retries, shared links, and sync messages check it and cannot
-- resurrect a purged trip, and on the traveler's next app launch
-- the client reads it (own-row SELECT below) to clear the trip's
-- on-device caches, acknowledged back into
-- tombstone_acknowledged_at.
--
-- FK discipline (Phase 0 FK audit + the 2026-10-21 19:39 owner
-- ruling — purge the panel and live copies; archive the purchased
-- itinerary in the account): trip_id references roamly_trips with
-- ON DELETE RESTRICT. The governed path never hard-deletes a trip
-- (it archives: roamly_trips.status already carries 'archived' in
-- its base CHECK), so the restrict can never fire on it; if anything
-- ever tries, the delete fails loudly instead of orphaning the
-- tombstone — the same posture as M9's library link.
--
-- history is an append-only JSONB event list (transitions, review
-- markers, ingest decisions — their durable home per the Phase 10
-- report — purge refusals, and escalations). It records STATE, never
-- trip content: no place names, no item data, no traveler text.
--
-- This file also carries the two database helpers the purge
-- executor depends on:
--   * roamly_fk_delete_action(text, text) — the read-only catalog
--     lookup behind the executor's FK precondition gate (the purge
--     verifies the live FK expectations it depends on and refuses,
--     rather than improvising, when the schema has drifted).
--   * roamly_purge_companion_ledger(uuid) — the ONLY sanctioned
--     delete path for the M2 append-only ledger: it declares the
--     purge inside its own transaction (SET LOCAL
--     roamly.allow_purge = 'on'), which is exactly what the M2
--     trigger demands, then deletes the trip's ledger rows and
--     returns their count.

create extension if not exists pgcrypto;

create table if not exists public.roamly_trip_lifecycle (
  trip_id uuid primary key references public.roamly_trips (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'TRIP_ENDED', 'POST_TRIP_PENDING', 'CLOSED', 'PURGED')),
  trip_timezone text not null default 'UTC',
  trip_start_date date not null,
  trip_end_date date not null,
  review_window_days integer not null default 7 check (review_window_days >= 0),
  review_window_ends_at timestamptz,
  ended_at timestamptz,
  review_sent_at timestamptz,
  review_submitted boolean not null default false,
  review_submitted_at timestamptz,
  closed_at timestamptz,
  close_reason text
    check (close_reason is null or close_reason in ('review-submitted', 'review-window-expired')),
  archived_at timestamptz,
  archived_itinerary_ref text,
  purged_at timestamptz,
  -- A VALUE cross-reference to the M5 receipt (its trip_ref hash).
  -- Deliberately NOT a foreign key in either direction: the receipt
  -- must survive independently of every trip-keyed table.
  purge_receipt_ref text,
  tombstone_acknowledged_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_trip_lifecycle_state_idx
  on public.roamly_trip_lifecycle (state, review_window_ends_at);
create index if not exists roamly_trip_lifecycle_user_idx
  on public.roamly_trip_lifecycle (user_id, created_at desc);

drop trigger if exists roamly_trip_lifecycle_updated_at on public.roamly_trip_lifecycle;
create trigger roamly_trip_lifecycle_updated_at
before update on public.roamly_trip_lifecycle
for each row execute function public.roamly_set_updated_at();

-- ---------------------------------------------------------------------
-- FK catalog lookup for the purge precondition gate. Returns the
-- pg_constraint confdeltype character ('a' NO ACTION, 'r' RESTRICT,
-- 'c' CASCADE, 'n' SET NULL, 'd' SET DEFAULT) for a named constraint
-- on a named table in the public schema, or NULL when absent.
-- ---------------------------------------------------------------------
create or replace function public.roamly_fk_delete_action(p_table_name text, p_constraint_name text)
returns text
language sql
stable
as $$
  select c.confdeltype::text
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = p_table_name
    and c.conname = p_constraint_name
    and c.contype = 'f'
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- The one legitimate deleter of the M2 append-only companion
-- ledger. The purge declaration happens inside this function's
-- transaction, so no caller can delete ledger rows without going
-- through the Phase 11 purge path.
-- ---------------------------------------------------------------------
create or replace function public.roamly_purge_companion_ledger(p_trip_id uuid)
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  perform set_config('roamly.allow_purge', 'on', true);
  delete from public.roamly_companion_ledger where trip_id = p_trip_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS + Data API grants (DATA-INFRA §8: explicit grants in-file).
-- The lifecycle machine runs server-side (service role). The
-- traveler reads their OWN row — that read is how the tombstone
-- reaches the client on next launch. No DELETE grant exists for
-- any role: lifecycle rows are tombstones and are never deleted.
-- ---------------------------------------------------------------------
alter table public.roamly_trip_lifecycle enable row level security;

drop policy if exists "Roamly service role manages trip lifecycle" on public.roamly_trip_lifecycle;
create policy "Roamly service role manages trip lifecycle"
  on public.roamly_trip_lifecycle for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Travelers read their own trip lifecycle" on public.roamly_trip_lifecycle;
create policy "Travelers read their own trip lifecycle"
  on public.roamly_trip_lifecycle for select
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update on table public.roamly_trip_lifecycle to service_role;
grant select on table public.roamly_trip_lifecycle to authenticated;
grant execute on function public.roamly_fk_delete_action(text, text) to service_role;
grant execute on function public.roamly_purge_companion_ledger(uuid) to service_role;
