-- Itinerary Library front door: traveler-submitted proven itineraries + per-item
-- booking-proof verdicts, plus email-preference tracking for the post-trip ask.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule).
--
-- Design notes (Junel's endorsed symmetry: "RI = order-proof reviews;
-- Roamly = booking-proof stays — verified experience, received, never scraped"):
-- * itinerary_submissions: one row per completed trip a traveler chooses to share.
--   unique(trip_id) enforces one submission per completed trip.
-- * item_verdicts: per-item ratings that MUST tie to a real booked item
--   (booking_id / segment_id reference the traveler's own roamly_bookings and
--   booking_segments rows; item_label is a snapshot so verdicts survive
--   segment replacement). booking_proven is true for every row written through
--   the share intake — the item came from the traveler's own booking wallet.
-- * Consent: consent_anonymized_reuse defaults FALSE (unchecked in the UI).
--   Only consenting submissions are aggregated into
--   successful_trip_experience_patterns.
-- * roamly_email_preferences: marketing/relationship-email opt-out honored by
--   the /api/cron/roamly-post-trip-ask cron. Read fail-soft: if this table is
--   absent the cron proceeds (the email is about the traveler's own trip).
-- * successful_trip_experience_patterns gains budget_band + source_trip_count
--   so budget-band matching and small-sample caution work on stored rows.
--   Backfilled from existing data (band unknown, count = sample_count).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Itinerary submissions (one per completed trip)
-- ---------------------------------------------------------------------------
create table if not exists public.itinerary_submissions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  destination text not null,
  destination_city text,
  destination_country text,
  start_date date,
  end_date date,
  highlights text,
  consent_anonymized_reuse boolean not null default false,
  anonymized boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_submissions_one_per_trip unique (trip_id),
  constraint itinerary_submissions_destination_check check (char_length(destination) between 1 and 200)
);

create index if not exists itinerary_submissions_user_idx
  on public.itinerary_submissions (user_id, created_at desc);
create index if not exists itinerary_submissions_consent_idx
  on public.itinerary_submissions (consent_anonymized_reuse, created_at desc)
  where consent_anonymized_reuse = true;

drop trigger if exists itinerary_submissions_updated_at on public.itinerary_submissions;
create trigger itinerary_submissions_updated_at
before update on public.itinerary_submissions
for each row execute function public.roamly_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Per-item verdicts (each tied to a real booked item)
-- ---------------------------------------------------------------------------
create table if not exists public.item_verdicts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.itinerary_submissions(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.roamly_bookings(id) on delete set null,
  -- booking_segments rows are delete+reinserted by roamly_replace_booking_segments,
  -- so segment_id is intentionally NOT a hard FK; item_label is the snapshot.
  segment_id uuid,
  item_type text not null default 'other'
    check (item_type in ('hotel', 'flight', 'activity', 'other')),
  item_label text not null,
  location text,
  rating integer check (rating is null or (rating >= 1 and rating <= 5)),
  verdict text check (verdict is null or verdict in ('loved', 'fine', 'avoid')),
  note text,
  booking_proven boolean not null default true,
  source text not null default 'gmail_booking',
  created_at timestamptz not null default now(),
  constraint item_verdicts_label_check check (char_length(item_label) between 1 and 240)
);

create index if not exists item_verdicts_submission_idx
  on public.item_verdicts (submission_id);
create index if not exists item_verdicts_trip_idx
  on public.item_verdicts (trip_id);
create index if not exists item_verdicts_booking_idx
  on public.item_verdicts (booking_id)
  where booking_id is not null;
create index if not exists item_verdicts_proven_idx
  on public.item_verdicts (booking_proven, item_type, created_at desc)
  where booking_proven = true;

-- ---------------------------------------------------------------------------
-- 3. Email preferences (post-trip library ask opt-out = marketing consent)
-- ---------------------------------------------------------------------------
-- NOTE: public.roamly_email_preferences is created by migration
-- 20261015_roamly_fyi_upsell_moments.sql (shipped first). Only add the
-- library lane's column here; the CREATE is intentionally not repeated.
alter table public.roamly_email_preferences
add column if not exists library_ask_opt_out boolean not null default false;

drop trigger if exists roamly_email_preferences_updated_at on public.roamly_email_preferences;
create trigger roamly_email_preferences_updated_at
before update on public.roamly_email_preferences
for each row execute function public.roamly_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Pattern table extensions: budget band + distinct-trip count
-- ---------------------------------------------------------------------------
alter table public.successful_trip_experience_patterns
  add column if not exists budget_band text;
alter table public.successful_trip_experience_patterns
  add column if not exists source_trip_count integer;

-- Backfill: existing rows are feedback-sourced (weight 1), so distinct trips =
-- sample_count. Band is unknown for historical rows.
update public.successful_trip_experience_patterns
set source_trip_count = sample_count
where source_trip_count is null;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.itinerary_submissions enable row level security;
alter table public.item_verdicts enable row level security;
alter table public.roamly_email_preferences enable row level security;

-- itinerary_submissions
drop policy if exists "Roamly users read own itinerary submissions" on public.itinerary_submissions;
create policy "Roamly users read own itinerary submissions"
on public.itinerary_submissions for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own itinerary submissions" on public.itinerary_submissions;
create policy "Roamly users create own itinerary submissions"
on public.itinerary_submissions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.roamly_trips t
    where t.id = itinerary_submissions.trip_id and t.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users update own itinerary submissions" on public.itinerary_submissions;
create policy "Roamly users update own itinerary submissions"
on public.itinerary_submissions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users delete own itinerary submissions" on public.itinerary_submissions;
create policy "Roamly users delete own itinerary submissions"
on public.itinerary_submissions for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages itinerary submissions" on public.itinerary_submissions;
create policy "Roamly service role manages itinerary submissions"
on public.itinerary_submissions for all to service_role
using (true) with check (true);

-- item_verdicts
drop policy if exists "Roamly users read own item verdicts" on public.item_verdicts;
create policy "Roamly users read own item verdicts"
on public.item_verdicts for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own item verdicts" on public.item_verdicts;
create policy "Roamly users create own item verdicts"
on public.item_verdicts for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.itinerary_submissions s
    where s.id = item_verdicts.submission_id and s.user_id = auth.uid()
  )
);

drop policy if exists "Roamly service role manages item verdicts" on public.item_verdicts;
create policy "Roamly service role manages item verdicts"
on public.item_verdicts for all to service_role
using (true) with check (true);

-- roamly_email_preferences
drop policy if exists "Roamly users read own email preferences" on public.roamly_email_preferences;
create policy "Roamly users read own email preferences"
on public.roamly_email_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users upsert own email preferences" on public.roamly_email_preferences;
create policy "Roamly users upsert own email preferences"
on public.roamly_email_preferences for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own email preferences" on public.roamly_email_preferences;
create policy "Roamly users update own email preferences"
on public.roamly_email_preferences for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly service role manages email preferences" on public.roamly_email_preferences;
create policy "Roamly service role manages email preferences"
on public.roamly_email_preferences for all to service_role
using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6. Service-role grants (mirrors the existing patterns-table grant style)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table public.itinerary_submissions to service_role;
grant select, insert, update, delete on table public.item_verdicts to service_role;
grant select, insert, update, delete on table public.roamly_email_preferences to service_role;
