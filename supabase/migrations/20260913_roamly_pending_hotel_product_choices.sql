-- One pending, explicit hotel-product intent per trip.
-- This is not booking, price, inventory, or budget truth.

create table public.roamly_pending_hotel_product_choices (
  trip_id uuid primary key references public.roamly_trips(id) on delete cascade,
  provider text not null,
  provider_property_id text not null,
  selected_hotel_candidate_id text not null,
  provider_product_id text not null,
  revalidated_at timestamptz not null,
  chosen_at timestamptz not null,
  acknowledged_material_changes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_pending_hotel_product_choices_provider_check
    check (provider = 'booking_demand'),
  constraint roamly_pending_hotel_product_choices_identity_check
    check (
      length(trim(provider_property_id)) > 0
      and length(trim(selected_hotel_candidate_id)) > 0
      and length(trim(provider_product_id)) > 0
      and provider_property_id = trim(provider_property_id)
      and selected_hotel_candidate_id = trim(selected_hotel_candidate_id)
      and provider_product_id = trim(provider_product_id)
    )
);

drop trigger if exists roamly_pending_hotel_product_choices_updated_at
  on public.roamly_pending_hotel_product_choices;
create trigger roamly_pending_hotel_product_choices_updated_at
before update on public.roamly_pending_hotel_product_choices
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_pending_hotel_product_choices enable row level security;

drop policy if exists "Roamly users read own pending hotel product choices"
  on public.roamly_pending_hotel_product_choices;
create policy "Roamly users read own pending hotel product choices"
on public.roamly_pending_hotel_product_choices
for select to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_pending_hotel_product_choices.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users manage own pending hotel product choices"
  on public.roamly_pending_hotel_product_choices;
create policy "Roamly users manage own pending hotel product choices"
on public.roamly_pending_hotel_product_choices
for all to authenticated
using (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_pending_hotel_product_choices.trip_id
      and roamly_trips.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.roamly_trips
    where roamly_trips.id = roamly_pending_hotel_product_choices.trip_id
      and roamly_trips.user_id = auth.uid()
  )
);
