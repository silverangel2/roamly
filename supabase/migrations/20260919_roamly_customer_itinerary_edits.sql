-- Customer-directed itinerary edits are deliberately separate from conflict repairs.
-- This migration supports only removal of one exact flexible optional activity.

create table if not exists public.roamly_customer_itinerary_edits (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  itinerary_id uuid not null references public.roamly_itineraries(id) on delete cascade,
  day_id uuid not null,
  target_item_id uuid not null,
  operation text not null check (operation = 'REMOVE_OPTIONAL_ACTIVITY'),
  expected_revision bigint not null check (expected_revision >= 0),
  expected_content_hash text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  preview_json jsonb not null default '{}'::jsonb,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval', 'applied', 'rejected', 'stale', 'failed')),
  applied_revision bigint,
  applied_content_hash text,
  apply_result jsonb,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_customer_itinerary_edits_trip_idx
  on public.roamly_customer_itinerary_edits (trip_id, created_at desc);

create unique index if not exists roamly_customer_itinerary_edits_open_target_uidx
  on public.roamly_customer_itinerary_edits (itinerary_id, expected_revision, operation, day_id, target_item_id)
  where status = 'awaiting_approval';

drop trigger if exists roamly_customer_itinerary_edits_updated_at
  on public.roamly_customer_itinerary_edits;

create trigger roamly_customer_itinerary_edits_updated_at
before update on public.roamly_customer_itinerary_edits
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_customer_itinerary_edits enable row level security;

drop policy if exists "Roamly users read own customer itinerary edits"
  on public.roamly_customer_itinerary_edits;

create policy "Roamly users read own customer itinerary edits"
on public.roamly_customer_itinerary_edits
for select to authenticated
using (user_id = auth.uid());

-- The trusted server creates edit proposals after owner authorization. The
-- apply function is the only authenticated customer mutation path.
revoke all on table public.roamly_customer_itinerary_edits from public, anon, authenticated;
grant select on table public.roamly_customer_itinerary_edits to authenticated;

create or replace function public.roamly_apply_customer_itinerary_edit(
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
  next_json jsonb;
  next_suggestions jsonb := '[]'::jsonb;
  target_item jsonb;
  target_candidate_id text;
  suggestion_status text;
  current_hash text;
  next_revision bigint;
  found_target boolean := false;
  target_match_count integer := 0;
  trip_status text;
begin
  select * into edit
  from public.roamly_customer_itinerary_edits
  where id = p_edit_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'CUSTOMER_EDIT_NOT_FOUND';
  end if;

  if edit.status = 'applied' then
    return jsonb_build_object(
      'status', 'already_applied',
      'edit_id', edit.id,
      'revision', edit.applied_revision,
      'content_hash', edit.applied_content_hash,
      'result', edit.apply_result
    );
  end if;

  if edit.status <> 'awaiting_approval' then
    raise exception using errcode = '40901', message = 'CUSTOMER_EDIT_NOT_APPROVABLE';
  end if;

  select * into itinerary
  from public.roamly_itineraries
  where id = edit.itinerary_id
    and trip_id = p_trip_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'ITINERARY_NOT_FOUND';
  end if;

  select status into trip_status
  from public.roamly_trips
  where id = p_trip_id and user_id = auth.uid();
  if not found then
    raise exception using errcode = '42501', message = 'TRIP_NOT_OWNED';
  end if;
  if trip_status in ('archived', 'cancelled', 'completed') then
    raise exception using errcode = '22023', message = 'CUSTOMER_EDIT_TRIP_INACTIVE';
  end if;

  current_hash := public.roamly_itinerary_content_hash(itinerary.full_json);
  if itinerary.repair_revision <> edit.expected_revision
     or current_hash <> edit.expected_content_hash then
    update public.roamly_customer_itinerary_edits
    set status = 'stale', updated_at = now(), apply_result = jsonb_build_object('reason', 'STALE_ITINERARY_STATE')
    where id = edit.id;
    raise exception using errcode = '40001', message = 'STALE_ITINERARY_STATE';
  end if;

  if jsonb_typeof(itinerary.full_json->'daily_itinerary') <> 'array' then
    raise exception using errcode = '22023', message = 'ITINERARY_NOT_EDITABLE';
  end if;

  for day in select value from jsonb_array_elements(itinerary.full_json->'daily_itinerary') loop
    next_day := day;
    if day->>'day_id' = edit.day_id::text then
      next_timeline := '[]'::jsonb;
      for item in select value from jsonb_array_elements(coalesce(day->'live_timeline', '[]'::jsonb)) loop
        if item->>'item_id' = edit.target_item_id::text then
          found_target := true;
          target_match_count := target_match_count + 1;
          if target_match_count > 1 then
            raise exception using errcode = '22023', message = 'CUSTOMER_EDIT_TARGET_ID_NOT_UNIQUE';
          end if;
          if item->>'item_type' <> 'activity'
             or item->>'plan_role' not in ('supporting', 'alternative')
             or coalesce(item->>'must_do', 'false') = 'true'
             or item->>'plan_role' in ('protected_anchor', 'must_do')
             or item->'booking' is not null
             or nullif(item->>'booking_id', '') is not null then
            raise exception using errcode = '22023', message = 'CUSTOMER_EDIT_TARGET_PROTECTED';
          end if;
          target_item := item;
          target_candidate_id := nullif(trim(coalesce(item->>'candidateId', '')), '');
        else
          next_timeline := next_timeline || jsonb_build_array(item);
        end if;
      end loop;
      next_day := jsonb_set(day, '{live_timeline}', next_timeline, true);
    end if;
    next_days := next_days || jsonb_build_array(next_day);
  end loop;

  if not found_target then
    raise exception using errcode = '22023', message = 'CUSTOMER_EDIT_TARGET_NOT_FOUND';
  end if;

  if target_candidate_id is not null then
    for suggestion in select value from jsonb_array_elements(coalesce(itinerary.full_json->'booking_suggestions', '[]'::jsonb)) loop
      if suggestion->>'candidateId' = target_candidate_id then
        suggestion_status := lower(coalesce(suggestion->>'booking_status', ''));
        if nullif(suggestion->>'booking_id', '') is not null
           or suggestion_status not in ('suggested', 'needs_booking', 'referred', 'clicked') then
          raise exception using errcode = '22023', message = 'CUSTOMER_EDIT_TARGET_BOOKING_PROTECTED';
        end if;
      end if;
    end loop;
    for suggestion in select value from jsonb_array_elements(coalesce(itinerary.full_json->'booking_suggestions', '[]'::jsonb)) loop
      if suggestion->>'candidateId' = target_candidate_id
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

  update public.roamly_customer_itinerary_edits
  set status = 'applied',
      approved_at = coalesce(approved_at, now()),
      applied_at = now(),
      applied_revision = next_revision,
      applied_content_hash = public.roamly_itinerary_content_hash(next_json),
      apply_result = jsonb_build_object('database_apply', 'succeeded', 'verification', 'requires_application_recompute'),
      updated_at = now()
  where id = edit.id;

  return jsonb_build_object(
    'status', 'applied',
    'edit_id', edit.id,
    'revision', next_revision,
    'content_hash', public.roamly_itinerary_content_hash(next_json),
    'verification', 'requires_application_recompute'
  );
end;
$$;

revoke all on function public.roamly_apply_customer_itinerary_edit(uuid, uuid) from public, anon;
grant execute on function public.roamly_apply_customer_itinerary_edit(uuid, uuid) to authenticated, service_role;
