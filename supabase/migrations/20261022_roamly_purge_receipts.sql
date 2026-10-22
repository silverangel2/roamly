-- Roamly production wiring, Phase 11 (M5): content-free purge
-- receipts (DESIGN-PRODUCTION.md §6 M5, contradiction C2 — MAP's
-- ride-roamly_app_events idea lost: an app-events row cannot
-- guarantee the tombstone/no-cascade semantics, so the receipt
-- gets its own table).
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by
-- the Phase 11 build; it lands with the Phase 11 release, in order,
-- with read-back verification.
--
-- A receipt proves a purge happened — and nothing more. It is
-- content-free BY CONSTRUCTION:
--   * there is NO trip_id column and NO foreign key to any table:
--     the trip is referenced only by trip_ref, the one-way SHA-256
--     hash of its id (the Phase 1 PurgeReceiptDTO's tripRef), so
--     the receipt can never be cascade-deleted by, or joined back
--     to, the trip it proves — it survives the purge it records;
--   * the only other fields are the trip's dates, the purge
--     timestamp, the close reason, the review-window length, the
--     per-scope deletion counts, whether the library retained its
--     index record, and the acting job's name. No place names, no
--     traveler names, no item data — the Phase 1 DTO parser rejects
--     any extra field, and this table has no column to hold one.
--
-- Backup-expiry honesty (design Phase 11): this receipt claims
-- exactly what is provable — the governed ONLINE rows were deleted
-- and verified by re-read. It does not claim backup copies are
-- deleted; backups expire under the backup retention policy.
--
-- Immutability: grants are SELECT + INSERT for the service role
-- only. No UPDATE or DELETE grant exists for any role, and no
-- traveler-facing policy is created — receipts are proof records,
-- not traveler data.

create extension if not exists pgcrypto;

create table if not exists public.roamly_purge_receipts (
  id uuid primary key default gen_random_uuid(),
  trip_ref text not null,
  trip_start_date date not null,
  trip_end_date date not null,
  purged_at timestamptz not null,
  close_reason text not null
    check (close_reason in ('review-submitted', 'review-window-expired')),
  review_window_days integer not null check (review_window_days >= 0),
  deleted_notifications integer not null check (deleted_notifications >= 0),
  deleted_cached_days integer not null check (deleted_cached_days >= 0),
  deleted_ledger_entries integer not null check (deleted_ledger_entries >= 0),
  deleted_itinerary_items integer not null check (deleted_itinerary_items >= 0),
  deleted_live_copies integer not null check (deleted_live_copies >= 0),
  library_retained boolean not null,
  actor text not null,
  created_at timestamptz not null default now(),
  constraint roamly_purge_receipts_one_per_trip unique (trip_ref),
  constraint roamly_purge_receipts_ref_shape check (trip_ref ~ '^[0-9a-f]{64}$')
);

alter table public.roamly_purge_receipts enable row level security;

drop policy if exists "Roamly service role manages purge receipts" on public.roamly_purge_receipts;
create policy "Roamly service role manages purge receipts"
  on public.roamly_purge_receipts for all
  to service_role
  using (true)
  with check (true);

grant select, insert on table public.roamly_purge_receipts to service_role;
