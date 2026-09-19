-- Reconcile only exact candidate-linked, still-unbooked recommendations when
-- an approved optional activity is removed. Budget aggregates remain intact:
-- the current JSON model has no per-expense identity for safe subtraction.

create or replace function public.roamly_apply_planning_repair(
  p_proposal_id uuid,
  p_trip_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.roamly_planning_repair_proposals%rowtype;
  itinerary public.roamly_itineraries%rowtype;
  day jsonb;
  item jsonb;
  suggestion jsonb;
  next_day jsonb;
  next_days jsonb := '[]'::jsonb;
  next_timeline jsonb;
  next_json jsonb;
  next_suggestions jsonb := '[]'::jsonb;
  target_item jsonb;
  target_candidate_id text;
  suggestion_status text;
  found_target boolean := false;
  target_match_count integer := 0;
  current_hash text;
  next_revision bigint;
begin
  select * into proposal
  from public.roamly_planning_repair_proposals
  where id = p_proposal_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PLANNING_REPAIR_NOT_FOUND';
  end if;

  if proposal.status = 'applied' then
    return jsonb_build_object(
      'status', 'already_applied',
      'proposal_id', proposal.id,
      'revision', proposal.applied_revision,
      'content_hash', proposal.applied_content_hash,
      'result', proposal.apply_result
    );
  end if;

  if proposal.status <> 'awaiting_approval' then
    raise exception using errcode = '40901', message = 'PLANNING_REPAIR_NOT_APPROVABLE';
  end if;

  select * into itinerary
  from public.roamly_itineraries
  where id = proposal.itinerary_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'ITINERARY_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.roamly_trips
    where id = p_trip_id and user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'TRIP_NOT_OWNED';
  end if;

  if not exists (
    select 1 from public.roamly_trips
    where id = p_trip_id
      and user_id = auth.uid()
      and (itinerary_locked = true or itinerary_generated_at is not null)
  ) then
    raise exception using errcode = '22023', message = 'ITINERARY_NOT_REPAIRABLE';
  end if;

  current_hash := public.roamly_itinerary_content_hash(itinerary.full_json);
  if itinerary.repair_revision <> proposal.expected_revision
     or current_hash <> proposal.expected_content_hash then
    update public.roamly_planning_repair_proposals
    set status = 'stale', updated_at = now(), apply_result = jsonb_build_object('reason', 'STALE_ITINERARY_STATE')
    where id = proposal.id;
    raise exception using errcode = '40001', message = 'STALE_ITINERARY_STATE';
  end if;

  if jsonb_typeof(itinerary.full_json->'daily_itinerary') <> 'array' then
    raise exception using errcode = '22023', message = 'ITINERARY_NOT_REPAIRABLE';
  end if;

  for day in select value from jsonb_array_elements(coalesce(itinerary.full_json->'daily_itinerary', '[]'::jsonb)) loop
    next_day := day;
    if day->>'day_id' = proposal.day_id::text then
      if coalesce(day->>'conflict_id', '') = '' then
        raise exception using errcode = '40001', message = 'STALE_REPAIR_CONFLICT';
      end if;
      if coalesce(day->>'plan_status', '') <> 'conflict' then
        raise exception using errcode = '22023', message = 'REPAIR_CONFLICT_NOT_PROVEN';
      end if;
      next_timeline := '[]'::jsonb;
      for item in select value from jsonb_array_elements(coalesce(day->'live_timeline', '[]'::jsonb)) loop
        if item->>'item_id' = proposal.target_item_id::text then
          if coalesce(item->>'conflict_id', '') <> proposal.conflict_id::text then
            raise exception using errcode = '40001', message = 'STALE_REPAIR_CONFLICT';
          end if;
          found_target := true;
          target_match_count := target_match_count + 1;
          if target_match_count > 1 then
            raise exception using errcode = '22023', message = 'REPAIR_TARGET_ID_NOT_UNIQUE';
          end if;
          if coalesce(item->>'must_do', 'false') = 'true'
             or item->>'plan_role' in ('protected_anchor', 'must_do')
             or item->'booking' is not null
             or nullif(item->>'booking_id', '') is not null
             or item->>'item_type' in ('flight', 'hotel', 'booking')
             or item->>'routing_status' <> 'INFEASIBLE'
             or item->>'plan_role' not in ('supporting', 'alternative') then
            raise exception using errcode = '22023', message = 'REPAIR_TARGET_PROTECTED_OR_NOT_INFEASIBLE';
          end if;
          target_item := item;
          target_candidate_id := nullif(trim(coalesce(item->>'candidateId', '')), '');
        else
          next_timeline := next_timeline || jsonb_build_array(item);
        end if;
      end loop;
      if not found_target then
        raise exception using errcode = '22023', message = 'REPAIR_TARGET_NOT_FOUND';
      end if;
      next_day := jsonb_set(day, '{live_timeline}', next_timeline, true);
    end if;
    next_days := next_days || jsonb_build_array(next_day);
  end loop;

  if not found_target then
    raise exception using errcode = '22023', message = 'REPAIR_CONFLICT_NOT_FOUND';
  end if;

  if target_candidate_id is not null then
    for suggestion in select value from jsonb_array_elements(coalesce(itinerary.full_json->'booking_suggestions', '[]'::jsonb)) loop
      if suggestion->>'candidateId' = target_candidate_id then
        suggestion_status := lower(coalesce(suggestion->>'booking_status', ''));
        if nullif(suggestion->>'booking_id', '') is not null
           or suggestion_status in ('confirmed', 'completed', 'detected', 'needs_confirmation', 'modified', 'cancelled', 'refunded', 'user_uploaded') then
          raise exception using errcode = '22023', message = 'REPAIR_TARGET_HAS_BOOKING_EVIDENCE';
        end if;
      end if;
    end loop;
    for suggestion in select value from jsonb_array_elements(coalesce(itinerary.full_json->'booking_suggestions', '[]'::jsonb)) loop
      if suggestion->>'candidateId' = target_candidate_id
         and nullif(suggestion->>'booking_id', '') is null
         and lower(coalesce(suggestion->>'booking_status', '')) in ('suggested', 'needs_booking') then
        continue;
      end if;
      next_suggestions := next_suggestions || jsonb_build_array(suggestion);
    end loop;
  else
    next_suggestions := coalesce(itinerary.full_json->'booking_suggestions', '[]'::jsonb);
  end if;

  next_json := jsonb_set(itinerary.full_json, '{daily_itinerary}', next_days, true);
  next_json := jsonb_set(next_json, '{booking_suggestions}', next_suggestions, true);
  next_revision := itinerary.repair_revision + 1;

  update public.roamly_itineraries
  set full_json = next_json,
      repair_revision = next_revision
  where id = itinerary.id;

  update public.roamly_planning_repair_proposals
  set status = 'applied',
      approved_at = coalesce(approved_at, now()),
      applied_at = now(),
      applied_revision = next_revision,
      applied_content_hash = public.roamly_itinerary_content_hash(next_json),
      apply_result = jsonb_build_object('database_apply', 'succeeded', 'verification', 'requires_application_recompute'),
      updated_at = now()
  where id = proposal.id;

  return jsonb_build_object(
    'status', 'applied',
    'proposal_id', proposal.id,
    'revision', next_revision,
    'content_hash', public.roamly_itinerary_content_hash(next_json),
    'verification', 'requires_application_recompute'
  );
end;
$$;

revoke all on function public.roamly_apply_planning_repair(uuid, uuid) from public;
grant execute on function public.roamly_apply_planning_repair(uuid, uuid) to authenticated;
