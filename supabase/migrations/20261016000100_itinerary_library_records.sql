-- Roamly Itinerary Ingester: library records for made itineraries.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule).
--
-- Design notes (Junel, 2026-10-16 — the Ingester bot):
-- * itinerary_library_records: one row per made itinerary the ingester
--   accepts, from three intakes: 'generated' (plans Roamly's own generator
--   makes), 'shared' (/trips/share submissions), 'owner_submitted'
--   (completed itineraries the owner submits by hand).
-- * Consent: consent_anonymized_reuse defaults FALSE. Records stored without
--   consent are private-only (pattern_eligible stays false) — they can teach
--   the library nothing.
-- * Booking proof: booking_proven is true ONLY on the share flow's
--   Gmail-segment proof. It is never inferred.
-- * No feedback loop: generated plans can never be pattern_eligible. A plan
--   Roamly suggested is not evidence that it worked — patterns must come
--   from booking-proven, consenting, traveler-rated trips.
-- * Dedupe: near-identical itineraries collapse to one effective record;
--   the duplicate is stored with duplicate_of pointing at the canonical row
--   (audit trail), never pattern-eligible.
-- * Prices: price_snapshots are carried through byte-identical. The ingester
--   never rewrites an amount, currency, or provenance.
-- * The ingester code treats this table as optional: until this migration is
--   applied, ingestion returns library_storage_unavailable and never throws
--   into the generator or the share flow.

create extension if not exists pgcrypto;

create table if not exists public.itinerary_library_records (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('generated', 'shared', 'owner_submitted')),
  external_ref text,
  user_id uuid references auth.users(id) on delete set null,
  destination_key text not null,
  destination text,
  destination_city text,
  destination_country text,
  start_date date,
  end_date date,
  duration_days integer,
  budget_band text,
  budget_amount numeric,
  budget_currency text,
  travelers_count integer,
  travel_style text,
  pace text,
  season_quarter text,
  travel_month text,
  party_type text,
  style_tags text[] not null default '{}',
  day_items jsonb not null default '[]'::jsonb,
  price_snapshots jsonb not null default '[]'::jsonb,
  highlights text,
  consent_anonymized_reuse boolean not null default false,
  booking_proven boolean not null default false,
  avg_item_rating numeric,
  item_count integer not null default 0,
  pattern_eligible boolean not null default false,
  duplicate_of uuid references public.itinerary_library_records(id) on delete set null,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_library_records_destination_check check (char_length(destination_key) between 1 and 200)
);

create index if not exists itinerary_library_records_dedupe_idx
  on public.itinerary_library_records (destination_key, budget_band, created_at);
create index if not exists itinerary_library_records_eligible_idx
  on public.itinerary_library_records (pattern_eligible, created_at)
  where pattern_eligible = true;
create index if not exists itinerary_library_records_user_idx
  on public.itinerary_library_records (user_id, created_at desc);

drop trigger if exists itinerary_library_records_updated_at on public.itinerary_library_records;
create trigger itinerary_library_records_updated_at
before update on public.itinerary_library_records
for each row execute function public.roamly_set_updated_at();

alter table public.itinerary_library_records enable row level security;

drop policy if exists "Roamly users read own library records" on public.itinerary_library_records;
create policy "Roamly users read own library records"
  on public.itinerary_library_records for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Roamly users create own library records" on public.itinerary_library_records;
create policy "Roamly users create own library records"
  on public.itinerary_library_records for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Roamly service role manages library records" on public.itinerary_library_records;
create policy "Roamly service role manages library records"
  on public.itinerary_library_records for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on table public.itinerary_library_records to service_role;
