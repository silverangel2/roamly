-- CA3 (booking-persistence hardening, corrective action 3): atomic booking-segment
-- replacement for createTripBooking().
--
-- Before this migration, lib/roamly/bookingWallet.ts deleted ALL rows in
-- public.booking_segments for a booking and then re-inserted the new set in two
-- separate statements. If the insert failed (deploy, restart, crash in between),
-- the booking row survived with its segments silently gone — the proven
-- "booking removed during updates" loss mechanism (it also fires on every Gmail
-- re-sync that touches a booking).
--
-- roamly_replace_booking_segments performs the delete+insert in ONE transaction:
-- either the full new segment set lands or nothing changes. It follows the same
-- SECURITY DEFINER + in-function ownership-gate pattern as
-- roamly_apply_gmail_booking_revision, including the FOR UPDATE row lock that
-- serializes concurrent reconciliations of the same booking.

create or replace function public.roamly_replace_booking_segments(
  p_booking_id uuid,
  p_user_id uuid,
  p_trip_id uuid,
  p_segments jsonb
)
returns table (segment_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint := 0;
begin
  if p_booking_id is null or p_user_id is null or p_trip_id is null then
    raise exception 'roamly_replace_booking_segments: booking, user, and trip are required.';
  end if;

  -- Ownership gate. Mirrors assertTripOwnership() + the booking-scope checks in
  -- createTripBooking; FOR UPDATE serializes concurrent reconciliations.
  if not exists (
    select 1
    from public.roamly_bookings
    where id = p_booking_id
      and user_id = p_user_id
      and trip_id = p_trip_id
    for update
  ) then
    raise exception 'roamly_replace_booking_segments: booking not found for this user and trip.';
  end if;

  delete from public.booking_segments
  where booking_id = p_booking_id;

  -- Field mapping mirrors normalizeBookingSegments() in bookingWallet.ts:
  -- sequence is a 1-based integer, timestamps are ISO strings, text columns are
  -- null when empty, and status falls back to 'scheduled' exactly like the
  -- column default did on plain inserts.
  insert into public.booking_segments (
    booking_id,
    sequence,
    origin,
    destination,
    departure_time,
    arrival_time,
    provider,
    service_number,
    terminal,
    gate,
    seat,
    status
  )
  select
    p_booking_id,
    (segment ->> 'sequence')::integer,
    nullif(segment ->> 'origin', ''),
    nullif(segment ->> 'destination', ''),
    nullif(segment ->> 'departure_time', '')::timestamptz,
    nullif(segment ->> 'arrival_time', '')::timestamptz,
    nullif(segment ->> 'provider', ''),
    nullif(segment ->> 'service_number', ''),
    nullif(segment ->> 'terminal', ''),
    nullif(segment ->> 'gate', ''),
    nullif(segment ->> 'seat', ''),
    coalesce(nullif(segment ->> 'status', ''), 'scheduled')
  from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) as segment;

  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

-- ACL: callable by authenticated users (their own bookings only — ownership is
-- enforced inside the function) and the service role. This mirrors the existing
-- RLS policies on booking_segments ("Users delete/insert own booking
-- segments"), which the old two-statement code relied on; restricting this to
-- service_role (like roamly_apply_gmail_booking_revision) would be a behavior
-- regression for any user-scoped caller of createTripBooking.
revoke all on function public.roamly_replace_booking_segments(uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.roamly_replace_booking_segments(uuid, uuid, uuid, jsonb)
  to authenticated, service_role;
