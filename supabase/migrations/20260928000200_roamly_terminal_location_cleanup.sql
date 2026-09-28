-- Keep account-level foreground location operationally scoped.
-- This migration does not inspect or delete existing customer coordinates.

create or replace function public.roamly_has_operational_location_trip(
  p_user_id uuid,
  p_trip_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.roamly_trips t
    where t.user_id = p_user_id
      and (p_trip_id is null or t.id = p_trip_id)
      and t.status in ('locked', 'active', 'planned')
      and t.itinerary_locked is true
      and (coalesce(t.tracking_unlocked, false) or coalesce(t.live_companion_unlocked, false))
      and t.start_date is not null
      and t.end_date is not null
      and t.start_date <= (
        now() at time zone coalesce(
          nullif(t.metadata #>> '{planning,timezone}', ''),
          nullif(t.metadata #>> '{tripPlanning,timezone}', ''),
          nullif(t.metadata ->> 'timezone', ''),
          nullif(t.metadata ->> 'destinationTimezone', ''),
          nullif(t.metadata ->> 'destination_timezone', ''),
          'UTC'
        )
      )::date
      and t.end_date >= (
        now() at time zone coalesce(
          nullif(t.metadata #>> '{planning,timezone}', ''),
          nullif(t.metadata #>> '{tripPlanning,timezone}', ''),
          nullif(t.metadata ->> 'timezone', ''),
          nullif(t.metadata ->> 'destinationTimezone', ''),
          nullif(t.metadata ->> 'destination_timezone', ''),
          'UTC'
        )
      )::date
  );
end;
$$;

create or replace function public.roamly_write_foreground_location(
  p_user_id uuid,
  p_trip_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_observed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null then
    return false;
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'LOCATION_OWNER_MISMATCH';
  end if;

  -- Serialize location writes and terminal cleanup for one account. This
  -- prevents a terminal cleanup from erasing a newer operational write.
  perform pg_advisory_xact_lock(hashtextextended('roamly-location:' || p_user_id::text, 0));

  if not public.roamly_has_operational_location_trip(p_user_id, p_trip_id) then
    update public.roamly_location_settings
    set last_seen_latitude = null,
        last_seen_longitude = null,
        last_seen_at = null,
        updated_at = now()
    where user_id = p_user_id;
    return false;
  end if;

  update public.roamly_location_settings
  set last_permission_state = 'granted',
      last_seen_latitude = p_latitude,
      last_seen_longitude = p_longitude,
      last_seen_at = p_observed_at,
      updated_at = now()
  where user_id = p_user_id
    and location_tracking_enabled is true;

  return found;
end;
$$;

create or replace function public.roamly_clear_last_location_if_no_operational_trip(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null then
    return false;
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'LOCATION_OWNER_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('roamly-location:' || p_user_id::text, 0));

  if public.roamly_has_operational_location_trip(p_user_id) then
    return false;
  end if;

  update public.roamly_location_settings
  set last_seen_latitude = null,
      last_seen_longitude = null,
      last_seen_at = null,
      updated_at = now()
  where user_id = p_user_id
    and (last_seen_latitude is not null or last_seen_longitude is not null or last_seen_at is not null);

  return found;
end;
$$;

create or replace function public.roamly_clear_location_after_terminal_trip()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status in ('completed', 'cancelled', 'archived')
     or old.status in ('completed', 'cancelled', 'archived') then
    perform public.roamly_clear_last_location_if_no_operational_trip(new.user_id);
  end if;
  return new;
end;
$$;

-- Remove only account-level precise location that is already stale because the
-- account has no operational trip. No coordinate values are selected or
-- returned by this cleanup.
update public.roamly_location_settings s
set last_seen_latitude = null,
    last_seen_longitude = null,
    last_seen_at = null,
    updated_at = now()
where (s.last_seen_latitude is not null or s.last_seen_longitude is not null or s.last_seen_at is not null)
  and not public.roamly_has_operational_location_trip(s.user_id);

drop trigger if exists roamly_clear_location_after_terminal_trip on public.roamly_trips;
create trigger roamly_clear_location_after_terminal_trip
after update of status on public.roamly_trips
for each row
execute function public.roamly_clear_location_after_terminal_trip();

revoke all on function public.roamly_has_operational_location_trip(uuid, uuid) from public, anon;
revoke all on function public.roamly_write_foreground_location(uuid, uuid, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.roamly_clear_last_location_if_no_operational_trip(uuid) from public, anon;
revoke all on function public.roamly_clear_location_after_terminal_trip() from public, anon, authenticated;
grant execute on function public.roamly_has_operational_location_trip(uuid, uuid) to authenticated, service_role;
grant execute on function public.roamly_write_foreground_location(uuid, uuid, double precision, double precision, timestamptz) to authenticated, service_role;
grant execute on function public.roamly_clear_last_location_if_no_operational_trip(uuid) to authenticated, service_role;
