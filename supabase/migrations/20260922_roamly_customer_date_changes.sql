create table public.roamly_customer_trip_date_changes (
  id uuid primary key default gen_random_uuid(),
  original_trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_itinerary_id uuid not null references public.roamly_itineraries(id) on delete cascade,
  requested_start_date date not null,
  requested_end_date date not null,
  expected_start_date date,
  expected_end_date date,
  expected_trip_status text not null,
  expected_revision bigint not null check (expected_revision >= 0),
  expected_content_hash text not null,
  expected_booking_snapshot jsonb not null default '{}'::jsonb,
  intent_snapshot jsonb not null default '{}'::jsonb,
  successor_trip_id uuid references public.roamly_trips(id) on delete set null,
  successor_itinerary_id uuid references public.roamly_itineraries(id) on delete set null,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval','reserved','generating','applied','failed','stale','rejected')),
  failure_reason text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reserved_at timestamptz,
  applied_at timestamptz,
  completed_at timestamptz
);

create index roamly_customer_trip_date_changes_trip_idx on public.roamly_customer_trip_date_changes (original_trip_id, created_at desc);
create unique index roamly_customer_trip_date_changes_open_uidx on public.roamly_customer_trip_date_changes (original_trip_id, expected_revision) where status in ('awaiting_approval','reserved','generating');

create trigger roamly_customer_trip_date_changes_updated_at before update on public.roamly_customer_trip_date_changes for each row execute function public.roamly_set_updated_at();

alter table public.roamly_customer_trip_date_changes enable row level security;
create policy "Roamly users read own customer trip date changes" on public.roamly_customer_trip_date_changes for select to authenticated using (user_id = auth.uid());
revoke all on public.roamly_customer_trip_date_changes from anon, authenticated, public;
grant select on public.roamly_customer_trip_date_changes to authenticated;
grant all on public.roamly_customer_trip_date_changes to service_role;

create function public.roamly_reserve_customer_trip_date_change(p_proposal_id uuid, p_trip_id uuid)
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
  values (trip.user_id, coalesce(trip.title, 'Roamly trip') || ' · new dates', proposal.intent_snapshot->>'destination', proposal.intent_snapshot->>'destinationName', proposal.intent_snapshot->>'destinationCity', proposal.intent_snapshot->>'destinationCountry', proposal.intent_snapshot->>'destinationRegion', proposal.intent_snapshot->>'origin', proposal.requested_start_date, proposal.requested_end_date, (proposal.requested_end_date - proposal.requested_start_date) + 1, nullif(proposal.intent_snapshot->>'budgetAmount','')::numeric, coalesce(proposal.intent_snapshot->>'budgetCurrency','CAD'), proposal.intent_snapshot->>'travelStyle', coalesce(array(select jsonb_array_elements_text(proposal.intent_snapshot->'interests')), '{}'), proposal.intent_snapshot->>'accommodationPreference', proposal.intent_snapshot->>'transportationPreference', proposal.intent_snapshot->>'specialNotes', 'draft', 'draft', false, 'free', false, jsonb_build_object('planning', proposal.intent_snapshot->'planning', 'date_change_original_trip_id', trip.id, 'date_change_proposal_id', proposal.id));
  returning id into successor_id;
  update public.roamly_customer_trip_date_changes set successor_trip_id = successor_id, status = 'generating', reserved_at = now() where id = proposal.id;
  return jsonb_build_object('status','generating','proposalId',proposal.id,'successorTripId',successor_id,'idempotent',false);
end;
$$;

create function public.roamly_complete_customer_trip_date_change(p_proposal_id uuid, p_user_id uuid, p_successor_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare proposal public.roamly_customer_trip_date_changes; successor public.roamly_trips;
  original public.roamly_trips;
  original_itinerary public.roamly_itineraries;
  current_booking_snapshot jsonb;
begin
  select * into proposal from public.roamly_customer_trip_date_changes where id = p_proposal_id and user_id = p_user_id for update;
  select * into successor from public.roamly_trips where id = p_successor_trip_id and user_id = p_user_id for update;
  if proposal.status = 'applied' then return jsonb_build_object('status','already_applied','successorTripId',proposal.successor_trip_id); end if;
  if proposal.id is null or successor.id is null or proposal.successor_trip_id <> successor.id or successor.status not in ('generated','locked') then raise exception using errcode = '40001', message = 'DATE_CHANGE_SUCCESSOR_NOT_READY'; end if;
  select * into original from public.roamly_trips where id = proposal.original_trip_id and user_id = p_user_id for update;
  select * into original_itinerary from public.roamly_itineraries where trip_id = original.id and user_id = p_user_id for update;
  if original.id is null or original.status is distinct from proposal.expected_trip_status or original.start_date is distinct from proposal.expected_start_date or original.end_date is distinct from proposal.expected_end_date or original_itinerary.id is distinct from proposal.original_itinerary_id or original_itinerary.repair_revision is distinct from proposal.expected_revision or public.roamly_itinerary_content_hash(original_itinerary.full_json) is distinct from proposal.expected_content_hash then raise exception using errcode = '40001', message = 'DATE_CHANGE_SOURCE_CHANGED'; end if;
  select jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'booking_status',b.booking_status,'traveler_confirmed',b.traveler_confirmed,'updated_at_epoch',extract(epoch from b.updated_at)::bigint,'superseded_by_booking_id',b.superseded_by_booking_id) order by b.id) from public.roamly_bookings b where b.user_id = p_user_id and b.trip_id = original.id and b.superseded_by_booking_id is null), '[]'::jsonb)
  ) into current_booking_snapshot;
  if current_booking_snapshot is distinct from proposal.expected_booking_snapshot then raise exception using errcode = '40001', message = 'DATE_CHANGE_BOOKINGS_CHANGED'; end if;
  update public.roamly_trips set status = 'archived', itinerary_status = 'locked' where id = original.id and user_id = p_user_id and status in ('generated','locked','planned');
  update public.roamly_customer_trip_date_changes set status = 'applied', applied_at = now(), completed_at = now(), successor_itinerary_id = (select id from public.roamly_itineraries where trip_id = successor.id and user_id = p_user_id limit 1), result = jsonb_build_object('successorTripId', successor.id) where id = proposal.id;
  return jsonb_build_object('status','applied','successorTripId',successor.id);
end;
$$;

create function public.roamly_fail_customer_trip_date_change(p_proposal_id uuid, p_user_id uuid, p_successor_trip_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.roamly_trips set status = 'archived', itinerary_status = 'draft' where id = p_successor_trip_id and user_id = p_user_id and status in ('draft','generating','preview');
  update public.roamly_customer_trip_date_changes set status = 'failed', failure_reason = left(coalesce(p_reason,'GENERATION_FAILED'), 500), result = jsonb_build_object('error', left(coalesce(p_reason,'GENERATION_FAILED'),500)) where id = p_proposal_id and user_id = p_user_id and status in ('reserved','generating');
  return jsonb_build_object('status','failed');
end;
$$;

revoke all on function public.roamly_reserve_customer_trip_date_change(uuid,uuid) from public, anon;
grant execute on function public.roamly_reserve_customer_trip_date_change(uuid,uuid) to authenticated, service_role;
revoke all on function public.roamly_complete_customer_trip_date_change(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.roamly_complete_customer_trip_date_change(uuid,uuid,uuid) to service_role;
revoke all on function public.roamly_fail_customer_trip_date_change(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.roamly_fail_customer_trip_date_change(uuid,uuid,uuid,text) to service_role;
