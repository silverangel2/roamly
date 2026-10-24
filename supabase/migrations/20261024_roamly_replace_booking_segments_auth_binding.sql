-- B01 (customer-booking audit, 2026-10-24): bind the booking-segment
-- replacement RPCs to the caller's session identity.
--
-- DEFECT (20261014_roamly_replace_booking_segments_rpc.sql): the function ran
-- as SECURITY DEFINER, was executable by `authenticated`, and gated ownership
-- ONLY on caller-supplied p_user_id + p_trip_id + p_booking_id. It never
-- compared p_user_id to auth.uid(). Any signed-in caller who knew (or guessed)
-- another booking's identifiers could pass the gate and delete/replace that
-- booking's segments. The old migration file is left untouched; this is a
-- forward-only correction.
--
-- FIX:
-- 1. roamly_replace_booking_segments (authenticated path, same signature and
--    return contract): the caller MUST be the owner. It raises unless
--    p_user_id = auth.uid(), then re-checks server-side that the booking row
--    AND its trip are both owned by auth.uid() (FOR UPDATE keeps the original
--    serialization of concurrent reconciliations). It is no longer executable
--    by service_role: trusted server callers must use the service function
--    below, so a server-side caller can never silently take the user path.
-- 2. roamly_replace_booking_segments_service (service path, same signature
--    and segment mapping): identical delete+insert semantics with the same
--    caller-supplied ownership check, but executable ONLY by service_role
--    (revoked from public, anon, authenticated). This is the path for the
--    affiliate webhook and Gmail sync, which act on a booking owner's behalf
--    without a user session. lib/roamly/bookingWallet.ts routes
--    createTripBooking's segment replacement through the matching function.
--
-- DEPLOY NOTE (fail-closed): after this migration, any service-key caller
-- still invoking roamly_replace_booking_segments gets a permission error
-- instead of a silent success. Such a caller must switch to the _service
-- function. No user-session caller changes behavior as long as it passes its
-- own user id, which all in-repo user flows already do.

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

  -- B01: bind the caller-supplied owner to the session identity. auth.uid()
  -- is the JWT subject of the caller; a service-role JWT carries no subject,
  -- so service callers cannot pass this gate at all and must use the
  -- _service function below. Without this gate, any authenticated caller
  -- could name another owner's identifiers and pass the old ownership check.
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'roamly_replace_booking_segments: caller identity mismatch.';
  end if;

  -- Ownership re-check, server-side: the booking AND its trip must both
  -- belong to the session user. The predicate uses auth.uid(), never the
  -- caller-supplied value, so a forged p_user_id cannot help even if the
  -- gate above were ever weakened. FOR UPDATE OF b keeps the original
  -- serialization of concurrent reconciliations of the same booking.
  if not exists (
    select 1
    from public.roamly_bookings b
    join public.roamly_trips t on t.id = b.trip_id
    where b.id = p_booking_id
      and b.user_id = auth.uid()
      and b.trip_id = p_trip_id
      and t.user_id = auth.uid()
    for update of b
  ) then
    raise exception 'roamly_replace_booking_segments: booking not found for this user and trip.';
  end if;

  delete from public.booking_segments
  where booking_id = p_booking_id;

  -- Field mapping mirrors normalizeBookingSegments() in bookingWallet.ts and
  -- is identical to the 20261014 mapping: sequence is a 1-based integer,
  -- timestamps are ISO strings, text columns are null when empty, and status
  -- falls back to 'scheduled' exactly like the column default did on plain
  -- inserts.
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

-- Authenticated path only. CREATE OR REPLACE preserves pre-existing grants,
-- so the service_role grant from 20261014 is explicitly revoked here.
revoke all on function public.roamly_replace_booking_segments(uuid, uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.roamly_replace_booking_segments(uuid, uuid, uuid, jsonb)
  to authenticated;

-- Trusted server path. Same signature, same segment mapping, same
-- caller-supplied ownership check — but no session identity exists in a
-- service-role context, so no auth.uid() binding is attempted here. The ACL
-- below is what makes this path trusted: it is unreachable from any user
-- session, and a user-session caller gets a permission error, not a
-- fallback to caller-supplied identifiers.
create or replace function public.roamly_replace_booking_segments_service(
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
    raise exception 'roamly_replace_booking_segments_service: booking, user, and trip are required.';
  end if;

  -- Trusted server context: the caller is the service role (enforced by the
  -- ACL below, not by this predicate). The ownership check still applies —
  -- the booking must belong to the supplied user and trip — so a server bug
  -- cannot silently rewrite an unrelated booking's segments either.
  if not exists (
    select 1
    from public.roamly_bookings
    where id = p_booking_id
      and user_id = p_user_id
      and trip_id = p_trip_id
    for update
  ) then
    raise exception 'roamly_replace_booking_segments_service: booking not found for this user and trip.';
  end if;

  delete from public.booking_segments
  where booking_id = p_booking_id;

  -- Identical mapping to the authenticated path above.
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

-- Service path only. Never executable by a user session.
revoke all on function public.roamly_replace_booking_segments_service(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.roamly_replace_booking_segments_service(uuid, uuid, uuid, jsonb)
  to service_role;
