-- Trip-specific traveler facts for independently evaluated destination requirements.
-- This migration is additive only. It intentionally performs no backfill.

create table public.roamly_trip_travelers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null
    references public.roamly_trips(id)
    on delete cascade,
  traveler_order integer not null,
  role text not null,
  traveler_type text not null,
  passport_issuing_country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint roamly_trip_travelers_role_ck
    check (role in ('account_holder', 'companion')),
  constraint roamly_trip_travelers_type_ck
    check (traveler_type in ('adult', 'child', 'infant')),
  constraint roamly_trip_travelers_passport_country_ck
    check (
      passport_issuing_country is null
      or passport_issuing_country ~ '^[A-Z]{2}$'
    ),
  constraint roamly_trip_travelers_order_ck
    check (traveler_order >= 1)
);

create unique index roamly_trip_travelers_trip_order_uidx
  on public.roamly_trip_travelers (trip_id, traveler_order);

create unique index roamly_trip_travelers_account_holder_uidx
  on public.roamly_trip_travelers (trip_id)
  where role = 'account_holder';

create trigger roamly_trip_travelers_updated_at
before update on public.roamly_trip_travelers
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_trip_travelers enable row level security;

-- Customers may read only members of trips they own. Mutations belong behind
-- authenticated server routes that enforce party-size and slot invariants.
create policy "Roamly users read own trip travelers"
on public.roamly_trip_travelers
for select
to authenticated
using (
  exists (
    select 1
    from public.roamly_trips t
    where t.id = roamly_trip_travelers.trip_id
      and t.user_id = auth.uid()
  )
);

create policy "Roamly service role manages trip travelers"
on public.roamly_trip_travelers
for all
to service_role
using (true)
with check (true);

revoke all on table public.roamly_trip_travelers from anon;
revoke insert, update, delete on table public.roamly_trip_travelers from authenticated;
grant select on table public.roamly_trip_travelers to authenticated;
grant all on table public.roamly_trip_travelers to service_role;
