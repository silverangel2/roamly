-- Verified In-Trip Disruption Repair V1.
-- Additive, legacy-safe persistence for one bounded optional-activity removal.
-- Apply lock order: proposal -> companion event -> source booking -> itinerary.

alter table public.companion_repair_proposals
  add column if not exists itinerary_id uuid,
  add column if not exists operation text,
  add column if not exists target_day_id uuid,
  add column if not exists conflict_id uuid,
  add column if not exists target_item_id uuid,
  add column if not exists expected_revision bigint,
  add column if not exists expected_content_hash text,
  add column if not exists expected_event_fingerprint text,
  add column if not exists expected_source_booking_updated_at timestamptz,
  add column if not exists applied_revision bigint,
  add column if not exists applied_content_hash text,
  add column if not exists verification_status text,
  add column if not exists verified_at timestamptz;

alter table public.companion_repair_proposals
  add constraint companion_repair_proposals_itinerary_fk
    foreign key (itinerary_id)
    references public.roamly_itineraries(id)
    on delete cascade,
  add constraint companion_repair_proposals_operation_check
    check (operation is null or operation = 'REMOVE_OPTIONAL_ACTIVITY'),
  add constraint companion_repair_proposals_expected_revision_check
    check (expected_revision is null or expected_revision >= 0),
  add constraint companion_repair_proposals_applied_revision_check
    check (applied_revision is null or applied_revision >= 0),
  add constraint companion_repair_proposals_verification_status_check
    check (verification_status is null or verification_status in ('pending', 'resolved', 'still_affected', 'uncertain')),
  add constraint companion_repair_proposals_v1_fields_check
    check (
      operation is null
      or (
        itinerary_id is not null
        and target_day_id is not null
        and conflict_id is not null
        and target_item_id is not null
        and expected_revision is not null
        and expected_content_hash is not null
        and length(btrim(expected_content_hash)) > 0
        and expected_event_fingerprint is not null
        and length(btrim(expected_event_fingerprint)) > 0
        and expected_source_booking_updated_at is not null
        and verification_status is not null
      )
    ),
  add constraint companion_repair_proposals_v1_applied_state_check
    check (
      operation is null
      or status <> 'applied'
      or (
        applied_revision is not null
        and applied_content_hash is not null
        and length(btrim(applied_content_hash)) > 0
        and applied_at is not null
      )
    ),
  add constraint companion_repair_proposals_v1_verification_check
    check (
      operation is null
      or (
        verification_status is null
        and verified_at is null
      )
      or (
        (
          verification_status = 'pending'
          and status in ('awaiting_approval', 'approved', 'applying', 'applied')
          and verified_at is null
          and (
            status <> 'applied'
            or (
              applied_revision is not null
              and applied_content_hash is not null
              and applied_at is not null
            )
          )
        )
        or (
          verification_status in ('resolved', 'still_affected', 'uncertain')
          and status = 'applied'
          and applied_revision is not null
          and applied_content_hash is not null
          and applied_at is not null
          and verified_at is not null
        )
      )
    );

create index if not exists companion_repair_proposals_itinerary_revision_idx
  on public.companion_repair_proposals (itinerary_id, expected_revision, status);

-- Serialize authoritative booking-change event creation with repair apply.
-- The repair RPC takes the same source booking row FOR UPDATE.
create or replace function public.roamly_lock_booking_change_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.roamly_bookings
  where id = new.booking_id
  for share;
  return new;
end;
$$;

drop trigger if exists booking_change_events_source_lock
  on public.booking_change_events;

create trigger booking_change_events_source_lock
before insert or update of booking_id on public.booking_change_events
for each row execute function public.roamly_lock_booking_change_source();

revoke all on function public.roamly_lock_booking_change_source() from public;
revoke all on function public.roamly_lock_booking_change_source() from authenticated;
revoke all on function public.roamly_lock_booking_change_source() from anon;
grant execute on function public.roamly_lock_booking_change_source() to service_role;

create or replace function public.roamly_apply_verified_companion_repair(
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
  day jsonb;
  item jsonb;
  next_day jsonb;
  next_days jsonb := '[]'::jsonb;
  next_timeline jsonb;
  next_json jsonb;
  target_day_matches integer := 0;
  target_item_matches integer := 0;
  impact_target_matches integer := 0;
  target_found boolean := false;
  current_hash text;
  next_revision bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'PLANNING_REPAIR_UNAUTHORIZED';
  end if;

  select * into proposal
  from public.companion_repair_proposals
  where id = p_proposal_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'COMPANION_REPAIR_NOT_FOUND';
  end if;

  if proposal.status = 'applied' then
    return jsonb_build_object(
      'status', 'already_applied',
      'proposal_id', proposal.id,
      'revision', proposal.applied_revision,
      'content_hash', proposal.applied_content_hash,
      'verification', coalesce(proposal.verification_status, 'pending')
    );
  end if;

  if proposal.status <> 'approved' then
    raise exception using errcode = '40901', message = 'COMPANION_REPAIR_NOT_APPROVED';
  end if;

  if proposal.operation <> 'REMOVE_OPTIONAL_ACTIVITY'
     or proposal.itinerary_id is null
     or proposal.target_day_id is null
     or proposal.conflict_id is null
     or proposal.target_item_id is null
     or proposal.expected_revision is null
     or proposal.expected_content_hash is null
     or proposal.expected_event_fingerprint is null
     or proposal.expected_source_booking_updated_at is null then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_NOT_REPAIRABLE';
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

  select * into companion_event
  from public.companion_events
  where id = proposal.companion_event_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
  for share;

  if not found
     or companion_event.event_type not in ('flight_delayed', 'flight_time_changed')
     or companion_event.source_booking_id is null
     or companion_event.event_fingerprint <> proposal.expected_event_fingerprint
     or companion_event.status not in ('processing', 'proposed') then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_EVENT_NOT_SUPPORTED';
  end if;

  if not exists (
    select 1
    from public.booking_change_events
    where booking_id = companion_event.source_booking_id
      and trip_id = p_trip_id
      and user_id = auth.uid()
      and event_type = companion_event.event_type
      and event_fingerprint = proposal.expected_event_fingerprint
      and processed_at is not null
  ) then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_EVENT_NOT_CURRENT';
  end if;

  select * into source_event
  from public.booking_change_events
  where booking_id = companion_event.source_booking_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
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
    and user_id = auth.uid()
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
      and newer.user_id = auth.uid()
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

  select count(*) into impact_target_matches
  from public.companion_impact_results impact
  cross join lateral jsonb_array_elements(impact.affected_items_json) affected
  where impact.id = proposal.impact_result_id
    and impact.companion_event_id = proposal.companion_event_id
    and impact.trip_id = p_trip_id
    and impact.user_id = auth.uid()
    and affected->>'day_id' = proposal.target_day_id::text
    and affected->>'item_id' = proposal.target_item_id::text
    and affected->>'conflict_id' = proposal.conflict_id::text
    and affected->>'routing_status' = 'INFEASIBLE';

  if impact_target_matches <> 1 then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_IMPACT_TARGET_NOT_PROVEN';
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

  current_hash := public.roamly_itinerary_content_hash(itinerary.full_json);

  if itinerary.repair_revision <> proposal.expected_revision
     or current_hash <> proposal.expected_content_hash then
    raise exception using errcode = '40001', message = 'STALE_ITINERARY_STATE';
  end if;

  if jsonb_typeof(itinerary.full_json->'daily_itinerary') <> 'array' then
    raise exception using errcode = '22023', message = 'ITINERARY_NOT_REPAIRABLE';
  end if;

  for day in
    select value from jsonb_array_elements(itinerary.full_json->'daily_itinerary')
  loop
    if day->>'day_id' = proposal.target_day_id::text then
      target_day_matches := target_day_matches + 1;
    end if;

    for item in
      select value from jsonb_array_elements(coalesce(day->'live_timeline', '[]'::jsonb))
    loop
      if item->>'item_id' = proposal.target_item_id::text then
        target_item_matches := target_item_matches + 1;
      end if;
    end loop;
  end loop;

  if target_day_matches <> 1 then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_DAY_NOT_UNIQUE';
  end if;

  if target_item_matches <> 1 then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_TARGET_ID_NOT_UNIQUE';
  end if;

  for day in
    select value from jsonb_array_elements(itinerary.full_json->'daily_itinerary')
  loop
    next_day := day;

    if day->>'day_id' = proposal.target_day_id::text then
      if coalesce(day->>'conflict_id', '') <> proposal.conflict_id::text
         or coalesce(day->>'plan_status', '') <> 'conflict' then
        raise exception using errcode = '40001', message = 'STALE_COMPANION_REPAIR_CONFLICT';
      end if;

      next_timeline := '[]'::jsonb;

      for item in
        select value from jsonb_array_elements(coalesce(day->'live_timeline', '[]'::jsonb))
      loop
        if item->>'item_id' = proposal.target_item_id::text then
          if coalesce(item->>'conflict_id', '') <> proposal.conflict_id::text then
            raise exception using errcode = '40001', message = 'STALE_COMPANION_REPAIR_CONFLICT';
          end if;

          if coalesce(item->>'must_do', '') <> 'false'
             or coalesce(item->>'plan_role', '') not in ('supporting', 'alternative')
             or item ? 'booking'
             or item ? 'anchor_id'
             or coalesce(item->>'hard_required', 'false') <> 'false'
             or coalesce(item->>'is_hard_requirement', 'false') <> 'false'
             or coalesce(item->>'item_type', '') <> 'activity'
             or coalesce(item->>'routing_status', '') <> 'INFEASIBLE' then
            raise exception using errcode = '22023', message = 'COMPANION_REPAIR_TARGET_PROTECTED_OR_NOT_INFEASIBLE';
          end if;

          target_found := true;
        else
          next_timeline := next_timeline || jsonb_build_array(item);
        end if;
      end loop;

      if not target_found then
        raise exception using errcode = '22023', message = 'COMPANION_REPAIR_TARGET_NOT_FOUND';
      end if;

      next_day := jsonb_set(day, '{live_timeline}', next_timeline, true);
    end if;

    next_days := next_days || jsonb_build_array(next_day);
  end loop;

  if not target_found then
    raise exception using errcode = '22023', message = 'COMPANION_REPAIR_TARGET_NOT_FOUND';
  end if;

  next_json := jsonb_set(itinerary.full_json, '{daily_itinerary}', next_days, true);
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
    'verification', 'pending'
  );
end;
$$;

revoke all on function public.roamly_apply_verified_companion_repair(uuid, uuid) from public;
grant execute on function public.roamly_apply_verified_companion_repair(uuid, uuid) to authenticated;
