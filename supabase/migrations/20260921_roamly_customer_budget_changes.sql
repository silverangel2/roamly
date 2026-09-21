-- Trip-level customer budget proposals remain separate from item edits.

create table if not exists public.roamly_customer_budget_changes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  itinerary_id uuid not null references public.roamly_itineraries(id) on delete cascade,
  requested_budget_amount numeric(12, 2) not null check (requested_budget_amount >= 0),
  requested_budget_currency text not null check (requested_budget_currency ~ '^[A-Z]{3}$'),
  expected_budget_amount numeric(12, 2),
  expected_trip_budget_amount numeric(12, 2),
  expected_planning_budget_amount numeric(12, 2),
  expected_planning_budget_source text,
  expected_budget_source text not null default 'none' check (expected_budget_source in ('trip_column', 'planning_metadata', 'none')),
  expected_budget_currency text not null check (expected_budget_currency ~ '^[A-Z]{3}$'),
  expected_revision bigint not null check (expected_revision >= 0),
  expected_content_hash text not null,
  expected_price_discovery_id uuid references public.roamly_price_discoveries(id) on delete set null,
  before_snapshot jsonb not null default '{}'::jsonb,
  preview_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval', 'applied', 'stale', 'failed', 'rejected')),
  applied_revision bigint,
  applied_content_hash text,
  apply_result jsonb,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_customer_budget_changes_trip_idx
  on public.roamly_customer_budget_changes (trip_id, created_at desc);

create unique index if not exists roamly_customer_budget_changes_open_uidx
  on public.roamly_customer_budget_changes (itinerary_id, expected_revision)
  where status = 'awaiting_approval';

drop trigger if exists roamly_customer_budget_changes_updated_at
  on public.roamly_customer_budget_changes;

create trigger roamly_customer_budget_changes_updated_at
before update on public.roamly_customer_budget_changes
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_customer_budget_changes enable row level security;

drop policy if exists "Roamly users read own customer budget changes"
  on public.roamly_customer_budget_changes;

create policy "Roamly users read own customer budget changes"
on public.roamly_customer_budget_changes
for select to authenticated
using (user_id = auth.uid());

revoke all on table public.roamly_customer_budget_changes from public, anon, authenticated;
grant select on table public.roamly_customer_budget_changes to authenticated;

create or replace function public.roamly_apply_customer_budget_change(
  p_proposal_id uuid,
  p_trip_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.roamly_customer_budget_changes%rowtype;
  trip public.roamly_trips%rowtype;
  itinerary public.roamly_itineraries%rowtype;
  current_hash text;
  next_revision bigint;
  next_json jsonb;
  resulting_breakdown jsonb;
  trip_status text;
  planning jsonb;
  planning_key text;
  current_trip_budget_amount numeric(12, 2);
  current_planning_budget_amount numeric(12, 2);
  current_planning_source text;
  current_budget_source text;
  current_effective_budget_amount numeric(12, 2);
begin
  select * into proposal
  from public.roamly_customer_budget_changes
  where id = p_proposal_id and trip_id = p_trip_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CUSTOMER_BUDGET_CHANGE_NOT_FOUND';
  end if;
  if proposal.status = 'applied' then
    return jsonb_build_object('status', 'already_applied', 'proposal_id', proposal.id, 'revision', proposal.applied_revision, 'content_hash', proposal.applied_content_hash, 'result', proposal.apply_result);
  end if;
  if proposal.status <> 'awaiting_approval' then
    raise exception using errcode = '40901', message = 'CUSTOMER_BUDGET_CHANGE_NOT_APPROVABLE';
  end if;

  select * into trip
  from public.roamly_trips
  where id = p_trip_id and user_id = auth.uid()
  for update;
  if not found then raise exception using errcode = '42501', message = 'TRIP_NOT_OWNED'; end if;
  trip_status := trip.status;
  if trip_status not in ('generated', 'locked', 'activated', 'planned', 'active') then
    raise exception using errcode = '22023', message = 'CUSTOMER_BUDGET_CHANGE_TRIP_NOT_ACTIVE';
  end if;

  select * into itinerary
  from public.roamly_itineraries
  where id = proposal.itinerary_id and trip_id = p_trip_id and user_id = auth.uid()
  for update;
  if not found then raise exception using errcode = '42501', message = 'ITINERARY_NOT_FOUND'; end if;

  current_trip_budget_amount := case when trip.budget_amount is not null and trip.budget_amount > 0 then trip.budget_amount else null end;
  planning := case when jsonb_typeof(trip.metadata->'planning') = 'object' then trip.metadata->'planning' else '{}'::jsonb end;
  current_planning_budget_amount := null;
  current_planning_source := null;
  foreach planning_key in array array['budgetAmount', 'budget_amount', 'budget_total'] loop
    if jsonb_typeof(planning->planning_key) = 'number' and (planning->>planning_key)::numeric > 0 then
      current_planning_budget_amount := (planning->>planning_key)::numeric;
      current_planning_source := planning_key;
      exit;
    end if;
  end loop;
  if current_trip_budget_amount is not null then
    current_budget_source := 'trip_column';
    current_effective_budget_amount := current_trip_budget_amount;
  elsif current_planning_budget_amount is not null then
    current_budget_source := 'planning_metadata';
    current_effective_budget_amount := current_planning_budget_amount;
  else
    current_budget_source := 'none';
    current_effective_budget_amount := null;
  end if;

  current_hash := public.roamly_itinerary_content_hash(itinerary.full_json);
  if itinerary.repair_revision <> proposal.expected_revision
     or current_hash <> proposal.expected_content_hash
     or current_effective_budget_amount is distinct from proposal.expected_budget_amount
     or current_trip_budget_amount is distinct from proposal.expected_trip_budget_amount
     or current_planning_budget_amount is distinct from proposal.expected_planning_budget_amount
     or current_planning_source is distinct from proposal.expected_planning_budget_source
     or current_budget_source is distinct from proposal.expected_budget_source
     or upper(trip.budget_currency) is distinct from upper(proposal.expected_budget_currency)
     or trip.latest_price_discovery_id is distinct from proposal.expected_price_discovery_id then
    update public.roamly_customer_budget_changes
      set status = 'stale', apply_result = jsonb_build_object('reason', 'STALE_BUDGET_CHANGE_STATE')
      where id = proposal.id;
    return jsonb_build_object('status', 'stale', 'proposal_id', proposal.id, 'reason', 'STALE_BUDGET_CHANGE_STATE');
  end if;

  resulting_breakdown := proposal.preview_snapshot->'resultingBreakdown';
  if jsonb_typeof(resulting_breakdown) <> 'object' then
    raise exception using errcode = '22023', message = 'CUSTOMER_BUDGET_CHANGE_PREVIEW_INVALID';
  end if;
  next_json := jsonb_set(itinerary.full_json, '{estimated_budget_breakdown}', resulting_breakdown, true);
  next_revision := itinerary.repair_revision + 1;
  update public.roamly_trips
    set budget_amount = proposal.requested_budget_amount,
        budget_currency = upper(proposal.requested_budget_currency),
        updated_at = now()
    where id = trip.id and user_id = auth.uid();
  update public.roamly_itineraries
    set full_json = next_json,
        repair_revision = next_revision,
        updated_at = now()
    where id = itinerary.id and trip_id = p_trip_id and user_id = auth.uid();
  update public.roamly_customer_budget_changes
    set status = 'applied',
        approved_at = coalesce(approved_at, now()),
        applied_at = now(),
        applied_revision = next_revision,
        applied_content_hash = public.roamly_itinerary_content_hash(next_json),
        after_snapshot = jsonb_build_object('budgetAmount', proposal.requested_budget_amount, 'currency', upper(proposal.requested_budget_currency), 'breakdown', resulting_breakdown),
        apply_result = jsonb_build_object('database_apply', 'succeeded', 'itinerary_items_changed', false, 'confirmed_bookings_changed', false)
    where id = proposal.id;
  return jsonb_build_object('status', 'applied', 'proposal_id', proposal.id, 'revision', next_revision, 'content_hash', public.roamly_itinerary_content_hash(next_json));
end;
$$;

revoke all on function public.roamly_apply_customer_budget_change(uuid, uuid) from public, anon;
grant execute on function public.roamly_apply_customer_budget_change(uuid, uuid) to authenticated, service_role;
