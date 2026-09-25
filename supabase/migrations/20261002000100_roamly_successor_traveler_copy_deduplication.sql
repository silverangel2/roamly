-- G-A14-01 forward correction: replace the two reservation functions with
-- their canonical definitions and exactly one companion-fact copy operation.
-- Function-definition only; this migration does not alter tables or rows.

create or replace function public.roamly_reserve_customer_trip_date_change(p_proposal_id uuid, p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proposal public.roamly_customer_trip_date_changes;
  trip public.roamly_trips;
  itinerary public.roamly_itineraries;
  successor_id uuid;
  current_booking_snapshot jsonb;
begin
  select * into proposal from public.roamly_customer_trip_date_changes where id = p_proposal_id and original_trip_id = p_trip_id and user_id = auth.uid() for update;
  if proposal.id is null then raise exception using errcode = '42501', message = 'DATE_CHANGE_NOT_FOUND'; end if;
  if proposal.status in ('reserved','generating','applied') then return jsonb_build_object('status', proposal.status, 'proposalId', proposal.id, 'successorTripId', proposal.successor_trip_id, 'idempotent', true); end if;
  if proposal.status <> 'awaiting_approval' then raise exception using errcode = '40001', message = 'DATE_CHANGE_NOT_APPLICABLE'; end if;
  select * into trip from public.roamly_trips where id = p_trip_id and user_id = auth.uid() for update;
  if trip.id is null or trip.status not in ('generated','locked','planned') or trip.status is distinct from proposal.expected_trip_status then raise exception using errcode = '40001', message = 'DATE_CHANGE_TRIP_NOT_ELIGIBLE'; end if;
  select * into itinerary from public.roamly_itineraries where trip_id = trip.id and user_id = auth.uid() for update;
  if itinerary.id is null or itinerary.id <> proposal.original_itinerary_id then raise exception using errcode = '40001', message = 'DATE_CHANGE_ITINERARY_CHANGED'; end if;
  if trip.start_date is distinct from proposal.expected_start_date or trip.end_date is distinct from proposal.expected_end_date or trip.updated_at is null then raise exception using errcode = '40001', message = 'DATE_CHANGE_DATES_STALE'; end if;
  if itinerary.repair_revision is distinct from proposal.expected_revision or public.roamly_itinerary_content_hash(itinerary.full_json) is distinct from proposal.expected_content_hash then raise exception using errcode = '40001', message = 'DATE_CHANGE_ITINERARY_STALE'; end if;
  select jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'booking_status',b.booking_status,'traveler_confirmed',b.traveler_confirmed,'updated_at_epoch',extract(epoch from b.updated_at)::bigint,'superseded_by_booking_id',b.superseded_by_booking_id) order by b.id) from public.roamly_bookings b where b.user_id = auth.uid() and b.trip_id = trip.id and b.superseded_by_booking_id is null), '[]'::jsonb)
  ) into current_booking_snapshot;
  if current_booking_snapshot is distinct from proposal.expected_booking_snapshot then raise exception using errcode = '40001', message = 'DATE_CHANGE_BOOKINGS_STALE'; end if;
  if nullif(proposal.intent_snapshot->>'destination','') is null then raise exception using errcode = '22023', message = 'DATE_CHANGE_DESTINATION_MISSING'; end if;
  insert into public.roamly_trips (user_id,title,destination,destination_name,destination_city,destination_country,destination_region,origin,start_date,end_date,days_count,budget_amount,budget_currency,travel_style,interests,accommodation_preference,transportation_preference,special_notes,status,itinerary_status,itinerary_locked,itinerary_payment_status,tracking_unlocked,metadata)
  values (trip.user_id, coalesce(trip.title, 'Roamly trip') || ' · new dates', proposal.intent_snapshot->>'destination', proposal.intent_snapshot->>'destinationName', proposal.intent_snapshot->>'destinationCity', proposal.intent_snapshot->>'destinationCountry', proposal.intent_snapshot->>'destinationRegion', proposal.intent_snapshot->>'origin', proposal.requested_start_date, proposal.requested_end_date, (proposal.requested_end_date - proposal.requested_start_date) + 1, nullif(proposal.intent_snapshot->>'budgetAmount','')::numeric, coalesce(proposal.intent_snapshot->>'budgetCurrency','CAD'), proposal.intent_snapshot->>'travelStyle', coalesce(array(select jsonb_array_elements_text(proposal.intent_snapshot->'interests')), '{}'), proposal.intent_snapshot->>'accommodationPreference', proposal.intent_snapshot->>'transportationPreference', proposal.intent_snapshot->>'specialNotes', 'draft', 'draft', false, 'free', false, jsonb_build_object('planning', proposal.intent_snapshot->'planning', 'date_change_original_trip_id', trip.id, 'date_change_proposal_id', proposal.id))
  returning id into successor_id;

  insert into public.roamly_trip_travelers
    (trip_id, traveler_order, role, traveler_type, passport_issuing_country)
  select successor_id, traveler.traveler_order, traveler.role,
         traveler.traveler_type, traveler.passport_issuing_country
  from public.roamly_trip_travelers traveler
  join public.roamly_trips source_trip
    on source_trip.id = traveler.trip_id
   and source_trip.user_id = trip.user_id
  where traveler.trip_id = trip.id
    and source_trip.id = trip.id
    and trip.user_id = auth.uid()
    and traveler.role = 'companion'
  order by traveler.traveler_order;

  update public.roamly_customer_trip_date_changes set successor_trip_id = successor_id, status = 'generating', reserved_at = now() where id = proposal.id;
  return jsonb_build_object('status','generating','proposalId',proposal.id,'successorTripId',successor_id,'idempotent',false);
end;
$$;

create or replace function public.roamly_reserve_customer_trip_destination_change(p_proposal_id uuid, p_trip_id uuid)
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

  insert into public.roamly_trip_travelers
    (trip_id, traveler_order, role, traveler_type, passport_issuing_country)
  select successor_id, traveler.traveler_order, traveler.role,
         traveler.traveler_type, traveler.passport_issuing_country
  from public.roamly_trip_travelers traveler
  join public.roamly_trips source_trip
    on source_trip.id = traveler.trip_id
   and source_trip.user_id = trip.user_id
  where traveler.trip_id = trip.id
    and source_trip.id = trip.id
    and trip.user_id = auth.uid()
    and traveler.role = 'companion'
  order by traveler.traveler_order;

  update public.roamly_customer_trip_destination_changes set successor_trip_id = successor_id, status = 'generating', reserved_at = now() where id = proposal.id;
  return jsonb_build_object('status', 'generating', 'proposalId', proposal.id, 'successorTripId', successor_id, 'idempotent', false);
end;
$$;
