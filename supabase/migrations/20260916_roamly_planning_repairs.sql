-- Planning conflict repairs are an explicit, narrow exception to generated-trip immutability.
-- This migration is intentionally local-only until the production schema gate is approved.

alter table public.roamly_itineraries
  add column if not exists repair_revision bigint not null default 0;

alter table public.roamly_itineraries
  drop constraint if exists roamly_itineraries_repair_revision_check;

alter table public.roamly_itineraries
  add constraint roamly_itineraries_repair_revision_check check (repair_revision >= 0);

create or replace function public.roamly_itinerary_content_hash(value jsonb)
returns text
language sql
immutable
as $$
  select md5(coalesce(value, '{}'::jsonb)::text);
$$;

create table if not exists public.roamly_planning_repair_proposals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  itinerary_id uuid not null references public.roamly_itineraries(id) on delete cascade,
  operation text not null check (operation = 'REMOVE_OPTIONAL_ACTIVITY'),
  conflict_id uuid not null,
  day_id uuid not null,
  target_item_id uuid not null,
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

create index if not exists roamly_planning_repairs_trip_idx
  on public.roamly_planning_repair_proposals (trip_id, created_at desc);

create unique index if not exists roamly_planning_repairs_open_target_uidx
  on public.roamly_planning_repair_proposals (itinerary_id, expected_revision, operation, target_item_id)
  where status = 'awaiting_approval';

drop trigger if exists roamly_planning_repairs_updated_at
  on public.roamly_planning_repair_proposals;

create trigger roamly_planning_repairs_updated_at
before update on public.roamly_planning_repair_proposals
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_planning_repair_proposals enable row level security;

drop policy if exists "Roamly users read own planning repairs"
  on public.roamly_planning_repair_proposals;

create policy "Roamly users read own planning repairs"
on public.roamly_planning_repair_proposals
for select to authenticated
using (user_id = auth.uid());

-- There are deliberately no authenticated INSERT/UPDATE/DELETE policies.
-- The trusted server creates proposals after owner authorization; the apply
-- function below is the only customer-callable mutation path.

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
  next_day jsonb;
  next_days jsonb := '[]'::jsonb;
  next_timeline jsonb;
  next_json jsonb;
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

  for day in select value from jsonb_array_elements(itinerary.full_json->'daily_itinerary') loop
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
             or item->>'item_type' in ('flight', 'hotel', 'booking')
             or item->>'routing_status' <> 'INFEASIBLE'
             or item->>'plan_role' not in ('supporting', 'alternative') then
            raise exception using errcode = '22023', message = 'REPAIR_TARGET_PROTECTED_OR_NOT_INFEASIBLE';
          end if;
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

  next_json := jsonb_set(itinerary.full_json, '{daily_itinerary}', next_days, true);
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
