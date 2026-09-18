-- Trusted application mutation for the already-applied booking supersession schema.
-- This migration is separate from the production postchecked migration.
create function public.roamly_supersede_booking(
  p_user_id uuid, p_trip_id uuid, p_predecessor_id uuid, p_successor_id uuid
)
returns setof public.roamly_bookings
language plpgsql set search_path = public
as $$
declare
  predecessor public.roamly_bookings;
  successor public.roamly_bookings;
  cursor_id uuid;
  visited uuid[] := array[]::uuid[];
begin
  if auth.role() <> 'service_role' then raise exception 'Booking supersession requires the trusted server boundary.' using errcode = '42501'; end if;
  if p_predecessor_id = p_successor_id then raise exception 'A booking cannot supersede itself.' using errcode = '22023'; end if;
  select * into predecessor from public.roamly_bookings where id = p_predecessor_id and user_id = p_user_id and trip_id = p_trip_id for update;
  select * into successor from public.roamly_bookings where id = p_successor_id and user_id = p_user_id and trip_id = p_trip_id for update;
  if predecessor.id is null or successor.id is null or p_trip_id is null then raise exception 'Both owned bookings must belong to the same non-null trip.' using errcode = '22023'; end if;
  if predecessor.superseded_by_booking_id is not null then
    if predecessor.superseded_by_booking_id = p_successor_id then return next predecessor; return; end if;
    raise exception 'The predecessor already has a different successor.' using errcode = '23514';
  end if;
  cursor_id := p_successor_id;
  while cursor_id is not null loop
    if cursor_id = p_predecessor_id or cursor_id = any(visited) then raise exception 'Booking supersession would create a lineage cycle.' using errcode = '23514'; end if;
    visited := array_append(visited, cursor_id);
    select superseded_by_booking_id into cursor_id from public.roamly_bookings where id = cursor_id and user_id = p_user_id and trip_id = p_trip_id for update;
  end loop;
  update public.roamly_bookings set superseded_by_booking_id = p_successor_id where id = p_predecessor_id and user_id = p_user_id and trip_id = p_trip_id;
  return query select * from public.roamly_bookings where id = p_predecessor_id;
end;
$$;
revoke all on function public.roamly_supersede_booking(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.roamly_supersede_booking(uuid, uuid, uuid, uuid) to service_role;
