-- Affiliate click and conversion tracking for Roamly Companion.

create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  recommendation_id text,
  provider text not null,
  affiliate_partner text not null,
  destination_url text not null,
  affiliate_url text not null,
  sub_id text not null,
  clicked_at timestamptz not null default now(),
  device_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.affiliate_clicks
  drop constraint if exists affiliate_clicks_partner_check,
  drop constraint if exists affiliate_clicks_sub_id_check,
  add constraint affiliate_clicks_partner_check
    check (affiliate_partner in ('travelpayouts', 'stay22', 'klook', 'amazon', 'airalo', 'other')),
  add constraint affiliate_clicks_sub_id_check
    check (sub_id ~ '^rc_[A-Za-z0-9_-]{16,80}$');

create unique index if not exists affiliate_clicks_sub_id_uidx
  on public.affiliate_clicks (sub_id);

create index if not exists affiliate_clicks_user_idx
  on public.affiliate_clicks (user_id, clicked_at desc);

create index if not exists affiliate_clicks_trip_idx
  on public.affiliate_clicks (trip_id, clicked_at desc);

create index if not exists affiliate_clicks_recommendation_idx
  on public.affiliate_clicks (trip_id, recommendation_id)
  where recommendation_id is not null;

create table if not exists public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  affiliate_click_id uuid references public.affiliate_clicks(id) on delete set null,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  affiliate_partner text not null,
  external_order_id text,
  booking_type text not null default 'other',
  status text not null default 'detected',
  amount numeric(12,2),
  currency text,
  commission_status text,
  booked_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  raw_event_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.affiliate_conversions
  drop constraint if exists affiliate_conversions_partner_check,
  drop constraint if exists affiliate_conversions_booking_type_check,
  drop constraint if exists affiliate_conversions_status_check,
  drop constraint if exists affiliate_conversions_currency_check,
  add constraint affiliate_conversions_partner_check
    check (affiliate_partner in ('travelpayouts', 'stay22', 'klook', 'amazon', 'airalo', 'other')),
  add constraint affiliate_conversions_booking_type_check
    check (booking_type in ('flight', 'hotel', 'train', 'bus', 'ferry', 'rental_car', 'transfer', 'activity', 'restaurant', 'insurance', 'other')),
  add constraint affiliate_conversions_status_check
    check (status in ('detected', 'confirmed', 'modified', 'cancelled', 'refunded', 'completed', 'needs_confirmation')),
  add constraint affiliate_conversions_currency_check
    check (currency is null or currency ~ '^[A-Za-z]{3}$');

create unique index if not exists affiliate_conversions_partner_order_uidx
  on public.affiliate_conversions (affiliate_partner, external_order_id)
  where external_order_id is not null;

create unique index if not exists affiliate_conversions_raw_event_uidx
  on public.affiliate_conversions (affiliate_partner, raw_event_reference)
  where raw_event_reference is not null;

create index if not exists affiliate_conversions_click_idx
  on public.affiliate_conversions (affiliate_click_id);

create index if not exists affiliate_conversions_user_idx
  on public.affiliate_conversions (user_id, created_at desc);

create index if not exists affiliate_conversions_trip_idx
  on public.affiliate_conversions (trip_id, created_at desc);

drop trigger if exists affiliate_conversions_updated_at on public.affiliate_conversions;
create trigger affiliate_conversions_updated_at
before update on public.affiliate_conversions
for each row execute function public.roamly_set_updated_at();

alter table public.trip_bookings
  drop constraint if exists trip_bookings_affiliate_click_id_fkey,
  drop constraint if exists trip_bookings_affiliate_conversion_id_fkey;

alter table public.trip_bookings
  add constraint trip_bookings_affiliate_click_id_fkey
    foreign key (affiliate_click_id) references public.affiliate_clicks(id) on delete set null,
  add constraint trip_bookings_affiliate_conversion_id_fkey
    foreign key (affiliate_conversion_id) references public.affiliate_conversions(id) on delete set null;

alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_conversions enable row level security;

drop policy if exists "Roamly users read own affiliate clicks" on public.affiliate_clicks;
create policy "Roamly users read own affiliate clicks"
on public.affiliate_clicks
for select
using (user_id = auth.uid());

drop policy if exists "Roamly users create own affiliate clicks" on public.affiliate_clicks;
create policy "Roamly users create own affiliate clicks"
on public.affiliate_clicks
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.roamly_trips
    where roamly_trips.id = affiliate_clicks.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users read own affiliate conversions" on public.affiliate_conversions;
create policy "Roamly users read own affiliate conversions"
on public.affiliate_conversions
for select
using (user_id = auth.uid());
