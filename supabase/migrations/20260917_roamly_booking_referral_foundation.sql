-- Durable internal Roamly booking handoff identity.
-- Additive migration; apply only after the accompanying production precheck.

create table public.roamly_booking_referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  recommendation_id text,
  booking_type text not null default 'other',
  provider text not null,
  commercial_partner text not null,
  destination_url text not null,
  affiliate_url text not null,
  provider_tracking_reference text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_booking_referrals_identity_uq unique (id, user_id, trip_id),
  constraint roamly_booking_referrals_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index roamly_booking_referrals_provider_tracking_uidx
  on public.roamly_booking_referrals (provider_tracking_reference);

create index roamly_booking_referrals_user_trip_idx
  on public.roamly_booking_referrals (user_id, trip_id, created_at desc);

create index roamly_booking_referrals_recommendation_idx
  on public.roamly_booking_referrals (user_id, trip_id, recommendation_id, created_at desc)
  where recommendation_id is not null;

alter table public.roamly_bookings
  add column referral_id uuid;

alter table public.roamly_bookings
  add constraint roamly_bookings_referral_trip_check
  check (referral_id is null or trip_id is not null);

alter table public.roamly_bookings
  add constraint roamly_bookings_referral_id_fkey
  foreign key (referral_id, user_id, trip_id)
  references public.roamly_booking_referrals (id, user_id, trip_id)
  on delete restrict;

create unique index roamly_bookings_referral_capture_uidx
  on public.roamly_bookings (user_id, trip_id, referral_id)
  where referral_id is not null;

alter table public.roamly_booking_referrals enable row level security;

create policy "Roamly users read own booking referrals"
on public.roamly_booking_referrals
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.roamly_trips
    where roamly_trips.id = roamly_booking_referrals.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

grant select on public.roamly_booking_referrals to authenticated;
grant all privileges on public.roamly_booking_referrals to service_role;
