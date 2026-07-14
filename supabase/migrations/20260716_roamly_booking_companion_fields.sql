-- Extend the existing production roamly_bookings table for Companion.
-- Existing columns remain canonical and are not renamed.

alter table public.roamly_bookings
  add column if not exists source_type text not null default 'manual',
  add column if not exists provider_booking_id text,
  add column if not exists traveler_confirmed boolean not null default false,

  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz,

  add column if not exists origin text,
  add column if not exists destination text,
  add column if not exists flight_number text,
  add column if not exists terminal text,
  add column if not exists gate text,
  add column if not exists seat text,

  add column if not exists room_type text,
  add column if not exists check_in_at timestamptz,
  add column if not exists check_out_at timestamptz,
  add column if not exists reservation_requirements jsonb not null default '{}'::jsonb,

  add column if not exists total_price numeric(12,2),
  add column if not exists taxes_and_fees numeric(12,2),
  add column if not exists cancellation_deadline timestamptz,
  add column if not exists cancellation_terms text,

  add column if not exists last_synced_at timestamptz;

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
      'import'
    )
  );

create index if not exists roamly_bookings_provider_booking_idx
  on public.roamly_bookings (user_id, provider_booking_id)
  where provider_booking_id is not null;

create index if not exists roamly_bookings_trip_start_at_idx
  on public.roamly_bookings (trip_id, start_at)
  where start_at is not null;

create index if not exists roamly_bookings_sync_idx
  on public.roamly_bookings (user_id, last_synced_at);

-- Backfill combined timestamps from the existing date/time columns.
update public.roamly_bookings
set start_at =
  (
    start_date::text ||
    'T' ||
    coalesce(start_time::text, '00:00:00')
  )::timestamp at time zone 'UTC'
where start_at is null
  and start_date is not null;

update public.roamly_bookings
set end_at =
  (
    end_date::text ||
    'T' ||
    coalesce(end_time::text, '23:59:59')
  )::timestamp at time zone 'UTC'
where end_at is null
  and end_date is not null;

update public.roamly_bookings
set
  total_price = round(amount_cents::numeric / 100, 2),
  traveler_confirmed =
    booking_status in ('booked', 'paid', 'reserved')
where
  total_price is null
  or traveler_confirmed = false;
