-- Fix round 2026-11-07 (post-ship, PR #111): the email/contact quota
-- gate reads a PostgREST setting production no longer provides.
--
-- roamly_consume_trip_email_quota, roamly_consume_recovery_email_quota
-- (20261106000200) and roamly_consume_contact_request_quota (20260929)
-- all gate on the per-claim setting alone:
--   current_setting('request.jwt.claim.role', true) = 'service_role'
-- Production PostgREST no longer sets that per-claim setting; the role
-- arrives only inside the single JSON setting 'request.jwt.claims'.
-- Under the service role every call therefore raised
-- 'service role required', both routes failed closed, and legitimate
-- itinerary email, recovery email, and the public contact form all
-- answered 503 in production (observed live 2026-11-07).
--
-- This migration re-creates the three functions with the role read
-- copied from the entitlement guard (20261106000100), which reads BOTH
-- settings and whose privileged branch is proven in production: accept
-- the role from the per-claim setting OR from the claims JSON. Nothing
-- else changes: limits, windows, HMAC actor hashing, tables, and ACLs
-- are byte-identical to the applied originals (including the applied
-- recovery day_remaining = greatest(0, 5 - current_day_count)).
--
-- One deliberate difference from the guard: these functions are
-- SECURITY DEFINER, so inside them current_user is the function owner,
-- not the caller. The guard's current_user branch is therefore NOT
-- copied -- it would make the gate always pass. The caller check here
-- is the JWT role, read both ways, exactly as the guard reads it.

create or replace function public.roamly_consume_trip_email_quota(p_actor_hash text)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  hour_remaining integer,
  day_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_time_utc timestamptz := clock_timestamp();
  hour_start timestamptz := date_trunc('hour', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  current_hour_count integer;
  current_day_count integer;
  retry_after integer := 0;
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
begin
  -- Newer PostgREST exposes the claims as one JSON setting instead of
  -- the per-claim setting; read the role from it only when it is
  -- present and JSON-shaped, and never let a malformed value break
  -- the call (same read as the 20261106000100 entitlement guard).
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  if jwt_role <> 'service_role' and claims_role <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid trip email actor hash required';
  end if;

  insert into public.roamly_trip_email_rate_limits as current_limit
    (actor_hash, hour_window_start, hour_count, day_window_start, day_count, updated_at)
  values (p_actor_hash, hour_start, 1, day_start, 1, current_time_utc)
  on conflict (actor_hash) do update
    set hour_window_start = excluded.hour_window_start,
        hour_count = case
          when current_limit.hour_window_start = excluded.hour_window_start then least(current_limit.hour_count + 1, 2147483647)
          else 1
        end,
        day_window_start = excluded.day_window_start,
        day_count = case
          when current_limit.day_window_start = excluded.day_window_start then least(current_limit.day_count + 1, 2147483647)
          else 1
        end,
        updated_at = current_time_utc
  returning hour_count, day_count into current_hour_count, current_day_count;

  -- Itinerary-email abuse is short-lived; keep only two days of quota keys.
  delete from public.roamly_trip_email_rate_limits
  where updated_at < current_time_utc - interval '2 days';

  if current_hour_count > 5 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (hour_start + interval '1 hour' - current_time_utc))::numeric)::integer);
  end if;
  if current_day_count > 20 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (day_start + interval '1 day' - current_time_utc))::numeric)::integer);
  end if;

  return query select
    current_hour_count <= 5 and current_day_count <= 20,
    greatest(0, retry_after),
    greatest(0, 5 - current_hour_count),
    greatest(0, 20 - current_day_count);
end;
$$;

revoke all on function public.roamly_consume_trip_email_quota(text) from public, anon, authenticated;
grant execute on function public.roamly_consume_trip_email_quota(text) to service_role;

create or replace function public.roamly_consume_recovery_email_quota(p_actor_hash text)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  hour_remaining integer,
  day_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_time_utc timestamptz := clock_timestamp();
  hour_start timestamptz := date_trunc('hour', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  current_hour_count integer;
  current_day_count integer;
  retry_after integer := 0;
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
begin
  -- Newer PostgREST exposes the claims as one JSON setting instead of
  -- the per-claim setting; read the role from it only when it is
  -- present and JSON-shaped, and never let a malformed value break
  -- the call (same read as the 20261106000100 entitlement guard).
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  if jwt_role <> 'service_role' and claims_role <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid recovery email actor hash required';
  end if;

  insert into public.roamly_recovery_email_rate_limits as current_limit
    (actor_hash, hour_window_start, hour_count, day_window_start, day_count, updated_at)
  values (p_actor_hash, hour_start, 1, day_start, 1, current_time_utc)
  on conflict (actor_hash) do update
    set hour_window_start = excluded.hour_window_start,
        hour_count = case
          when current_limit.hour_window_start = excluded.hour_window_start then least(current_limit.hour_count + 1, 2147483647)
          else 1
        end,
        day_window_start = excluded.day_window_start,
        day_count = case
          when current_limit.day_window_start = excluded.day_window_start then least(current_limit.day_count + 1, 2147483647)
          else 1
        end,
        updated_at = current_time_utc
  returning hour_count, day_count into current_hour_count, current_day_count;

  -- Recovery-email abuse is short-lived; keep only two days of quota keys.
  delete from public.roamly_recovery_email_rate_limits
  where updated_at < current_time_utc - interval '2 days';

  if current_hour_count > 1 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (hour_start + interval '1 hour' - current_time_utc))::numeric)::integer);
  end if;
  if current_day_count > 5 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (day_start + interval '1 day' - current_time_utc))::numeric)::integer);
  end if;

  return query select
    current_hour_count <= 1 and current_day_count <= 5,
    greatest(0, retry_after),
    greatest(0, 1 - current_hour_count),
    greatest(0, 5 - current_day_count);
end;
$$;

revoke all on function public.roamly_consume_recovery_email_quota(text) from public, anon, authenticated;
grant execute on function public.roamly_consume_recovery_email_quota(text) to service_role;

create or replace function public.roamly_consume_contact_request_quota(p_actor_hash text)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  hour_remaining integer,
  day_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_time_utc timestamptz := clock_timestamp();
  hour_start timestamptz := date_trunc('hour', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  current_hour_count integer;
  current_day_count integer;
  retry_after integer := 0;
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
begin
  -- Newer PostgREST exposes the claims as one JSON setting instead of
  -- the per-claim setting; read the role from it only when it is
  -- present and JSON-shaped, and never let a malformed value break
  -- the call (same read as the 20261106000100 entitlement guard).
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  if jwt_role <> 'service_role' and claims_role <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid contact actor hash required';
  end if;

  insert into public.roamly_contact_request_rate_limits as current_limit
    (actor_hash, hour_window_start, hour_count, day_window_start, day_count, updated_at)
  values (p_actor_hash, hour_start, 1, day_start, 1, current_time_utc)
  on conflict (actor_hash) do update
    set hour_window_start = excluded.hour_window_start,
        hour_count = case
          when current_limit.hour_window_start = excluded.hour_window_start then least(current_limit.hour_count + 1, 2147483647)
          else 1
        end,
        day_window_start = excluded.day_window_start,
        day_count = case
          when current_limit.day_window_start = excluded.day_window_start then least(current_limit.day_count + 1, 2147483647)
          else 1
        end,
        updated_at = current_time_utc
  returning hour_count, day_count into current_hour_count, current_day_count;

  -- Contact abuse is short-lived; keep only two days of pseudonymous quota keys.
  delete from public.roamly_contact_request_rate_limits
  where updated_at < current_time_utc - interval '2 days';

  if current_hour_count > 3 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (hour_start + interval '1 hour' - current_time_utc))::numeric)::integer);
  end if;
  if current_day_count > 10 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (day_start + interval '1 day' - current_time_utc))::numeric)::integer);
  end if;

  return query select
    current_hour_count <= 3 and current_day_count <= 10,
    greatest(0, retry_after),
    greatest(0, 3 - current_hour_count),
    greatest(0, 10 - current_day_count);
end;
$$;

revoke all on function public.roamly_consume_contact_request_quota(text) from public, anon, authenticated;
grant execute on function public.roamly_consume_contact_request_quota(text) to service_role;

notify pgrst, 'reload schema';
