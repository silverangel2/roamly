-- Roamly Companion Booking Wallet foundation.
-- This creates a canonical wallet without removing the older roamly_bookings table.

create table if not exists public.trip_bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_type text not null,
  booking_status text not null default 'needs_confirmation',
  provider text,
  provider_booking_id text,
  confirmation_code text,
  recommendation_id text,
  affiliate_click_id uuid,
  affiliate_conversion_id uuid,
  source_type text not null default 'manual',
  source_reference text,
  title text not null,
  start_time timestamptz,
  end_time timestamptz,
  timezone text,
  origin text,
  destination text,
  location_name text,
  address text,
  coordinates jsonb,
  flight_number text,
  airline_code text,
  terminal text,
  gate text,
  room_type text,
  check_in_time timestamptz,
  check_out_time timestamptz,
  reservation_requirements jsonb not null default '{}'::jsonb,
  total_price numeric(12,2),
  currency text,
  taxes_and_fees numeric(12,2),
  cancellation_deadline timestamptz,
  cancellation_terms text,
  traveler_confirmed boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trip_bookings
  drop constraint if exists trip_bookings_booking_type_check,
  drop constraint if exists trip_bookings_booking_status_check,
  drop constraint if exists trip_bookings_source_type_check,
  drop constraint if exists trip_bookings_currency_check,
  drop constraint if exists trip_bookings_price_check,
  drop constraint if exists trip_bookings_taxes_check,
  drop constraint if exists trip_bookings_coordinates_check,
  add constraint trip_bookings_booking_type_check
    check (booking_type in ('flight', 'hotel', 'train', 'bus', 'ferry', 'rental_car', 'transfer', 'activity', 'restaurant', 'insurance', 'other')),
  add constraint trip_bookings_booking_status_check
    check (booking_status in ('recommended', 'clicked', 'detected', 'needs_confirmation', 'confirmed', 'modified', 'cancelled', 'refunded', 'completed')),
  add constraint trip_bookings_source_type_check
    check (source_type in ('brain_recommendation', 'affiliate_click', 'affiliate_conversion', 'manual', 'upload', 'email', 'provider_sync', 'live_provider', 'admin')),
  add constraint trip_bookings_currency_check
    check (currency is null or currency ~ '^[A-Za-z]{3}$'),
  add constraint trip_bookings_price_check
    check (total_price is null or total_price >= 0),
  add constraint trip_bookings_taxes_check
    check (taxes_and_fees is null or taxes_and_fees >= 0),
  add constraint trip_bookings_coordinates_check
    check (
      coordinates is null
      or jsonb_typeof(coordinates) = 'object'
    );

create unique index if not exists trip_bookings_provider_booking_uidx
  on public.trip_bookings (user_id, provider, provider_booking_id)
  where provider is not null and provider_booking_id is not null;

create unique index if not exists trip_bookings_confirmation_uidx
  on public.trip_bookings (user_id, provider, confirmation_code, booking_type)
  where provider is not null and confirmation_code is not null;

create index if not exists trip_bookings_trip_timeline_idx
  on public.trip_bookings (trip_id, start_time nulls last, created_at desc);

create index if not exists trip_bookings_user_idx
  on public.trip_bookings (user_id, created_at desc);

create index if not exists trip_bookings_status_idx
  on public.trip_bookings (booking_status, start_time);

create index if not exists trip_bookings_affiliate_click_idx
  on public.trip_bookings (affiliate_click_id)
  where affiliate_click_id is not null;

create index if not exists trip_bookings_affiliate_conversion_idx
  on public.trip_bookings (affiliate_conversion_id)
  where affiliate_conversion_id is not null;

create table if not exists public.booking_segments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.trip_bookings(id) on delete cascade,
  sequence integer not null,
  origin text,
  destination text,
  departure_time timestamptz,
  arrival_time timestamptz,
  provider text,
  service_number text,
  terminal text,
  gate text,
  seat text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_segments
  drop constraint if exists booking_segments_sequence_check,
  drop constraint if exists booking_segments_status_check,
  add constraint booking_segments_sequence_check check (sequence > 0),
  add constraint booking_segments_status_check
    check (status in ('scheduled', 'confirmed', 'delayed', 'cancelled', 'completed', 'unknown'));

create unique index if not exists booking_segments_booking_sequence_uidx
  on public.booking_segments (booking_id, sequence);

create index if not exists booking_segments_booking_idx
  on public.booking_segments (booking_id, sequence);

create index if not exists booking_segments_departure_idx
  on public.booking_segments (departure_time);

drop trigger if exists trip_bookings_updated_at on public.trip_bookings;
create trigger trip_bookings_updated_at
before update on public.trip_bookings
for each row execute function public.roamly_set_updated_at();

drop trigger if exists booking_segments_updated_at on public.booking_segments;
create trigger booking_segments_updated_at
before update on public.booking_segments
for each row execute function public.roamly_set_updated_at();

alter table public.trip_bookings enable row level security;
alter table public.booking_segments enable row level security;

drop policy if exists "Roamly users read own trip bookings" on public.trip_bookings;
create policy "Roamly users read own trip bookings"
on public.trip_bookings
for select
using (user_id = auth.uid());

drop policy if exists "Roamly users create own trip bookings" on public.trip_bookings;
create policy "Roamly users create own trip bookings"
on public.trip_bookings
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.roamly_trips
    where roamly_trips.id = trip_bookings.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users update own trip bookings" on public.trip_bookings;
create policy "Roamly users update own trip bookings"
on public.trip_bookings
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users read own booking segments" on public.booking_segments;
create policy "Roamly users read own booking segments"
on public.booking_segments
for select
using (
  exists (
    select 1
    from public.trip_bookings
    where trip_bookings.id = booking_segments.booking_id
      and trip_bookings.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users create own booking segments" on public.booking_segments;
create policy "Roamly users create own booking segments"
on public.booking_segments
for insert
with check (
  exists (
    select 1
    from public.trip_bookings
    where trip_bookings.id = booking_segments.booking_id
      and trip_bookings.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users update own booking segments" on public.booking_segments;
create policy "Roamly users update own booking segments"
on public.booking_segments
for update
using (
  exists (
    select 1
    from public.trip_bookings
    where trip_bookings.id = booking_segments.booking_id
      and trip_bookings.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.trip_bookings
    where trip_bookings.id = booking_segments.booking_id
      and trip_bookings.user_id = auth.uid()
  )
);
