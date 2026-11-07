-- =====================================================================
-- GAP-CLOSURE WAVE 2, TASK 5a (2026-11-02) — generation state out of
-- trip metadata. This migration is part of the post-Nov-5 diet package
-- and is NOT YET APPLIED. It is a LOCAL release-candidate artifact on
-- production HOLD: it must be reviewed and applied by the owner
-- through the normal migration process, BEFORE the code release that
-- ships the dual-write + state-first reads (see the ship-sequence
-- note in harness/GAP-C-CHANGELOG.md). No agent applies it. All code
-- in the package is written to fail soft while this table does not
-- exist yet (dual-write helper swallows errors; state-first reads
-- fall back to trip metadata), so even code-before-migration is safe.
--
-- Why: the staged generation state document (outline, per-day batch
-- states, stage runs, AI usage, email markers, worker lease) lives
-- inside roamly_trips.metadata (jsonb) today. Every status / queue-
-- progress read that touches the trip row drags the state document
-- with it (~8 KB of the ~9.5 KB pre-diet status poll payload), the
-- state is the single most-written document in the system (persisted
-- at every stage boundary) embedded in the trips table's hottest
-- row, and the KF-2 recovery sweep must read metadata for every
-- candidate trip it evaluates.
--
-- Extraction shape (verified against the code, not guessed):
-- getStagedGenerationState (lib/roamly/stagedItineraryGeneration.ts)
-- reads the state document from metadata -> 'generation', and
-- generationMetadata writes it there as `generation: state` — the
-- state object itself, whose own fields are camelCase: status at
-- ->> 'status', updatedAt at ->> 'updatedAt'. The backfill below
-- copies exactly that shape.
-- =====================================================================

create table if not exists public.roamly_trip_generation_states (
  trip_id uuid primary key references public.roamly_trips(id) on delete cascade,
  user_id uuid not null,
  state jsonb not null,
  status text not null,
  updated_at timestamptz not null default now()
);

-- Stranded-state scans (KF-2 recovery) find stale non-terminal states
-- without touching trip metadata at all.
create index if not exists roamly_trip_generation_states_status_updated_idx
  on public.roamly_trip_generation_states (status, updated_at);

alter table public.roamly_trip_generation_states enable row level security;

-- Service-role only, matching the other internal generation tables:
-- no policies for anon/authenticated are created on purpose. All
-- reads/writes go through the service-role admin client (the
-- generation status route reads its row through the admin client,
-- scoped to the authenticated traveler's own trip id + user id).

-- Backfill (inlined, runs once with the migration): every trip whose
-- metadata already carries a generation state gets a row, so
-- in-flight trips are visible to the new state-first reads the moment
-- the migration lands. ON CONFLICT DO NOTHING: a row the dual-write
-- code already wrote always wins over the metadata snapshot.
insert into public.roamly_trip_generation_states (trip_id, user_id, state, status, updated_at)
select t.id,
       t.user_id,
       t.metadata -> 'generation',
       coalesce(t.metadata -> 'generation' ->> 'status', 'unknown'),
       coalesce((t.metadata -> 'generation' ->> 'updatedAt')::timestamptz, now())
  from public.roamly_trips t
 where t.metadata ? 'generation'
on conflict (trip_id) do nothing;
