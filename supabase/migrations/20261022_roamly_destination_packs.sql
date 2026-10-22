-- Roamly production wiring, Phase 3 (M7): the destination pack data plane.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule). NOT executed by the Phase 3 build;
-- it is applied in a later phase, in order, with read-back verification.
--
-- Design: DESIGN-PRODUCTION.md §2.2 + §6 (M7) and PORTABILITY §3 / C9 —
-- the pack store is VERSIONED DATABASE SNAPSHOTS, split into layers:
--
--   roamly_destination_pack_builds      the build queue + single-flight
--                                       leases (one live job per
--                                       destination, enforced by a
--                                       unique partial index below).
--   roamly_destination_packs            one row per pack VERSION.
--                                       Versions are immutable once
--                                       published: a rebuild inserts a
--                                       NEW version and flips the old
--                                       one's status to 'superseded' —
--                                       the only update a published
--                                       version ever receives. A
--                                       generation pins a version by
--                                       its pack_version_id (recorded
--                                       on the generation job in
--                                       Phase 5), so a finished trip
--                                       stays reproducible from its
--                                       pinned pack forever.
--   roamly_destination_candidates       the version's normalized
--                                       candidate rows. Google
--                                       enrichment rides as a separate
--                                       jsonb record ON the candidate
--                                       (written by Phase 4), never as
--                                       a mutation of the POI fields.
--   roamly_destination_weather_snapshots  the SEPARATE weather layer,
--                                       keyed by destination + date
--                                       range + provider + kind
--                                       (forecast vs historical are
--                                       different artifacts and never
--                                       substitute). Weather is never
--                                       baked into a POI pack version.
--
-- Identity: destinations are registry IDs (content IDs minted by
-- lib/roamly/engine/packs/destinations.ts), carried as text — the
-- registry itself is application state, so there is deliberately no
-- registry table and no FK on destination_id. pack_version_id /
-- job_id / snapshot_id are the content IDs the TS layer mints
-- (lib/roamly/engine/ids.ts); the uuid `id` columns are row identity.
--
-- FK discipline (Phase 0 FK map): children of an aggregate CASCADE
-- (candidates die with their version); cross-references that must
-- survive their target are SET NULL (a build's result pointer). No
-- FK points at roamly_trips or auth.users from this migration: packs
-- are system data, and nothing here may cascade from a trip delete
-- or block one (the Phase 11 purge audit stays clean).
--
-- Store-method mapping (PackStore, lib/roamly/engine/packs/store.ts):
-- the claim is ONE conditional UPDATE ... WHERE status='queued' OR
-- (status='building' AND lease_expires_at <= now()) RETURNING *,
-- rotating lease_id and incrementing lease_epoch (the PR #60
-- lease/CAS discipline); publish is one transaction that writes the
-- candidate rows, flips the new version to 'ready', flips the
-- previous 'ready' version to 'superseded', and completes the job
-- — guarded by the job's current lease_id, so a stolen lease's
-- publish matches zero rows and is refused.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Build queue + leases
-- ---------------------------------------------------------------------
create table if not exists public.roamly_destination_pack_builds (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  destination_id text not null,
  destination_name text,
  reason text not null,
  status text not null default 'queued'
    check (status in ('queued', 'building', 'done', 'failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_worker_id text,
  lease_id text,
  lease_epoch integer,
  lease_expires_at timestamptz,
  coalesced_requests integer not null default 1,
  result_pack_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_destination_pack_builds_destination_check
    check (char_length(destination_id) between 1 and 200)
);

-- Single-flight, enforced by the database itself: at most one live
-- (queued or building) job per destination. Concurrent build
-- requests coalesce in the service layer; if two race past it, the
-- second insert fails instead of starting a second build.
create unique index if not exists roamly_destination_pack_builds_live_idx
  on public.roamly_destination_pack_builds (destination_id)
  where status in ('queued', 'building');
create index if not exists roamly_destination_pack_builds_queue_idx
  on public.roamly_destination_pack_builds (status, requested_at);

-- ---------------------------------------------------------------------
-- Pack versions
-- ---------------------------------------------------------------------
create table if not exists public.roamly_destination_packs (
  id uuid primary key default gen_random_uuid(),
  pack_version_id text not null unique,
  destination_id text not null,
  destination_name text,
  version integer not null,
  schema_version integer not null,
  classifier_version text not null,
  status text not null default 'building'
    check (status in ('building', 'ready', 'failed', 'superseded')),
  built_at timestamptz,
  candidate_count integer not null default 0,
  counts_by_kind jsonb not null default '{}'::jsonb,
  content_hash text,
  supersedes_pack_version_id text,
  build_job_id text,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_destination_packs_version_unique
    unique (destination_id, version),
  constraint roamly_destination_packs_destination_check
    check (char_length(destination_id) between 1 and 200)
);

create index if not exists roamly_destination_packs_serving_idx
  on public.roamly_destination_packs (destination_id, status, version desc);

-- A build's result pointer survives the pack row it names being
-- removed (versions are retained for pin reproducibility; this is
-- belt-and-braces, in the FK map's SET NULL pattern).
alter table public.roamly_destination_pack_builds
  drop constraint if exists roamly_destination_pack_builds_result_pack_fk;
alter table public.roamly_destination_pack_builds
  add constraint roamly_destination_pack_builds_result_pack_fk
  foreign key (result_pack_id) references public.roamly_destination_packs(id) on delete set null;

-- ---------------------------------------------------------------------
-- Normalized candidate rows (children of a version: CASCADE)
-- ---------------------------------------------------------------------
create table if not exists public.roamly_destination_candidates (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.roamly_destination_packs(id) on delete cascade,
  candidate_key text not null,
  osm_key text not null,
  kind text not null,
  name text not null,
  name_en text,
  lat double precision,
  lon double precision,
  hours_raw text,
  tags jsonb not null default '{}'::jsonb,
  url text,
  enrichment jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_destination_candidates_key_unique unique (pack_id, candidate_key)
);

create index if not exists roamly_destination_candidates_pack_kind_idx
  on public.roamly_destination_candidates (pack_id, kind);

-- ---------------------------------------------------------------------
-- Weather snapshots (separate layer; no FK — keyed by registry ID,
-- and a snapshot must survive pack-version churn untouched)
-- ---------------------------------------------------------------------
create table if not exists public.roamly_destination_weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_id text not null unique,
  destination_id text not null,
  provider text not null,
  kind text not null check (kind in ('forecast', 'historical')),
  start_date date not null,
  end_date date not null,
  fetched_at timestamptz not null,
  days jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_destination_weather_range_check check (end_date >= start_date),
  constraint roamly_destination_weather_fetch_unique
    unique (destination_id, provider, kind, start_date, end_date, fetched_at)
);

create index if not exists roamly_destination_weather_lookup_idx
  on public.roamly_destination_weather_snapshots (destination_id, kind, start_date, end_date, fetched_at desc);

-- ---------------------------------------------------------------------
-- updated_at maintenance (queue rows mutate; versions/candidates/
-- snapshots are append-only by design and carry no updated_at)
-- ---------------------------------------------------------------------
drop trigger if exists roamly_destination_pack_builds_updated_at on public.roamly_destination_pack_builds;
create trigger roamly_destination_pack_builds_updated_at
before update on public.roamly_destination_pack_builds
for each row execute function public.roamly_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS + Data API grants (DATA-INFRA §8: new public tables get no
-- automatic grants after Supabase's Oct-30-2026 change — every grant
-- is explicit and appended in-file, consistent with sibling tables).
-- Packs are system data: only the service role reads or writes them.
-- Travelers never query packs directly; generation reads server-side.
-- ---------------------------------------------------------------------
alter table public.roamly_destination_pack_builds enable row level security;
alter table public.roamly_destination_packs enable row level security;
alter table public.roamly_destination_candidates enable row level security;
alter table public.roamly_destination_weather_snapshots enable row level security;

drop policy if exists "Roamly service role manages pack builds" on public.roamly_destination_pack_builds;
create policy "Roamly service role manages pack builds"
  on public.roamly_destination_pack_builds for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Roamly service role manages destination packs" on public.roamly_destination_packs;
create policy "Roamly service role manages destination packs"
  on public.roamly_destination_packs for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Roamly service role manages destination candidates" on public.roamly_destination_candidates;
create policy "Roamly service role manages destination candidates"
  on public.roamly_destination_candidates for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Roamly service role manages destination weather" on public.roamly_destination_weather_snapshots;
create policy "Roamly service role manages destination weather"
  on public.roamly_destination_weather_snapshots for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on table public.roamly_destination_pack_builds to service_role;
grant select, insert, update, delete on table public.roamly_destination_packs to service_role;
grant select, insert, update, delete on table public.roamly_destination_candidates to service_role;
grant select, insert, update, delete on table public.roamly_destination_weather_snapshots to service_role;
