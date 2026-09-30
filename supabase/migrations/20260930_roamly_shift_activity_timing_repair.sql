-- Flight-aware automatic re-timing (Bet 2).
-- New repair operation SHIFT_ACTIVITY_TIMING: shifts downstream live_timeline
-- items by a provider-validated delay delta. Follows the V1 verified-repair
-- pattern: optimistic concurrency (expected_revision, content hash, event
-- fingerprint, source booking updated_at) + atomic RPC apply + verification.
-- Additive and legacy-safe: REMOVE_OPTIONAL_ACTIVITY behavior is unchanged.

-- 1) Allow the new operation type.
alter table public.companion_repair_proposals
  drop constraint if exists companion_repair_proposals_operation_check;

alter table public.companion_repair_proposals
  add constraint companion_repair_proposals_operation_check
    check (operation is null or operation in ('REMOVE_OPTIONAL_ACTIVITY', 'SHIFT_ACTIVITY_TIMING'));

-- 2) Relax the V1 field gate: SHIFT_ACTIVITY_TIMING needs the concurrency
--    evidence but targets a list of items (stored in proposed_changes_json),
--    not a single target_day_id/conflict_id/target_item_id triple.
alter table public.companion_repair_proposals
  drop constraint if exists companion_repair_proposals_v1_fields_check;

alter table public.companion_repair_proposals
  add constraint companion_repair_proposals_v1_fields_check
    check (
      operation is null
      or (
        itinerary_id is not null
        and expected_revision is not null
        and expected_content_hash is not null
        and length(btrim(expected_content_hash)) > 0
        and expected_event_fingerprint is not null
        and length(btrim(expected_event_fingerprint)) > 0
        and expected_source_booking_updated_at is not null
        and verification_status is not null
        and (
          operation = 'SHIFT_ACTIVITY_TIMING'
          or (
            target_day_id is not null
            and conflict_id is not null
            and target_item_id is not null
          )
        )
      )
    );

-- 3) Atomic shift apply. Lock order matches V1: proposal -> companion event
--    -> source booking -> itinerary. Idempotent: re-apply returns
--    already_applied. Callable by the owning user (auth.uid) or by
--    service_role (scheduled monitor auto-apply); service_role calls are
--    scoped to the proposal row the pipeline just created.
create or replace function public.roamly_apply_shift_activity_timing(
  p_proposal_id uuid,
  p_trip_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.companion_repair_proposals%rowtype;
  companion_event public.companion_events%rowtype;
  source_event public.booking_change_events%rowtype;
  source_booking public.roamly_bookings%rowtype;
  itinerary public.roamly_itineraries%rowtype;
  v_user_id uuid;
  v_is_service boolean;
  shift jsonb;
  shifts_applied integer := 0;
  day jsonb;
  item jsonb;
  next_day jsonb;
  next_days jsonb := '[]'::jsonb;
  next_timeline jsonb;
  next_json jsonb;
  v_item_id text;
  v_day_id text;
  v_start_key text;
  v_end_key text;
  v_before_start text;
  v_before_end text;
  v_after_start text;
  v_after_end text;
  v_shift_minutes integer;
  v_current_start text;
  v_current_end text;
  v_status text;
  v_state text;
  current_hash text;
  next_revision bigint;
begin
  v_is_service := coalesce(auth.jwt()->>'role', '') = 'service_role';

  if auth.uid() is null and not v_is_service then
    raise exception using errcode = '42501', message = 'SHIFT_REPAIR_UNAUTHORIZED';
  end if;

  select * into proposal
  from public.companion_repair_proposals
  where id = p_proposal_id
    and trip_id = p_trip_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'COMPANION_REPAIR_NOT_FOUND';
  end if;

  if auth.uid() is not null and proposal.user_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'COMPANION_REPAIR_NOT_FOUND';
  end if;

  v_user_id := proposal.user_id;

  if proposal.status = 'applied' then
    return jsonb_build_object(
      'status', 'already_applied',
      'proposal_id', proposal.id,
      'revision', proposal.applied_revision,
      'content_hash', proposal.applied_content_hash,
      'verification', coalesce(proposal.verification_status, 'pending')
    );
  end if;

  -- The pipeline may only auto-apply proposals that do not require approval.
  if proposal.status = 'proposed' and coalesce(proposal.requires_approval, false) then
    raise exception using errcode = '40901', message = 'COMPANION_REPAIR_NOT_APPROVED';
  end if;

  if proposal.status not in ('proposed', 'approved') then
    raise exception using errcode = '40901', message = 'COMPANION_REPAIR_NOT_APPROVED';
  end if;

  if proposal.operation <> 'SHIFT_ACTIVITY_TIMING'
     or proposal.itinerary_id is null
     or proposal.expected_revision is null
     or proposal.expected_content_hash is null
     or proposal.expected_event_fingerprint is null
     or proposal.expected_source_booking_updated_at is null
     or jsonb_typeof(coalesce(proposal.proposed_changes_json, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_NOT_REPAIRABLE';
  end if;

  if not exists (
    select 1 from public.roamly_trips
    where id = p_trip_id and user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'TRIP_NOT_OWNED';
  end if;

  if not exists (
    select 1 from public.roamly_trips
    where id = p_trip_id
      and user_id = v_user_id
      and (itinerary_locked = true or itinerary_generated_at is not null)
  ) then
    raise exception using errcode = '22023', message = 'ITINERARY_NOT_REPAIRABLE';
  end if;

  select * into companion_event
  from public.companion_events
  where id = proposal.companion_event_id
    and trip_id = p_trip_id
    and user_id = v_user_id
  for share;

  if not found
     or companion_event.event_type not in ('flight_delayed', 'flight_time_changed')
     or companion_event.source_booking_id is null
     or companion_event.event_fingerprint <> proposal.expected_event_fingerprint
     or companion_event.status not in ('processing', 'proposed') then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_EVENT_NOT_SUPPORTED';
  end if;

  select * into source_event
  from public.booking_change_events
  where booking_id = companion_event.source_booking_id
    and trip_id = p_trip_id
    and user_id = v_user_id
    and event_type = companion_event.event_type
    and event_fingerprint = proposal.expected_event_fingerprint
    and processed_at is not null
  for share;

  if not found then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_EVENT_NOT_CURRENT';
  end if;

  select * into source_booking
  from public.roamly_bookings
  where id = companion_event.source_booking_id
    and trip_id = p_trip_id
    and user_id = v_user_id
    and booking_type = 'flight'
    and booking_status in ('booked', 'paid', 'reserved')
    and updated_at = proposal.expected_source_booking_updated_at
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_SOURCE_BOOKING_NOT_CONFIRMED';
  end if;

  if exists (
    select 1
    from public.booking_change_events newer
    where newer.booking_id = source_booking.id
      and newer.trip_id = p_trip_id
      and newer.user_id = v_user_id
      and newer.event_type in ('flight_delayed', 'flight_time_changed', 'flight_cancelled')
      and (
        newer.detected_at > source_event.detected_at
        or (
          newer.detected_at = source_event.detected_at
          and newer.created_at > source_event.created_at
        )
        or (
          newer.detected_at = source_event.detected_at
          and newer.created_at = source_event.created_at
          and newer.id <> source_event.id
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_EVENT_SUPERSEDED';
  end if;

  select * into itinerary
  from public.roamly_itineraries
  where id = proposal.itinerary_id
    and trip_id = p_trip_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'ITINERARY_NOT_FOUND';
  end if;

  current_hash := public.roamly_itinerary_content_hash(itinerary.full_json);

  if itinerary.repair_revision <> proposal.expected_revision
     or current_hash <> proposal.expected_content_hash then
    raise exception using errcode = '40001', message = 'STALE_ITINERARY_STATE';
  end if;

  if jsonb_typeof(itinerary.full_json->'daily_itinerary') <> 'array' then
    raise exception using errcode = '22023', message = 'ITINERARY_NOT_REPAIRABLE';
  end if;

  for shift in
    select value from jsonb_array_elements(proposal.proposed_changes_json)
  loop
    if shift->>'action_type' <> 'SHIFT_ACTIVITY_TIMING' then
      continue;
    end if;

    v_item_id := shift#>>'{after,item_id}';
    v_day_id := shift#>>'{after,day_id}';
    v_start_key := shift#>>'{before,start_key}';
    v_end_key := shift#>>'{before,end_key}';
    v_before_start := shift#>>'{before,start}';
    v_before_end := shift#>>'{before,end}';
    v_after_start := shift#>>'{after,new_start}';
    v_after_end := shift#>>'{after,new_end}';
    v_shift_minutes := nullif(shift#>>'{after,shift_minutes}', '')::integer;

    if v_item_id is null or v_day_id is null
       or v_start_key is null or v_before_start is null
       or v_after_start is null or v_shift_minutes is null
       or v_shift_minutes = 0 then
      raise exception using errcode = '22023', message = 'COMPANION_SHIFT_PLAN_INVALID';
    end if;

    if v_start_key not in ('startTime', 'start_time')
       or (v_end_key is not null and v_end_key not in ('endTime', 'end_time')) then
      raise exception using errcode = '22023', message = 'COMPANION_SHIFT_PLAN_INVALID';
    end if;

    next_days := '[]'::jsonb;

    for day in
      select value from jsonb_array_elements(itinerary.full_json->'daily_itinerary')
    loop
      next_day := day;

      if day->>'day_id' = v_day_id then
        next_timeline := '[]'::jsonb;

        for item in
          select value from jsonb_array_elements(coalesce(day->'live_timeline', '[]'::jsonb))
        loop
          if item->>'item_id' = v_item_id then
            -- Never shift an activity that already started, finished, or was
            -- skipped: the traveler lived it, the plan did not.
            v_status := lower(coalesce(item->>'status', ''));
            v_state := lower(coalesce(item->>'state', ''));
            if v_status in ('started', 'in_progress', 'completed', 'done', 'skipped', 'missed', 'checked_in', 'cancelled')
               or v_state in ('started', 'in_progress', 'completed', 'done', 'skipped', 'missed', 'checked_in', 'cancelled') then
              raise exception using errcode = '22023', message = 'COMPANION_SHIFT_TARGET_NOT_SHIFTABLE';
            end if;

            -- Booking-anchored items keep reservation truth; the plan never
            -- invents new times for them.
            if item ? 'booking' or item ? 'anchor_id' then
              raise exception using errcode = '22023', message = 'COMPANION_SHIFT_TARGET_PROTECTED';
            end if;

            -- Compare-and-set: the item must still carry the exact times the
            -- proposal was built from.
            v_current_start := item->>v_start_key;
            if v_current_start is distinct from v_before_start then
              raise exception using errcode = '40001', message = 'STALE_SHIFT_TARGET';
            end if;

            if v_end_key is not null then
              v_current_end := item->>v_end_key;
              if v_current_end is distinct from v_before_end then
                raise exception using errcode = '40001', message = 'STALE_SHIFT_TARGET';
              end if;
              item := jsonb_set(item, array[v_end_key], to_jsonb(v_after_end), true);
            end if;

            item := jsonb_set(item, array[v_start_key], to_jsonb(v_after_start), true);
            item := jsonb_set(item, '{retimed_by_event}', to_jsonb(proposal.expected_event_fingerprint), true);
            item := jsonb_set(item, '{retimed_minutes}', to_jsonb(v_shift_minutes), true);
            item := jsonb_set(item, '{retimed_at}', to_jsonb(now()::text), true);

            shifts_applied := shifts_applied + 1;
          end if;

          next_timeline := next_timeline || jsonb_build_array(item);
        end loop;

        next_day := jsonb_set(next_day, '{live_timeline}', next_timeline, true);
      end if;

      next_days := next_days || jsonb_build_array(next_day);
    end loop;

    -- Rebuild the working copy from the shifted days for the next shift.
    itinerary.full_json := jsonb_set(itinerary.full_json, '{daily_itinerary}', next_days, true);
  end loop;

  if shifts_applied = 0 then
    raise exception using errcode = '22023', message = 'COMPANION_SHIFT_NO_TARGETS_APPLIED';
  end if;

  next_json := itinerary.full_json;
  -- The itinerary row is locked FOR UPDATE above, so the local revision is
  -- current; bump it exactly once for the whole shift batch.
  next_revision := itinerary.repair_revision + 1;

  update public.roamly_itineraries
  set full_json = next_json,
      repair_revision = next_revision
  where id = itinerary.id;

  update public.companion_repair_proposals
  set status = 'applied',
      applied_at = now(),
      applied_revision = next_revision,
      applied_content_hash = public.roamly_itinerary_content_hash(next_json),
      verification_status = 'pending',
      verified_at = null,
      updated_at = now()
  where id = proposal.id;

  return jsonb_build_object(
    'status', 'applied',
    'proposal_id', proposal.id,
    'revision', next_revision,
    'content_hash', public.roamly_itinerary_content_hash(next_json),
    'verification', 'pending',
    'shifts_applied', shifts_applied
  );
end;
$$;

revoke all on function public.roamly_apply_shift_activity_timing(uuid, uuid) from public;
revoke all on function public.roamly_apply_shift_activity_timing(uuid, uuid) from anon;
grant execute on function public.roamly_apply_shift_activity_timing(uuid, uuid) to authenticated;
grant execute on function public.roamly_apply_shift_activity_timing(uuid, uuid) to service_role;
