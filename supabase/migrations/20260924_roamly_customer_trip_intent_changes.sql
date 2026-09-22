create table public.roamly_customer_trip_intent_changes (
  id uuid primary key default gen_random_uuid(),
  original_trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_itinerary_id uuid not null references public.roamly_itineraries(id) on delete cascade,
  requested_intent_snapshot jsonb not null,
  requested_intent_hash text not null,
  expected_source_snapshot jsonb not null,
  expected_intent_snapshot jsonb not null,
  expected_traveler_snapshot jsonb not null,
  expected_generation_snapshot jsonb not null default '{}'::jsonb,
  expected_booking_snapshot jsonb not null default '{}'::jsonb,
  expected_trip_status text not null,
  expected_itinerary_status text,
  expected_revision bigint not null check (expected_revision >= 0),
  expected_content_hash text not null,
  expected_price_discovery_id uuid,
  successor_trip_id uuid references public.roamly_trips(id) on delete set null,
  successor_itinerary_id uuid references public.roamly_itineraries(id) on delete set null,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval','reserved','generating','applied','failed','stale','rejected')),
  failure_reason text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reserved_at timestamptz,
  applied_at timestamptz,
  completed_at timestamptz,
  check (jsonb_typeof(requested_intent_snapshot) = 'object'),
  check (jsonb_typeof(expected_source_snapshot) = 'object'),
  check (jsonb_typeof(expected_intent_snapshot) = 'object'),
  check (jsonb_typeof(expected_traveler_snapshot) = 'object'),
  check (jsonb_typeof(expected_booking_snapshot) = 'object'),
  check ((requested_intent_snapshot->>'travelersCount') ~ '^[1-9][0-9]*$'),
  check (jsonb_typeof(requested_intent_snapshot->'travelers') = 'object')
);

create index roamly_customer_trip_intent_changes_trip_idx
  on public.roamly_customer_trip_intent_changes (original_trip_id, created_at desc);
create unique index roamly_customer_trip_intent_changes_open_uidx
  on public.roamly_customer_trip_intent_changes (original_trip_id, requested_intent_hash)
  where status in ('awaiting_approval','reserved','generating');

create trigger roamly_customer_trip_intent_changes_updated_at
before update on public.roamly_customer_trip_intent_changes
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_customer_trip_intent_changes enable row level security;
create policy "Roamly users read own customer trip intent changes"
  on public.roamly_customer_trip_intent_changes
  for select to authenticated using (user_id = auth.uid());
revoke all on public.roamly_customer_trip_intent_changes from anon, authenticated, public;
grant select on public.roamly_customer_trip_intent_changes to authenticated;
grant all on public.roamly_customer_trip_intent_changes to service_role;

create function public.roamly_reserve_customer_trip_intent_change(p_proposal_id uuid, p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proposal public.roamly_customer_trip_intent_changes;
  trip public.roamly_trips;
  itinerary public.roamly_itineraries;
  successor_id uuid;
  current_source jsonb;
  current_intent jsonb;
  current_booking jsonb;
  planning jsonb;
begin
  select * into proposal from public.roamly_customer_trip_intent_changes
    where id = p_proposal_id and original_trip_id = p_trip_id and user_id = auth.uid() for update;
  if proposal.id is null then raise exception using errcode = '42501', message = 'INTENT_CHANGE_NOT_FOUND'; end if;
  if proposal.status in ('reserved','generating','applied') then
    return jsonb_build_object('status', proposal.status, 'proposalId', proposal.id, 'successorTripId', proposal.successor_trip_id, 'idempotent', true);
  end if;
  if proposal.status <> 'awaiting_approval' then raise exception using errcode = '40001', message = 'INTENT_CHANGE_NOT_APPLICABLE'; end if;

  select * into trip from public.roamly_trips where id = p_trip_id and user_id = auth.uid() for update;
  if trip.id is null or trip.status not in ('generated','locked','planned') or trip.status is distinct from proposal.expected_trip_status then
    raise exception using errcode = '40001', message = 'INTENT_CHANGE_TRIP_NOT_ELIGIBLE';
  end if;
  if trip.start_date is null or trip.end_date is null or trip.end_date < trip.start_date then
    raise exception using errcode = '40001', message = 'INTENT_CHANGE_DATES_INVALID';
  end if;
  select * into itinerary from public.roamly_itineraries where trip_id = trip.id and user_id = auth.uid() for update;
  if itinerary.id is null or itinerary.id <> proposal.original_itinerary_id then raise exception using errcode = '40001', message = 'INTENT_CHANGE_ITINERARY_CHANGED'; end if;
  if itinerary.repair_revision is distinct from proposal.expected_revision or public.roamly_itinerary_content_hash(itinerary.full_json) is distinct from proposal.expected_content_hash then
    raise exception using errcode = '40001', message = 'INTENT_CHANGE_ITINERARY_STALE';
  end if;

  planning := coalesce(trip.metadata, '{}'::jsonb)->'planning';
  current_source := jsonb_build_object(
    'destination', coalesce(trip.destination, planning->>'destination'),
    'destinationCity', coalesce(trip.destination_city, planning->>'destinationCity'),
    'destinationCountry', coalesce(trip.destination_country, planning->>'destinationCountry'),
    'destinationRegion', coalesce(trip.destination_region, planning->>'destinationRegion'),
    'origin', coalesce(trip.origin, planning->>'origin'),
    'startDate', trip.start_date::text,
    'endDate', trip.end_date::text,
    'daysCount', coalesce(trip.days_count, (planning->>'daysCount')::integer),
    'budgetAmount', coalesce(trip.budget_amount, nullif(planning->>'budgetAmount','')::numeric, nullif(planning->>'budget_amount','')::numeric, nullif(planning->>'budget_total','')::numeric),
    'budgetCurrency', coalesce(trip.budget_currency, planning->>'budgetCurrency'),
    'latestPriceDiscoveryId', trip.latest_price_discovery_id
  );
  if current_source is distinct from proposal.expected_source_snapshot then raise exception using errcode = '40001', message = 'INTENT_CHANGE_SOURCE_STALE'; end if;

  current_intent := jsonb_build_object(
    'travelersCount', trip.travelers_count,
    'travelers', coalesce(planning->'travelers', jsonb_build_object('adults', 1, 'children', 0, 'infants', 0)),
    'rooms', coalesce((planning->>'rooms')::integer, 1),
    'bedPreference', coalesce(planning->>'bedPreference', 'No preference'),
    'travelStyle', coalesce(trip.travel_style, planning->>'travelStyle', 'Balanced'),
    'interests', case when coalesce(array_length(trip.interests, 1), 0) > 0 then to_jsonb(trip.interests) else coalesce(planning->'interests', '[]'::jsonb) end,
    'pace', coalesce(planning->>'pace', 'Balanced'),
    'walkingTolerance', coalesce(planning->>'walkingTolerance', 'Medium'),
    'accommodationPreference', coalesce(trip.accommodation_preference, planning->>'accommodationPreference', 'Not sure'),
    'transportationPreference', coalesce(trip.transportation_preference, planning->>'transportationPreference', 'Mixed'),
    'accessibilityNeeds', planning->'accessibilityNeeds',
    'dietaryPreference', planning->'dietaryPreference',
    'specialNotes', coalesce(to_jsonb(trip.special_notes), planning->'specialNotes'),
    'constraints', planning->'constraints',
    'explicitRequirements', planning->'explicitRequirements'
  );
  if current_intent is distinct from (proposal.expected_intent_snapshot - 'planning') then raise exception using errcode = '40001', message = 'INTENT_CHANGE_INTENT_STALE'; end if;
  if current_intent->'travelers' is distinct from proposal.expected_traveler_snapshot then raise exception using errcode = '40001', message = 'INTENT_CHANGE_TRAVELERS_STALE'; end if;
  if coalesce(trip.metadata, '{}'::jsonb)->'generation' is distinct from proposal.expected_generation_snapshot->'generation' then raise exception using errcode = '40001', message = 'INTENT_CHANGE_GENERATION_STALE'; end if;

  select jsonb_build_object('bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'booking_status', b.booking_status, 'traveler_confirmed', b.traveler_confirmed, 'updated_at_epoch', extract(epoch from b.updated_at)::bigint, 'superseded_by_booking_id', b.superseded_by_booking_id) order by b.id) from public.roamly_bookings b where b.user_id = auth.uid() and b.trip_id = trip.id and b.superseded_by_booking_id is null), '[]'::jsonb)) into current_booking;
  if current_booking is distinct from proposal.expected_booking_snapshot then raise exception using errcode = '40001', message = 'INTENT_CHANGE_BOOKINGS_STALE'; end if;

  insert into public.roamly_trips (user_id, title, destination, destination_name, destination_city, destination_country, destination_region, origin, start_date, end_date, days_count, budget_amount, budget_currency, travel_style, interests, accommodation_preference, transportation_preference, special_notes, status, itinerary_status, itinerary_locked, itinerary_payment_status, tracking_unlocked, metadata)
  values (trip.user_id, coalesce(trip.title, 'Roamly trip') || ' · updated travelers & preferences', current_source->>'destination', current_source->>'destination', current_source->>'destinationCity', current_source->>'destinationCountry', current_source->>'destinationRegion', current_source->>'origin', trip.start_date, trip.end_date, trip.days_count, trip.budget_amount, trip.budget_currency, proposal.requested_intent_snapshot->>'travelStyle', coalesce(array(select jsonb_array_elements_text(proposal.requested_intent_snapshot->'interests')), '{}'::text[]), proposal.requested_intent_snapshot->>'accommodationPreference', proposal.requested_intent_snapshot->>'transportationPreference', proposal.requested_intent_snapshot->>'specialNotes', 'draft', 'draft', false, 'free', false, jsonb_build_object('planning', proposal.requested_intent_snapshot->'planning', 'intent_change_original_trip_id', trip.id, 'intent_change_proposal_id', proposal.id))
  returning id into successor_id;
  update public.roamly_customer_trip_intent_changes set successor_trip_id = successor_id, status = 'generating', reserved_at = now() where id = proposal.id;
  return jsonb_build_object('status', 'generating', 'proposalId', proposal.id, 'successorTripId', successor_id, 'idempotent', false);
end;
$$;

create function public.roamly_complete_customer_trip_intent_change(p_proposal_id uuid, p_user_id uuid, p_successor_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proposal public.roamly_customer_trip_intent_changes;
  successor public.roamly_trips;
  original public.roamly_trips;
  original_itinerary public.roamly_itineraries;
  current_booking jsonb;
  planning jsonb;
  current_source jsonb;
  current_intent jsonb;
begin
  select * into proposal from public.roamly_customer_trip_intent_changes where id = p_proposal_id and user_id = p_user_id for update;
  if proposal.status = 'applied' then return jsonb_build_object('status','already_applied','successorTripId',proposal.successor_trip_id); end if;
  select * into successor from public.roamly_trips where id = p_successor_trip_id and user_id = p_user_id for update;
  if proposal.id is null or successor.id is null or proposal.successor_trip_id <> successor.id or successor.status not in ('generated','locked') then raise exception using errcode = '40001', message = 'INTENT_CHANGE_SUCCESSOR_NOT_READY'; end if;
  select * into original from public.roamly_trips where id = proposal.original_trip_id and user_id = p_user_id for update;
  select * into original_itinerary from public.roamly_itineraries where trip_id = original.id and user_id = p_user_id for update;
  planning := coalesce(original.metadata, '{}'::jsonb)->'planning';
  current_source := jsonb_build_object('destination', coalesce(original.destination, planning->>'destination'), 'destinationCity', coalesce(original.destination_city, planning->>'destinationCity'), 'destinationCountry', coalesce(original.destination_country, planning->>'destinationCountry'), 'destinationRegion', coalesce(original.destination_region, planning->>'destinationRegion'), 'origin', coalesce(original.origin, planning->>'origin'), 'startDate', original.start_date::text, 'endDate', original.end_date::text, 'daysCount', coalesce(original.days_count, (planning->>'daysCount')::integer), 'budgetAmount', coalesce(original.budget_amount, nullif(planning->>'budgetAmount','')::numeric, nullif(planning->>'budget_amount','')::numeric, nullif(planning->>'budget_total','')::numeric), 'budgetCurrency', coalesce(original.budget_currency, planning->>'budgetCurrency'), 'latestPriceDiscoveryId', original.latest_price_discovery_id);
  current_intent := jsonb_build_object('travelersCount', original.travelers_count, 'travelers', coalesce(planning->'travelers', jsonb_build_object('adults', 1, 'children', 0, 'infants', 0)), 'rooms', coalesce((planning->>'rooms')::integer, 1), 'bedPreference', coalesce(planning->>'bedPreference', 'No preference'), 'travelStyle', coalesce(original.travel_style, planning->>'travelStyle', 'Balanced'), 'interests', case when coalesce(array_length(original.interests, 1), 0) > 0 then to_jsonb(original.interests) else coalesce(planning->'interests', '[]'::jsonb) end, 'pace', coalesce(planning->>'pace', 'Balanced'), 'walkingTolerance', coalesce(planning->>'walkingTolerance', 'Medium'), 'accommodationPreference', coalesce(original.accommodation_preference, planning->>'accommodationPreference', 'Not sure'), 'transportationPreference', coalesce(original.transportation_preference, planning->>'transportationPreference', 'Mixed'), 'accessibilityNeeds', planning->'accessibilityNeeds', 'dietaryPreference', planning->'dietaryPreference', 'specialNotes', coalesce(to_jsonb(original.special_notes), planning->'specialNotes'), 'constraints', planning->'constraints', 'explicitRequirements', planning->'explicitRequirements');
  if original.id is null or original.status is distinct from proposal.expected_trip_status or original_itinerary.id is distinct from proposal.original_itinerary_id or original_itinerary.repair_revision is distinct from proposal.expected_revision or public.roamly_itinerary_content_hash(original_itinerary.full_json) is distinct from proposal.expected_content_hash or current_source is distinct from proposal.expected_source_snapshot or current_intent is distinct from (proposal.expected_intent_snapshot - 'planning') then raise exception using errcode = '40001', message = 'INTENT_CHANGE_SOURCE_CHANGED'; end if;
  if successor.travelers_count is distinct from nullif(proposal.requested_intent_snapshot->>'travelersCount','')::integer or successor.travel_style is distinct from proposal.requested_intent_snapshot->>'travelStyle' or successor.accommodation_preference is distinct from proposal.requested_intent_snapshot->>'accommodationPreference' or successor.transportation_preference is distinct from proposal.requested_intent_snapshot->>'transportationPreference' then raise exception using errcode = '40001', message = 'INTENT_CHANGE_SUCCESSOR_INTENT_CHANGED'; end if;
  select jsonb_build_object('bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'booking_status', b.booking_status, 'traveler_confirmed', b.traveler_confirmed, 'updated_at_epoch', extract(epoch from b.updated_at)::bigint, 'superseded_by_booking_id', b.superseded_by_booking_id) order by b.id) from public.roamly_bookings b where b.user_id = p_user_id and b.trip_id = original.id and b.superseded_by_booking_id is null), '[]'::jsonb)) into current_booking;
  if current_booking is distinct from proposal.expected_booking_snapshot then raise exception using errcode = '40001', message = 'INTENT_CHANGE_BOOKINGS_CHANGED'; end if;
  update public.roamly_trips set status = 'archived', itinerary_status = 'locked' where id = original.id and user_id = p_user_id and status in ('generated','locked','planned');
  update public.roamly_customer_trip_intent_changes set status = 'applied', applied_at = now(), completed_at = now(), successor_itinerary_id = (select id from public.roamly_itineraries where trip_id = successor.id and user_id = p_user_id limit 1), result = jsonb_build_object('successorTripId', successor.id) where id = proposal.id;
  return jsonb_build_object('status','applied','successorTripId',successor.id);
end;
$$;

create function public.roamly_fail_customer_trip_intent_change(p_proposal_id uuid, p_user_id uuid, p_successor_trip_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.roamly_trips set status = 'archived', itinerary_status = 'draft' where id = p_successor_trip_id and user_id = p_user_id and status in ('draft','generating','preview');
  update public.roamly_customer_trip_intent_changes set status = 'failed', failure_reason = left(coalesce(p_reason,'GENERATION_FAILED'), 500), result = jsonb_build_object('error', left(coalesce(p_reason,'GENERATION_FAILED'), 500)) where id = p_proposal_id and user_id = p_user_id and status in ('reserved','generating');
  return jsonb_build_object('status','failed');
end;
$$;

revoke all on function public.roamly_reserve_customer_trip_intent_change(uuid,uuid) from public, anon;
grant execute on function public.roamly_reserve_customer_trip_intent_change(uuid,uuid) to authenticated, service_role;
revoke all on function public.roamly_complete_customer_trip_intent_change(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.roamly_complete_customer_trip_intent_change(uuid,uuid,uuid) to service_role;
revoke all on function public.roamly_fail_customer_trip_intent_change(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.roamly_fail_customer_trip_intent_change(uuid,uuid,uuid,text) to service_role;
