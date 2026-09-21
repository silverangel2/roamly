create table public.roamly_customer_trip_destination_changes (
  id uuid primary key default gen_random_uuid(),
  original_trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_itinerary_id uuid not null references public.roamly_itineraries(id) on delete cascade,
  requested_destination_snapshot jsonb not null,
  requested_destination_hash text not null,
  expected_destination_snapshot jsonb not null,
  expected_destination_hash text not null,
  expected_origin_snapshot jsonb not null default '{}'::jsonb,
  expected_trip_status text not null,
  expected_itinerary_status text,
  expected_revision bigint not null check (expected_revision >= 0),
  expected_content_hash text not null,
  expected_booking_snapshot jsonb not null default '{}'::jsonb,
  expected_budget_snapshot jsonb not null default '{}'::jsonb,
  expected_intent_snapshot jsonb not null default '{}'::jsonb,
  expected_intent_hash text not null,
  expected_price_discovery_id uuid,
  expected_generation_snapshot jsonb not null default '{}'::jsonb,
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
  check (jsonb_typeof(requested_destination_snapshot) = 'object'),
  check (jsonb_typeof(expected_destination_snapshot) = 'object'),
  check (jsonb_typeof(expected_booking_snapshot) = 'object'),
  check (jsonb_typeof(expected_intent_snapshot) = 'object')
);

create index roamly_customer_trip_destination_changes_trip_idx
  on public.roamly_customer_trip_destination_changes (original_trip_id, created_at desc);
create unique index roamly_customer_trip_destination_changes_open_uidx
  on public.roamly_customer_trip_destination_changes (original_trip_id, requested_destination_hash)
  where status in ('awaiting_approval','reserved','generating');

create trigger roamly_customer_trip_destination_changes_updated_at
before update on public.roamly_customer_trip_destination_changes
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_customer_trip_destination_changes enable row level security;
create policy "Roamly users read own customer trip destination changes"
  on public.roamly_customer_trip_destination_changes
  for select to authenticated using (user_id = auth.uid());
revoke all on public.roamly_customer_trip_destination_changes from anon, authenticated, public;
grant select on public.roamly_customer_trip_destination_changes to authenticated;
grant all on public.roamly_customer_trip_destination_changes to service_role;

create function public.roamly_reserve_customer_trip_destination_change(p_proposal_id uuid, p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proposal public.roamly_customer_trip_destination_changes;
  trip public.roamly_trips;
  itinerary public.roamly_itineraries;
  successor_id uuid;
  current_booking_snapshot jsonb;
  current_planning jsonb;
  current_destination_snapshot jsonb;
  current_origin_snapshot jsonb;
  current_planning_budget_amount numeric;
  current_planning_budget_source text;
begin
  select * into proposal
  from public.roamly_customer_trip_destination_changes
  where id = p_proposal_id and original_trip_id = p_trip_id and user_id = auth.uid()
  for update;
  if proposal.id is null then raise exception using errcode = '42501', message = 'DESTINATION_CHANGE_NOT_FOUND'; end if;
  if proposal.status in ('reserved','generating','applied') then
    return jsonb_build_object('status', proposal.status, 'proposalId', proposal.id, 'successorTripId', proposal.successor_trip_id, 'idempotent', true);
  end if;
  if proposal.status <> 'awaiting_approval' then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_NOT_APPLICABLE'; end if;

  select * into trip from public.roamly_trips where id = p_trip_id and user_id = auth.uid() for update;
  if trip.id is null or trip.status not in ('generated','locked','planned') or trip.status is distinct from proposal.expected_trip_status then
    raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_TRIP_NOT_ELIGIBLE';
  end if;
  if trip.start_date is null or trip.end_date is null or trip.end_date < trip.start_date then
    raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_DATES_INVALID';
  end if;
  select * into itinerary from public.roamly_itineraries where trip_id = trip.id and user_id = auth.uid() for update;
  if itinerary.id is null or itinerary.id <> proposal.original_itinerary_id then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_ITINERARY_CHANGED'; end if;
  if itinerary.repair_revision is distinct from proposal.expected_revision or public.roamly_itinerary_content_hash(itinerary.full_json) is distinct from proposal.expected_content_hash then
    raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_ITINERARY_STALE';
  end if;

  current_planning := coalesce(trip.metadata, '{}'::jsonb)->'planning';
  current_planning_budget_amount := case
    when (current_planning->>'budgetAmount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budgetAmount')::numeric > 0 then (current_planning->>'budgetAmount')::numeric
    when (current_planning->>'budget_amount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_amount')::numeric > 0 then (current_planning->>'budget_amount')::numeric
    when (current_planning->>'budget_total') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_total')::numeric > 0 then (current_planning->>'budget_total')::numeric
    else null
  end;
  current_planning_budget_source := case
    when (current_planning->>'budgetAmount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budgetAmount')::numeric > 0 then 'budgetAmount'
    when (current_planning->>'budget_amount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_amount')::numeric > 0 then 'budget_amount'
    when (current_planning->>'budget_total') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_total')::numeric > 0 then 'budget_total'
    else null
  end;
  current_destination_snapshot := jsonb_build_object(
    'value', coalesce(current_planning->'destinationPlace'->>'value', current_planning->'destinationPlace'->>'label', nullif(trip.destination, ''), nullif(trip.destination_name, ''), current_planning->>'destination'),
    'city', coalesce(current_planning->'destinationPlace'->>'city', nullif(trip.destination_city, ''), current_planning->>'destinationCity', current_planning->>'destination_city'),
    'region', coalesce(current_planning->'destinationPlace'->>'region', nullif(trip.destination_region, ''), current_planning->>'destinationRegion', current_planning->>'destination_region'),
    'country', coalesce(current_planning->'destinationPlace'->>'country', nullif(trip.destination_country, ''), current_planning->>'destinationCountry', current_planning->>'destination_country'),
    'placeId', coalesce(current_planning->'destinationPlace'->>'place_id', current_planning->>'destinationPlaceId', current_planning->>'destination_place_id'),
    'latitude', nullif(coalesce(current_planning->'destinationPlace'->>'latitude', current_planning->>'destinationLatitude', current_planning->>'destination_latitude'), '')::numeric,
    'longitude', nullif(coalesce(current_planning->'destinationPlace'->>'longitude', current_planning->>'destinationLongitude', current_planning->>'destination_longitude'), '')::numeric,
    'timezone', coalesce(current_planning->'destinationPlace'->>'timezone', current_planning->>'destinationTimezone', current_planning->>'destination_timezone'),
    'currency', upper(coalesce(current_planning->'destinationPlace'->>'currency', current_planning->>'destinationCurrency', current_planning->>'destination_currency')),
    'source', coalesce(current_planning->'destinationPlace'->>'source', 'structured_trip')
  );
  if current_destination_snapshot is distinct from proposal.expected_destination_snapshot then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_DESTINATION_STALE'; end if;
  current_origin_snapshot := jsonb_build_object(
    'origin', coalesce(trip.origin, current_planning->>'origin'),
    'originPlace', current_planning->'originPlace',
    'originPlaceId', coalesce(current_planning->>'originPlaceId', current_planning->>'origin_place_id'),
    'originCity', coalesce(current_planning->>'originCity', current_planning->>'origin_city'),
    'originRegion', coalesce(current_planning->>'originRegion', current_planning->>'origin_region'),
    'originCountry', coalesce(current_planning->>'originCountry', current_planning->>'origin_country'),
    'originLatitude', coalesce(current_planning->>'originLatitude', current_planning->>'origin_latitude'),
    'originLongitude', coalesce(current_planning->>'originLongitude', current_planning->>'origin_longitude')
  );
  if current_origin_snapshot is distinct from proposal.expected_origin_snapshot then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_ORIGIN_STALE'; end if;
  if trip.budget_amount is distinct from nullif(proposal.expected_budget_snapshot->>'rawTripAmount','')::numeric
     or trip.budget_currency is distinct from proposal.expected_budget_snapshot->>'rawTripCurrency'
     or current_planning_budget_amount is distinct from nullif(proposal.expected_budget_snapshot->>'planningBudgetAmount','')::numeric
     or current_planning_budget_source is distinct from proposal.expected_budget_snapshot->>'planningBudgetSource'
     or (case when trip.budget_amount is not null and trip.budget_amount > 0 then 'trip_column' when current_planning_budget_amount is not null then 'planning_metadata' else 'none' end) is distinct from proposal.expected_budget_snapshot->>'effectiveSource'
     or trip.latest_price_discovery_id is distinct from proposal.expected_price_discovery_id then
    raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_BUDGET_STALE';
  end if;
  if coalesce(trip.metadata, '{}'::jsonb)->'generation' is distinct from proposal.expected_generation_snapshot->'generation' then
    raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_GENERATION_STALE';
  end if;
  if trip.travelers_count is distinct from nullif(proposal.expected_intent_snapshot->>'travelersCount','')::integer
     or trip.travel_style is distinct from proposal.expected_intent_snapshot->>'travelStyle'
     or trip.accommodation_preference is distinct from proposal.expected_intent_snapshot->>'accommodationPreference'
     or trip.transportation_preference is distinct from proposal.expected_intent_snapshot->>'transportationPreference' then
    raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_INTENT_STALE';
  end if;

  select jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'booking_status', b.booking_status, 'traveler_confirmed', b.traveler_confirmed, 'updated_at_epoch', extract(epoch from b.updated_at)::bigint, 'superseded_by_booking_id', b.superseded_by_booking_id) order by b.id)
      from public.roamly_bookings b where b.user_id = auth.uid() and b.trip_id = trip.id and b.superseded_by_booking_id is null), '[]'::jsonb)
  ) into current_booking_snapshot;
  if current_booking_snapshot is distinct from proposal.expected_booking_snapshot then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_BOOKINGS_STALE'; end if;

  insert into public.roamly_trips (user_id, title, destination, destination_name, destination_city, destination_country, destination_region, origin, start_date, end_date, days_count, budget_amount, budget_currency, travel_style, interests, accommodation_preference, transportation_preference, special_notes, status, itinerary_status, itinerary_locked, itinerary_payment_status, tracking_unlocked, metadata)
  values (trip.user_id, coalesce(trip.title, 'Roamly trip') || ' · new destination', proposal.requested_destination_snapshot->>'value', proposal.requested_destination_snapshot->>'value', proposal.requested_destination_snapshot->>'city', proposal.requested_destination_snapshot->>'country', proposal.requested_destination_snapshot->>'region', trip.origin, trip.start_date, trip.end_date, trip.days_count, trip.budget_amount, trip.budget_currency, trip.travel_style, trip.interests, trip.accommodation_preference, trip.transportation_preference, trip.special_notes, 'draft', 'draft', false, 'free', false, jsonb_build_object('planning', proposal.expected_intent_snapshot->'planning', 'destination_change_original_trip_id', trip.id, 'destination_change_proposal_id', proposal.id))
  returning id into successor_id;
  update public.roamly_customer_trip_destination_changes set successor_trip_id = successor_id, status = 'generating', reserved_at = now() where id = proposal.id;
  return jsonb_build_object('status', 'generating', 'proposalId', proposal.id, 'successorTripId', successor_id, 'idempotent', false);
end;
$$;

create function public.roamly_complete_customer_trip_destination_change(p_proposal_id uuid, p_user_id uuid, p_successor_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proposal public.roamly_customer_trip_destination_changes;
  successor public.roamly_trips;
  original public.roamly_trips;
  original_itinerary public.roamly_itineraries;
  current_booking_snapshot jsonb;
  current_planning jsonb;
  current_planning_budget_amount numeric;
  current_planning_budget_source text;
begin
  select * into proposal from public.roamly_customer_trip_destination_changes where id = p_proposal_id and user_id = p_user_id for update;
  if proposal.status = 'applied' then return jsonb_build_object('status','already_applied','successorTripId',proposal.successor_trip_id); end if;
  select * into successor from public.roamly_trips where id = p_successor_trip_id and user_id = p_user_id for update;
  if proposal.id is null or successor.id is null or proposal.successor_trip_id <> successor.id or successor.status not in ('generated','locked') then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_SUCCESSOR_NOT_READY'; end if;
  select * into original from public.roamly_trips where id = proposal.original_trip_id and user_id = p_user_id for update;
  select * into original_itinerary from public.roamly_itineraries where trip_id = original.id and user_id = p_user_id for update;
  current_planning := coalesce(original.metadata, '{}'::jsonb)->'planning';
  current_planning_budget_amount := case
    when (current_planning->>'budgetAmount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budgetAmount')::numeric > 0 then (current_planning->>'budgetAmount')::numeric
    when (current_planning->>'budget_amount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_amount')::numeric > 0 then (current_planning->>'budget_amount')::numeric
    when (current_planning->>'budget_total') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_total')::numeric > 0 then (current_planning->>'budget_total')::numeric
    else null
  end;
  current_planning_budget_source := case
    when (current_planning->>'budgetAmount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budgetAmount')::numeric > 0 then 'budgetAmount'
    when (current_planning->>'budget_amount') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_amount')::numeric > 0 then 'budget_amount'
    when (current_planning->>'budget_total') ~ '^[0-9]+([.][0-9]+)?$' and (current_planning->>'budget_total')::numeric > 0 then 'budget_total'
    else null
  end;
  if original.id is null or original.status is distinct from proposal.expected_trip_status or original_itinerary.id is distinct from proposal.original_itinerary_id or original_itinerary.repair_revision is distinct from proposal.expected_revision or public.roamly_itinerary_content_hash(original_itinerary.full_json) is distinct from proposal.expected_content_hash or original.destination is distinct from proposal.expected_destination_snapshot->>'value' or original.destination_city is distinct from proposal.expected_destination_snapshot->>'city' or original.destination_country is distinct from proposal.expected_destination_snapshot->>'country' or original.start_date is null or original.end_date is null or original.end_date < original.start_date or original.budget_amount is distinct from nullif(proposal.expected_budget_snapshot->>'rawTripAmount','')::numeric or original.budget_currency is distinct from proposal.expected_budget_snapshot->>'rawTripCurrency' or current_planning_budget_amount is distinct from nullif(proposal.expected_budget_snapshot->>'planningBudgetAmount','')::numeric or current_planning_budget_source is distinct from proposal.expected_budget_snapshot->>'planningBudgetSource' or (case when original.budget_amount is not null and original.budget_amount > 0 then 'trip_column' when current_planning_budget_amount is not null then 'planning_metadata' else 'none' end) is distinct from proposal.expected_budget_snapshot->>'effectiveSource' or original.latest_price_discovery_id is distinct from proposal.expected_price_discovery_id or coalesce(original.metadata, '{}'::jsonb)->'generation' is distinct from proposal.expected_generation_snapshot->'generation' or original.travelers_count is distinct from nullif(proposal.expected_intent_snapshot->>'travelersCount','')::integer or original.travel_style is distinct from proposal.expected_intent_snapshot->>'travelStyle' then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_SOURCE_CHANGED'; end if;
  select jsonb_build_object('bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'booking_status', b.booking_status, 'traveler_confirmed', b.traveler_confirmed, 'updated_at_epoch', extract(epoch from b.updated_at)::bigint, 'superseded_by_booking_id', b.superseded_by_booking_id) order by b.id) from public.roamly_bookings b where b.user_id = p_user_id and b.trip_id = original.id and b.superseded_by_booking_id is null), '[]'::jsonb)) into current_booking_snapshot;
  if current_booking_snapshot is distinct from proposal.expected_booking_snapshot then raise exception using errcode = '40001', message = 'DESTINATION_CHANGE_BOOKINGS_CHANGED'; end if;
  update public.roamly_trips set status = 'archived', itinerary_status = 'locked' where id = original.id and user_id = p_user_id and status in ('generated','locked','planned');
  update public.roamly_customer_trip_destination_changes set status = 'applied', applied_at = now(), completed_at = now(), successor_itinerary_id = (select id from public.roamly_itineraries where trip_id = successor.id and user_id = p_user_id limit 1), result = jsonb_build_object('successorTripId', successor.id) where id = proposal.id;
  return jsonb_build_object('status','applied','successorTripId',successor.id);
end;
$$;

create function public.roamly_fail_customer_trip_destination_change(p_proposal_id uuid, p_user_id uuid, p_successor_trip_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.roamly_trips set status = 'archived', itinerary_status = 'draft' where id = p_successor_trip_id and user_id = p_user_id and status in ('draft','generating','preview');
  update public.roamly_customer_trip_destination_changes set status = 'failed', failure_reason = left(coalesce(p_reason,'GENERATION_FAILED'), 500), result = jsonb_build_object('error', left(coalesce(p_reason,'GENERATION_FAILED'), 500)) where id = p_proposal_id and user_id = p_user_id and status in ('reserved','generating');
  return jsonb_build_object('status','failed');
end;
$$;

revoke all on function public.roamly_reserve_customer_trip_destination_change(uuid,uuid) from public, anon;
grant execute on function public.roamly_reserve_customer_trip_destination_change(uuid,uuid) to authenticated, service_role;
revoke all on function public.roamly_complete_customer_trip_destination_change(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.roamly_complete_customer_trip_destination_change(uuid,uuid,uuid) to service_role;
revoke all on function public.roamly_fail_customer_trip_destination_change(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.roamly_fail_customer_trip_destination_change(uuid,uuid,uuid,text) to service_role;
