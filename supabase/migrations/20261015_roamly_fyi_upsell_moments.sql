-- Roamly customer FYI digest + trip-gap upsell watcher (2026-10-15).
--
-- Two lanes Junel approved:
--   A. Customer FYI voice — the FYI digest cron (/api/cron/roamly-fyi-digest)
--      sends check-in T-24h alerts, flight change/disruption alerts,
--      itinerary-ready notices, and trip-starting-soon reminders by email,
--      in-app notification, and push (push only where a subscription exists).
--   B. Trip-gap upsell watcher — lib/roamly/tripGapWatcher.ts detects missing
--      pieces of paid/active trips (hotel, transfer, eSIM, tours, car, gear)
--      and surfaces one offer per gap on the itinerary page, the Live Companion
--      FYI pipe, and the lane-A email.
--
-- Three tables, all written ONLY by the service role (cron + server routes).
-- RLS is enabled with no user policies: authenticated users cannot read or
-- write these rows directly; the API layer does ownership checks.
--
-- 1. roamly_fyi_digest_log — dedupe/audit log for every FYI moment.
--    The digest code FAILS SOFT when this table is missing (the migration has
--    not been applied yet): it continues the run without dedupe writes instead
--    of failing the whole digest. The per-day email cap and provider
--    idempotency keys still bound duplicate sends.
-- 2. roamly_email_preferences — global unsubscribe + marketing consent.
--    unsubscribed_all = true suppresses ALL FYI/marketing email (fail-closed:
--    unreadable preferences mean no email is sent). upsell_gap emails require
--    marketing_enabled = true. unsubscribe_token backs the one-click
--    unsubscribe link in every FYI email footer.
-- 3. roamly_trip_gap_cards — gap-card state for the itinerary page:
--    surfaced_at / last_offered_at / dismissed_at per (trip_id, gap_type).
--    Dismissed gaps are never offered again.

-- ---------------------------------------------------------------------------
-- 1. FYI digest dedupe log
-- ---------------------------------------------------------------------------
create table if not exists public.roamly_fyi_digest_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  moment text not null check (moment in (
    'check_in_t24',
    'flight_change',
    'itinerary_ready',
    'trip_starting_soon',
    'upsell_gap',
    'review_ask'
  )),
  dedupe_key text not null unique,
  channel text not null check (channel in ('email', 'push', 'in_app', 'snapshot', 'skipped')),
  snapshot_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists roamly_fyi_digest_log_trip_idx
  on public.roamly_fyi_digest_log (trip_id, moment, sent_at desc);
create index if not exists roamly_fyi_digest_log_user_idx
  on public.roamly_fyi_digest_log (user_id, sent_at desc);

alter table public.roamly_fyi_digest_log enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Global email preferences (unsubscribe + marketing consent)
-- ---------------------------------------------------------------------------
create table if not exists public.roamly_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  marketing_enabled boolean not null default false,
  unsubscribed_all boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);

alter table public.roamly_email_preferences enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Trip gap cards (itinerary page surface)
-- ---------------------------------------------------------------------------
create table if not exists public.roamly_trip_gap_cards (
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  gap_type text not null check (gap_type in ('hotel', 'transfer', 'esim', 'tours', 'car', 'gear')),
  surfaced_at timestamptz,
  last_offered_at timestamptz,
  offer_count integer not null default 0,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, gap_type)
);

create index if not exists roamly_trip_gap_cards_trip_idx
  on public.roamly_trip_gap_cards (trip_id);

alter table public.roamly_trip_gap_cards enable row level security;

-- Keep updated_at honest on the gap-cards table.
create or replace function public.roamly_touch_trip_gap_cards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists roamly_trip_gap_cards_touch on public.roamly_trip_gap_cards;
create trigger roamly_trip_gap_cards_touch
  before update on public.roamly_trip_gap_cards
  for each row execute function public.roamly_touch_trip_gap_cards_updated_at();
