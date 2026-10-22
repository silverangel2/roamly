-- Roamly production wiring, Phase 10 (M9): per-trip library index for
-- outstanding, verified as-lived trips.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule). NOT executed by the Phase 10 build;
-- it lands with the Phase 10 release, in order, with read-back verification.
-- PREREQUISITE: the frontdoor pair (20261015_roamly_fyi_upsell_moments.sql,
-- then 20261015000100_roamly_itinerary_library_frontdoor.sql) is reconciled
-- in FRONTDOOR-APPLICATION-CHECKLIST.md; this file does not depend on those
-- tables, but the library lanes are designed to be read together.
--
-- Design: DESIGN-PRODUCTION.md Phase 10 + §6 (M9), contradiction C5 —
-- the shadow ingest embedded the full as-lived itinerary inside the
-- library record. Production MINIMIZES it (PORTABILITY §6): this table
-- stores the owner INDEX (place, hotel + stars, flights, weather, honest
-- known-subtotal price, rating) plus pattern links POINTING AT the
-- archived trip record. There is deliberately NO itinerary-document
-- column here — no day-by-day plan, no schedule, no full_json copy.
-- The purchased itinerary itself stays in roamly_trips /
-- roamly_itineraries, transitioned to archived by Phase 11.
--
-- FK discipline (Phase 0 FK audit + the 2026-10-21 19:39 owner ruling):
-- trip_id references roamly_trips with ON DELETE RESTRICT. The ruling is
-- archive-never-delete, so the restrict can never fire on the governed
-- path; if anything ever tries to hard-delete an ingested trip, the
-- delete fails loudly instead of silently orphaning the library record
-- (SET NULL would erase the link; CASCADE would destroy the record —
-- both violate the ruling). One ingest per trip: unique(trip_id), and
-- the ingest write is an upsert on that key, so a re-run is idempotent.
--
-- Price honesty: price_known_subtotal is the sum of KNOWN booked prices
-- only; unknown prices are listed in price_unknown_items and are never
-- converted to zero. price_is_complete is false whenever any priced
-- item of the trip stayed unknown.
--
-- RLS: enabled, explicit Data API grants appended in-file per
-- DATA-INFRA §8 (post-Oct-30-2026 grant rules): the traveler reads
-- their own row; the service role manages rows (the ingest runs
-- server-side only).

create table if not exists public.roamly_library_trips (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  destination text not null,
  destination_city text,
  destination_country text,
  destination_key text not null,
  start_date date,
  end_date date,
  hotel_name text,
  hotel_stars integer check (hotel_stars is null or (hotel_stars >= 1 and hotel_stars <= 5)),
  hotel_check_in_actual text,
  hotel_check_out_actual text,
  flights jsonb not null default '[]'::jsonb,
  weather jsonb not null default '[]'::jsonb,
  price_known_subtotal numeric,
  price_currency text not null default 'CAD',
  price_unknown_items text[] not null default '{}',
  price_is_complete boolean not null default false,
  overall_rating numeric check (overall_rating is null or (overall_rating >= 1 and overall_rating <= 5)),
  rating_scale integer not null default 5,
  verified_checkin_count integer not null default 0,
  budget_band text,
  item_verdicts jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_library_trips_one_per_trip unique (trip_id),
  constraint roamly_library_trips_destination_check check (char_length(destination) between 1 and 200)
);

create index if not exists roamly_library_trips_destination_idx
  on public.roamly_library_trips (destination_key, ingested_at desc);
create index if not exists roamly_library_trips_user_idx
  on public.roamly_library_trips (user_id, ingested_at desc);

drop trigger if exists roamly_library_trips_updated_at on public.roamly_library_trips;
create trigger roamly_library_trips_updated_at
before update on public.roamly_library_trips
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_library_trips enable row level security;

drop policy if exists "Roamly users read own library trips" on public.roamly_library_trips;
create policy "Roamly users read own library trips"
on public.roamly_library_trips for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages library trips" on public.roamly_library_trips;
create policy "Roamly service role manages library trips"
on public.roamly_library_trips for all to service_role
using (true) with check (true);

grant select, insert, update, delete on table public.roamly_library_trips to service_role;
grant select on table public.roamly_library_trips to authenticated;
