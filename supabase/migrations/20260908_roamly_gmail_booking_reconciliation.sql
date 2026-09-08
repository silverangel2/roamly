-- Add connection-scoped Gmail booking reconciliation ordering and audit history.
alter table public.roamly_bookings
  add column if not exists source_connection_id uuid references public.email_connections(id) on delete set null,
  add column if not exists source_message_id text,
  add column if not exists source_event_at timestamptz,
  add column if not exists last_authoritative_update_at timestamptz,
  add column if not exists last_authoritative_source_message_id text,
  add column if not exists reconciliation_status text not null default 'applied',
  add column if not exists reconciliation_version bigint not null default 0;

alter table public.roamly_bookings
  drop constraint if exists roamly_bookings_reconciliation_status_check;
alter table public.roamly_bookings
  add constraint roamly_bookings_reconciliation_status_check
  check (reconciliation_status in ('applied', 'needs_review', 'ignored'));

create unique index if not exists roamly_bookings_source_message_uidx
  on public.roamly_bookings (source_connection_id, source_message_id)
  where source_connection_id is not null and source_message_id is not null;

create table if not exists public.roamly_booking_revisions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.roamly_bookings(id) on delete restrict,
  user_id uuid not null references auth.users(id),
  trip_id uuid not null references public.roamly_trips(id),
  source_connection_id uuid references public.email_connections(id) on delete set null,
  source_message_id text,
  source_event_at timestamptz not null,
  previous_booking_status text,
  resulting_booking_status text not null,
  decision text not null check (decision in ('applied', 'needs_review', 'ignored')),
  reconciliation_version bigint not null,
  changed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists roamly_booking_revisions_source_uidx
  on public.roamly_booking_revisions (source_connection_id, source_message_id)
  where source_connection_id is not null and source_message_id is not null;
create index if not exists roamly_booking_revisions_booking_idx
  on public.roamly_booking_revisions (booking_id, source_event_at desc, created_at desc);

alter table public.roamly_booking_revisions enable row level security;
drop policy if exists "Roamly users read own booking revisions" on public.roamly_booking_revisions;
create policy "Roamly users read own booking revisions"
on public.roamly_booking_revisions
for select
to authenticated
using (user_id = auth.uid());
grant select on public.roamly_booking_revisions to authenticated;
grant all privileges on public.roamly_booking_revisions to service_role;

create or replace function public.roamly_apply_gmail_booking_revision(
  p_booking_id uuid,
  p_user_id uuid,
  p_trip_id uuid,
  p_source_connection_id uuid,
  p_source_message_id text,
  p_source_event_at timestamptz,
  p_decision text,
  p_booking_patch jsonb,
  p_changed_fields jsonb default '{}'::jsonb
)
returns table (
  applied boolean,
  duplicate boolean,
  stale boolean,
  needs_review boolean,
  reconciliation_version bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.roamly_bookings%rowtype;
  prior_revision public.roamly_booking_revisions%rowtype;
  next_version bigint;
begin
  if p_booking_id is null
    or p_user_id is null
    or p_trip_id is null
    or p_source_connection_id is null
    or nullif(trim(coalesce(p_source_message_id, '')), '') is null
    or p_source_event_at is null
    or p_decision not in ('applied', 'needs_review', 'ignored') then
    return query select false, false, true, p_decision = 'needs_review', 0::bigint;
    return;
  end if;

  select * into current_row
  from public.roamly_bookings
  where id = p_booking_id
    and user_id = p_user_id
    and trip_id = p_trip_id
  for update;

  if not found then
    return query select false, false, true, false, 0::bigint;
    return;
  end if;

  select * into prior_revision
  from public.roamly_booking_revisions
  where source_connection_id = p_source_connection_id
    and source_message_id = p_source_message_id
  limit 1;
  if found then
    return query select false, true, false, prior_revision.decision = 'needs_review', current_row.reconciliation_version;
    return;
  end if;

  if current_row.last_authoritative_update_at is not null and (
    p_source_event_at < current_row.last_authoritative_update_at
    or (
      p_source_event_at = current_row.last_authoritative_update_at
      and p_source_message_id <= coalesce(current_row.last_authoritative_source_message_id, '')
    )
  ) then
    next_version := current_row.reconciliation_version;
    insert into public.roamly_booking_revisions (
      booking_id, user_id, trip_id, source_connection_id, source_message_id,
      source_event_at, previous_booking_status, resulting_booking_status,
      decision, reconciliation_version, changed_fields
    ) values (
      current_row.id, current_row.user_id, current_row.trip_id, p_source_connection_id,
      p_source_message_id, p_source_event_at, current_row.booking_status,
      current_row.booking_status, 'ignored', next_version,
      coalesce(p_changed_fields, '{}'::jsonb)
    );
    return query select false, false, true, false, next_version;
    return;
  end if;

  if p_decision <> 'applied' then
    next_version := current_row.reconciliation_version;
    insert into public.roamly_booking_revisions (
      booking_id, user_id, trip_id, source_connection_id, source_message_id,
      source_event_at, previous_booking_status, resulting_booking_status,
      decision, reconciliation_version, changed_fields
    ) values (
      current_row.id, current_row.user_id, current_row.trip_id, p_source_connection_id,
      p_source_message_id, p_source_event_at, current_row.booking_status,
      current_row.booking_status, p_decision, next_version,
      coalesce(p_changed_fields, '{}'::jsonb)
    );
    return query select false, false, false, p_decision = 'needs_review', next_version;
    return;
  end if;

  next_version := current_row.reconciliation_version + 1;
  update public.roamly_bookings b
  set
    booking_status = coalesce(p_booking_patch->>'booking_status', b.booking_status),
    provider_name = coalesce(p_booking_patch->>'provider_name', b.provider_name),
    provider_booking_id = coalesce(p_booking_patch->>'provider_booking_id', b.provider_booking_id),
    confirmation_number = coalesce(p_booking_patch->>'confirmation_number', b.confirmation_number),
    title = coalesce(p_booking_patch->>'title', b.title),
    start_at = coalesce((p_booking_patch->>'start_at')::timestamptz, b.start_at),
    end_at = coalesce((p_booking_patch->>'end_at')::timestamptz, b.end_at),
    origin = coalesce(p_booking_patch->>'origin', b.origin),
    destination = coalesce(p_booking_patch->>'destination', b.destination),
    flight_number = coalesce(p_booking_patch->>'flight_number', b.flight_number),
    terminal = coalesce(p_booking_patch->>'terminal', b.terminal),
    gate = coalesce(p_booking_patch->>'gate', b.gate),
    room_type = coalesce(p_booking_patch->>'room_type', b.room_type),
    check_in_at = coalesce((p_booking_patch->>'check_in_at')::timestamptz, b.check_in_at),
    check_out_at = coalesce((p_booking_patch->>'check_out_at')::timestamptz, b.check_out_at),
    metadata = coalesce(b.metadata, '{}'::jsonb) || coalesce(p_booking_patch->'metadata', '{}'::jsonb),
    source_connection_id = p_source_connection_id,
    source_message_id = p_source_message_id,
    source_event_at = p_source_event_at,
    last_authoritative_update_at = p_source_event_at,
    last_authoritative_source_message_id = p_source_message_id,
    reconciliation_status = 'applied',
    reconciliation_version = next_version,
    last_synced_at = now()
  where b.id = current_row.id;

  insert into public.roamly_booking_revisions (
    booking_id, user_id, trip_id, source_connection_id, source_message_id,
    source_event_at, previous_booking_status, resulting_booking_status,
    decision, reconciliation_version, changed_fields
  ) values (
    current_row.id, current_row.user_id, current_row.trip_id, p_source_connection_id,
    p_source_message_id, p_source_event_at, current_row.booking_status,
    coalesce(p_booking_patch->>'booking_status', current_row.booking_status),
    'applied', next_version, coalesce(p_changed_fields, '{}'::jsonb)
  );

  return query select true, false, false, false, next_version;
end;
$$;

revoke all on function public.roamly_apply_gmail_booking_revision(uuid, uuid, uuid, uuid, text, timestamptz, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.roamly_apply_gmail_booking_revision(uuid, uuid, uuid, uuid, text, timestamptz, text, jsonb, jsonb)
  to service_role;
