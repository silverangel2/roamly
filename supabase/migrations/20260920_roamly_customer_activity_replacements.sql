-- Grounded customer-directed replacement remains separate from conflict repair.

alter table public.roamly_customer_itinerary_edits
  drop constraint if exists roamly_customer_itinerary_edits_operation_check;

alter table public.roamly_customer_itinerary_edits
  add constraint roamly_customer_itinerary_edits_operation_check
  check (operation in ('REMOVE_OPTIONAL_ACTIVITY', 'REPLACE_OPTIONAL_ACTIVITY'));

alter table public.roamly_customer_itinerary_edits
  add column if not exists replacement_candidate_id text,
  add column if not exists replacement_snapshot jsonb,
  add column if not exists replacement_evidence jsonb,
  add column if not exists replacement_validation jsonb,
  add column if not exists after_snapshot jsonb;

create index if not exists roamly_customer_itinerary_edits_replacement_idx
  on public.roamly_customer_itinerary_edits (itinerary_id, replacement_candidate_id)
  where operation = 'REPLACE_OPTIONAL_ACTIVITY' and status = 'awaiting_approval';

create or replace function public.roamly_apply_customer_itinerary_replacement(
  p_edit_id uuid,
  p_trip_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  edit public.roamly_customer_itinerary_edits%rowtype;
  itinerary public.roamly_itineraries%rowtype;
  day jsonb;
  item jsonb;
  suggestion jsonb;
  next_day jsonb;
  next_days jsonb := '[]'::jsonb;
  next_timeline jsonb;
  next_suggestions jsonb := '[]'::jsonb;
  next_json jsonb;
  target_item jsonb;
  replacement_item jsonb;
  replacement_suggestion jsonb;
  target_candidate_id text;
  suggestion_status text;
  current_hash text;
  next_revision bigint;
  target_match_count integer := 0;
  trip_status text;
begin
  select * into edit
  from public.roamly_customer_itinerary_edits
  where id = p_edit_id and trip_id = p_trip_id and user_id = auth.uid()
  for update;
  if not found then raise exception using errcode = '42501', message = 'CUSTOMER_REPLACEMENT_NOT_FOUND'; end if;
  if edit.status = 'applied' then
    return jsonb_build_object('status', 'already_applied', 'edit_id', edit.id, 'revision', edit.applied_revision, 'content_hash', edit.applied_content_hash, 'result', edit.apply_result);
  end if;
  if edit.status <> 'awaiting_approval' then raise exception using errcode = '40901', message = 'CUSTOMER_REPLACEMENT_NOT_APPROVABLE'; end if;
  if edit.operation <> 'REPLACE_OPTIONAL_ACTIVITY' then raise exception using errcode = '22023', message = 'CUSTOMER_REPLACEMENT_OPERATION_REQUIRED'; end if;

  select * into itinerary
  from public.roamly_itineraries
  where id = edit.itinerary_id and trip_id = p_trip_id and user_id = auth.uid()
  for update;
  if not found then raise exception using errcode = '42501', message = 'ITINERARY_NOT_FOUND'; end if;
  select status into trip_status from public.roamly_trips where id = p_trip_id and user_id = auth.uid();
  if not found then raise exception using errcode = '42501', message = 'TRIP_NOT_OWNED'; end if;
  if trip_status in ('archived', 'cancelled', 'completed') then raise exception using errcode = '22023', message = 'CUSTOMER_REPLACEMENT_TRIP_INACTIVE'; end if;

  current_hash := public.roamly_itinerary_content_hash(itinerary.full_json);
  if itinerary.repair_revision <> edit.expected_revision or current_hash <> edit.expected_content_hash then
    update public.roamly_customer_itinerary_edits set status = 'stale', apply_result = jsonb_build_object('reason', 'STALE_ITINERARY_STATE') where id = edit.id;
    raise exception using errcode = '40001', message = 'STALE_ITINERARY_STATE';
  end if;
  if edit.replacement_candidate_id is null or jsonb_typeof(edit.replacement_snapshot) <> 'object' or jsonb_typeof(edit.replacement_evidence) <> 'object' then
    raise exception using errcode = '22023', message = 'REPLACEMENT_CANDIDATE_INVALID';
  end if;
  if edit.replacement_snapshot->>'candidateId' <> edit.replacement_candidate_id
     or edit.replacement_snapshot->>'item_type' <> 'activity'
     or edit.replacement_snapshot->>'plan_role' not in ('supporting', 'alternative')
     or edit.replacement_evidence->>'candidateId' <> edit.replacement_candidate_id
     or edit.replacement_evidence->>'source' = 'public_web'
     or edit.replacement_evidence->>'feasibility' <> 'FEASIBLE'
     or nullif(edit.replacement_evidence->>'expiresAt', '') is null
     or nullif(edit.replacement_evidence->>'expiresAt', '')::timestamptz <= now() then
    raise exception using errcode = '22023', message = 'REPLACEMENT_CANDIDATE_NOT_CURRENT';
  end if;
  replacement_item := edit.replacement_snapshot;
  replacement_suggestion := edit.replacement_evidence->'bookingSuggestion';
  if replacement_suggestion is not null and jsonb_typeof(replacement_suggestion) <> 'object' then
    raise exception using errcode = '22023', message = 'REPLACEMENT_SUGGESTION_INVALID';
  end if;
  if replacement_suggestion is not null and (replacement_suggestion->>'candidateId' <> edit.replacement_candidate_id or lower(coalesce(replacement_suggestion->>'booking_status', '')) not in ('suggested', 'needs_booking')) then
    raise exception using errcode = '22023', message = 'REPLACEMENT_SUGGESTION_NOT_ACTIONABLE';
  end if;
  if jsonb_typeof(itinerary.full_json->'daily_itinerary') <> 'array' then raise exception using errcode = '22023', message = 'ITINERARY_NOT_EDITABLE'; end if;

  for day in select value from jsonb_array_elements(itinerary.full_json->'daily_itinerary') loop
    next_day := day;
    if day->>'day_id' = edit.day_id::text then
      next_timeline := '[]'::jsonb;
      for item in select value from jsonb_array_elements(coalesce(day->'live_timeline', '[]'::jsonb)) loop
        if item->>'item_id' = edit.target_item_id::text then
          target_match_count := target_match_count + 1;
          if target_match_count > 1 then raise exception using errcode = '22023', message = 'CUSTOMER_REPLACEMENT_TARGET_ID_NOT_UNIQUE'; end if;
          if item->>'item_type' <> 'activity' or item->>'plan_role' not in ('supporting', 'alternative') or coalesce(item->>'must_do', 'false') = 'true' or item->>'plan_role' in ('protected_anchor', 'must_do') or item->'booking' is not null or nullif(item->>'booking_id', '') is not null then
            raise exception using errcode = '22023', message = 'CUSTOMER_REPLACEMENT_TARGET_PROTECTED';
          end if;
          target_item := item;
          target_candidate_id := nullif(trim(coalesce(item->>'candidateId', '')), '');
          next_timeline := next_timeline || jsonb_build_array(jsonb_set(replacement_item, '{item_id}', to_jsonb(edit.target_item_id::text), true));
        else
          next_timeline := next_timeline || jsonb_build_array(item);
        end if;
      end loop;
      next_day := jsonb_set(day, '{live_timeline}', next_timeline, true);
    end if;
    next_days := next_days || jsonb_build_array(next_day);
  end loop;
  if target_match_count = 0 then raise exception using errcode = '22023', message = 'CUSTOMER_REPLACEMENT_TARGET_NOT_FOUND'; end if;

  for suggestion in select value from jsonb_array_elements(coalesce(itinerary.full_json->'booking_suggestions', '[]'::jsonb)) loop
    if target_candidate_id is not null and suggestion->>'candidateId' = target_candidate_id then
      suggestion_status := lower(coalesce(suggestion->>'booking_status', ''));
      if nullif(suggestion->>'booking_id', '') is not null or suggestion_status not in ('suggested', 'needs_booking', 'referred', 'clicked') then
        raise exception using errcode = '22023', message = 'CUSTOMER_REPLACEMENT_TARGET_BOOKING_PROTECTED';
      end if;
      if suggestion_status in ('suggested', 'needs_booking') then continue; end if;
    end if;
    next_suggestions := next_suggestions || jsonb_build_array(suggestion);
  end loop;
  if replacement_suggestion is not null and not exists (select 1 from jsonb_array_elements(next_suggestions) value where value->>'candidateId' = edit.replacement_candidate_id) then
    next_suggestions := next_suggestions || jsonb_build_array(replacement_suggestion);
  end if;

  next_json := jsonb_set(itinerary.full_json, '{daily_itinerary}', next_days, true);
  next_json := jsonb_set(next_json, '{booking_suggestions}', next_suggestions, true);
  next_revision := itinerary.repair_revision + 1;
  update public.roamly_itineraries set full_json = next_json, repair_revision = next_revision where id = itinerary.id;
  update public.roamly_customer_itinerary_edits
  set status = 'applied', approved_at = coalesce(approved_at, now()), applied_at = now(), applied_revision = next_revision,
      applied_content_hash = public.roamly_itinerary_content_hash(next_json), after_snapshot = jsonb_build_object('dayId', edit.day_id, 'itemId', edit.target_item_id, 'item', replacement_item),
      apply_result = jsonb_build_object('database_apply', 'succeeded', 'old_candidate_id', target_candidate_id, 'new_candidate_id', edit.replacement_candidate_id, 'verification', 'requires_application_recompute')
  where id = edit.id;
  return jsonb_build_object('status', 'applied', 'edit_id', edit.id, 'revision', next_revision, 'content_hash', public.roamly_itinerary_content_hash(next_json));
end;
$$;

revoke all on function public.roamly_apply_customer_itinerary_replacement(uuid, uuid) from public, anon;
grant execute on function public.roamly_apply_customer_itinerary_replacement(uuid, uuid) to authenticated, service_role;
