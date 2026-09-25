-- Preserve canonical companion inputs when date/destination changes reserve a
-- successor. Patch only the two reservation functions, retaining their
-- deployed bodies and inserting the copy directly after successor creation.
-- Any unexpected function-body drift aborts this migration rather than
-- silently installing an incomplete change.
do $migration$
declare
  function_signature regprocedure;
  function_definition text;
  insert_anchor text := 'returning id into successor_id;';
  replacement text := $copy$
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
  order by traveler.traveler_order;$copy$;
begin
  foreach function_signature in array array[
    'public.roamly_reserve_customer_trip_date_change(uuid,uuid)'::regprocedure,
    'public.roamly_reserve_customer_trip_destination_change(uuid,uuid)'::regprocedure
  ] loop
    function_definition := pg_get_functiondef(function_signature);
    if length(function_definition) - length(replace(function_definition, insert_anchor, ''))
       <> length(insert_anchor) then
      raise exception 'Expected exactly one successor insert anchor in %', function_signature;
    end if;
    execute replace(function_definition, insert_anchor, replacement);
  end loop;
end;
$migration$;
