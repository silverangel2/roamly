-- Roamly production wiring, Phase 7 (companion to M2/M3): the
-- durable Sophie escalation outbox (DESIGN-PRODUCTION.md §4 Phase 7:
-- "durable Sophie escalation outbox (replaces sophie.mjs's
-- module-global array — durable IDs, user/trip ownership, status;
-- consumption activates in the Sophie phase, §9)").
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by
-- the Phase 7 build.
--
-- DORMANT by design: rows are filed 'queued' and wait. There is no
-- consumer, no sender, and no notification attached to this table
-- in this phase — Sophie's consumption seam (status transitions to
-- 'consumed' / 'dismissed') activates only when she is live on the
-- Dell (§9). outbox_id is the content ID of the escalation, UNIQUE,
-- so re-filing the same escalation dedupes instead of piling up.
--
-- trip_id is ON DELETE SET NULL: an escalation record may outlive
-- the trip it concerns (the Phase 11 purge set does not include
-- this table — it is operations data, not a traveler surface), and
-- losing the row to a trip delete would erase the very edge cases
-- the outbox exists to teach from.

create extension if not exists pgcrypto;

create table if not exists public.roamly_sophie_outbox (
  id uuid primary key default gen_random_uuid(),
  outbox_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete set null,
  kind text not null
    check (kind in ('unresolved-understanding', 'impact-weighing', 'proposal-review')),
  summary text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'consumed', 'dismissed')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint roamly_sophie_outbox_id_unique unique (outbox_id),
  constraint roamly_sophie_outbox_summary_check check (char_length(summary) between 1 and 2000)
);

create index if not exists roamly_sophie_outbox_queue_idx
  on public.roamly_sophie_outbox (status, created_at);
create index if not exists roamly_sophie_outbox_user_idx
  on public.roamly_sophie_outbox (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- RLS + Data API grants (DATA-INFRA §8: explicit grants in-file).
-- Operations data: service role only, like M1. Status UPDATE is
-- granted to the service role because the consumption seam IS a
-- status transition — this table is a queue, not a ledger.
-- ---------------------------------------------------------------------
alter table public.roamly_sophie_outbox enable row level security;

drop policy if exists "Roamly service role manages sophie outbox" on public.roamly_sophie_outbox;
create policy "Roamly service role manages sophie outbox"
  on public.roamly_sophie_outbox for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update on table public.roamly_sophie_outbox to service_role;
