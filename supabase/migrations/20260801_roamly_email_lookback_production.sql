-- Production Email Lookback hardening.
-- The canonical Roamly booking wallet is public.roamly_bookings; older helper
-- migrations created extraction/reconciliation references to public.trip_bookings.

alter table public.booking_extraction_results
  drop constraint if exists booking_extraction_results_matched_booking_id_fkey;

alter table public.booking_extraction_results
  add constraint booking_extraction_results_matched_booking_id_fkey
  foreign key (matched_booking_id)
  references public.roamly_bookings(id)
  on delete set null;

alter table public.booking_reconciliation_runs
  drop constraint if exists booking_reconciliation_runs_source_booking_id_fkey;

alter table public.booking_reconciliation_runs
  add constraint booking_reconciliation_runs_source_booking_id_fkey
  foreign key (source_booking_id)
  references public.roamly_bookings(id)
  on delete set null;

alter table public.booking_extraction_results
  add column if not exists email_event_types text[] not null default '{}'::text[],
  add column if not exists auto_apply_allowed boolean not null default false,
  add column if not exists requires_user_approval boolean not null default false,
  add column if not exists applied_at timestamptz,
  add column if not exists idempotency_key text;

create unique index if not exists booking_extraction_results_idempotency_uidx
  on public.booking_extraction_results (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists booking_extraction_results_approval_idx
  on public.booking_extraction_results (user_id, requires_user_approval, match_status, created_at desc);

alter table public.roamly_bookings
  drop constraint if exists roamly_bookings_source_type_check;

alter table public.roamly_bookings
  add constraint roamly_bookings_source_type_check
  check (
    source_type in (
      'manual',
      'screenshot',
      'email',
      'gmail',
      'outlook',
      'affiliate',
      'affiliate_click',
      'provider',
      'provider_sync',
      'live_provider',
      'admin',
      'import'
    )
  );
