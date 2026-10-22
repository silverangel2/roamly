-- Roamly production wiring, Phase 6 (M6): desktop→phone handoff
-- tokens (DESIGN-PRODUCTION.md §2.4 + §6 M6; owner ruling
-- 2026-10-21 19:15 ADT — the QR code is the move).
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by the
-- Phase 6 build.
--
-- One row per minted pass. ONLY the token's SHA-256 hash is stored —
-- the plaintext token exists solely in the QR code / emailed link the
-- traveler holds (service: lib/roamly/handoffTokens.ts). The token is
-- bound to (user, trip), expires 10 minutes after minting, and burns
-- on first redemption: redemption is ONE conditional UPDATE that
-- matches only an unused, unexpired row, so a second redemption —
-- racing or late — matches zero rows and the pass stays burned.
--
-- FK discipline (Phase 0 FK map): the token is a child of the trip,
-- so trip_id CASCADEs like Roamly's other trip children (the Phase 11
-- archive ruling keeps the trip row, so the purge path never fires
-- this cascade). user_id carries no FK (M7 precedent — nothing here
-- may cascade from an account operation). Expired/used rows are
-- inert history; a later cleanup may delete rows past expiry without
-- affecting any live pass.

create extension if not exists pgcrypto;

create table if not exists public.roamly_handoff_tokens (
  id uuid primary key default gen_random_uuid(),
  token_id text not null unique,
  user_id uuid not null,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint roamly_handoff_tokens_hash_check check (char_length(token_hash) = 64),
  constraint roamly_handoff_tokens_expiry_check check (expires_at > created_at)
);

-- Live-pass lookup: redemption finds the row by hash; the partial
-- index keeps unburned passes cheap to sweep for expiry cleanup.
create index if not exists roamly_handoff_tokens_live_idx
  on public.roamly_handoff_tokens (expires_at)
  where used_at is null;
create index if not exists roamly_handoff_tokens_trip_idx
  on public.roamly_handoff_tokens (trip_id, created_at desc);

-- ---------------------------------------------------------------------
-- RLS + Data API grants (DATA-INFRA §8: explicit grants in-file).
-- Handoff tokens are server-only secrets-equivalent: only the
-- service role touches this table. Minting authenticates the owner
-- first; redemption is unauthenticated by design and proves itself
-- with the token — both run through API routes on the service role.
-- ---------------------------------------------------------------------
alter table public.roamly_handoff_tokens enable row level security;

drop policy if exists "Roamly service role manages handoff tokens" on public.roamly_handoff_tokens;
create policy "Roamly service role manages handoff tokens"
  on public.roamly_handoff_tokens for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on table public.roamly_handoff_tokens to service_role;
