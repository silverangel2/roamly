-- OWNER-APPLIED — DO NOT APPLY AUTOMATICALLY.
--
-- Roamly booking email-import tombstones (Tombstone workstream,
-- 2026-10-31 integrated release candidate). This migration is part of
-- a LOCAL release candidate on production HOLD: it must be reviewed
-- and applied by the owner through the normal migration process, in
-- the same release that ships the tombstone code. No agent applies
-- it, and the code is written to fail soft (pre-tombstone behaviour)
-- while the table does not exist yet.
--
-- Why: discarding an email import used to hard-delete the
-- booking_extraction_results row — which is also the Gmail sync's
-- upsert dedupe target (unique on user_id, source_type,
-- source_reference). The delete destroyed the dedupe target, so a
-- later sync / reconnect backfill re-extracted and re-surfaced or
-- re-applied the very email the traveler had removed.
--
-- This table is the durable suppression record ("tombstone"), keyed
-- to the email's stable identity: source_reference =
-- 'email:<provider>:<provider message id>' (e.g.
-- 'email:gmail:1a16f3b4a79c3bdf'), the same identity the extraction
-- writer mints and the dedupe index keys on. Gmail sync, reconnect
-- backfill, and auto-apply consult this table BEFORE creating or
-- applying an extraction for a message. The key is the EMAIL, never
-- the stay: a different message id — even a new booking email about
-- the same stay — is a different identity and is not suppressed.
--
-- Audit posture: rows here are never deleted by application code.
-- The extraction row is likewise preserved (discard moves it to
-- match_status 'rejected'), and a wallet booking created from the
-- import is flagged in its metadata, not deleted — the tombstone
-- ends customer-facing presentation while the removal decision and
-- the booking history both survive.
--
-- extraction_id / matched_booking_id / trip_id are stored as plain
-- uuid columns WITHOUT foreign keys on purpose: a tombstone must
-- survive deletion of the rows it points at (that survival is its
-- entire purpose), so no ON DELETE action may ever cascade into it
-- or block a legitimate delete elsewhere.
--
-- Amendments (2026-10-31, post-gate D2):
-- (a) Rerunnable trigger (MIGRATION-AUDIT §M1-R1): a
--     `drop trigger if exists` guard now precedes the
--     `create trigger` for booking_email_suppressions_updated_at,
--     so re-running this migration (or retrying after a partial
--     apply) no longer fails with "trigger already exists".
-- (b) Minimum UPDATE permission for repeat discards
--     (MIGRATION-AUDIT §M1-R2): the discard path upserts with
--     onConflict "user_id,source_reference" and no
--     ignoreDuplicates, so a repeat discard takes the
--     INSERT ... ON CONFLICT DO UPDATE branch, which requires
--     UPDATE privilege and an UPDATE RLS policy. An UPDATE
--     policy for authenticated, scoped to own rows only
--     (using + with check both pin user_id = auth.uid()), and
--     `grant select, insert, update` to authenticated are now
--     included. No delete policy, no delete grant, and no anon
--     grant are added; nothing broader is granted.

create table if not exists public.booking_email_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_reference text not null,
  provider text,
  provider_message_id text,
  extraction_id uuid,
  matched_booking_id uuid,
  trip_id uuid,
  reason text not null default 'traveler_discarded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_email_suppressions_reason_check
    check (reason in ('traveler_discarded'))
);

-- One tombstone per traveler per email identity: repeat discards are
-- idempotent upserts on this index (PostgREST
-- onConflict=user_id,source_reference).
create unique index if not exists booking_email_suppressions_identity_uidx
  on public.booking_email_suppressions (user_id, source_reference);

create index if not exists booking_email_suppressions_user_idx
  on public.booking_email_suppressions (user_id, created_at desc);

drop trigger if exists booking_email_suppressions_updated_at on public.booking_email_suppressions;
create trigger booking_email_suppressions_updated_at
before update on public.booking_email_suppressions
for each row execute function public.roamly_set_updated_at();

alter table public.booking_email_suppressions enable row level security;

-- Travelers can read and create their own tombstones (the discard
-- route runs on the traveler's session). A repeat discard's upsert
-- may refresh the row's own linkage fields (extraction_id /
-- matched_booking_id / trip_id) — that is the only reason an UPDATE
-- policy for authenticated exists below, scoped to own rows only
-- with the with-check pinning user_id to the caller, so a
-- tombstone still cannot be removed or reassigned by a traveler:
-- there is still no delete policy or delete grant for
-- authenticated users, and a tombstone remains a durable removal
-- record, not traveler-editable state.
drop policy if exists "Roamly users read own booking email suppressions" on public.booking_email_suppressions;
create policy "Roamly users read own booking email suppressions"
on public.booking_email_suppressions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own booking email suppressions" on public.booking_email_suppressions;
create policy "Roamly users create own booking email suppressions"
on public.booking_email_suppressions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own booking email suppressions" on public.booking_email_suppressions;
create policy "Roamly users update own booking email suppressions"
on public.booking_email_suppressions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update on table public.booking_email_suppressions to authenticated;
grant all privileges on table public.booking_email_suppressions to service_role;
