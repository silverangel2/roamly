-- Close the spam-cannon holes found by the 2026-11-06 security pass
-- (Check 5): two Roamly email senders had no throttle at all.
--
--   * POST /api/trips/[id]/email sent the itinerary email to a recipient
--     taken verbatim from the request body, unlimited times. The route now
--     also only ever sends to the account's own email address (fixed in
--     the route); this migration adds the volume limit: a per-account and
--     per-IP quota, roamly_consume_trip_email_quota, 5/hour and 20/day
--     per actor.
--   * POST /api/trips/guest-itinerary/recover mailed a recovery link on
--     every POST, forever. It now consumes roamly_consume_recovery_email_quota
--     before each send: 1/hour and 5/day per actor, keyed separately by
--     the target email address and by the caller IP, so neither a single
--     address nor a single source can be used to mail-bomb anyone. The
--     route's generic reply is unchanged, so the cooldown reveals nothing
--     about whether an address holds a trip.
--
-- Both quotas copy the contact form's proven shape
-- (20260929_roamly_contact_request_rate_limits): pseudonymous HMAC actor
-- hashes only (no raw IPs or email addresses are stored), table locked to
-- the service role, consume function callable only by the service role.

create table if not exists public.roamly_trip_email_rate_limits (
  actor_hash text primary key check (actor_hash ~ '^[a-f0-9]{64}$'),
  hour_window_start timestamptz not null,
  hour_count integer not null default 0 check (hour_count >= 0),
  day_window_start timestamptz not null,
  day_count integer not null default 0 check (day_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_trip_email_rate_limits_updated_idx
  on public.roamly_trip_email_rate_limits (updated_at);

alter table public.roamly_trip_email_rate_limits enable row level security;
revoke all on table public.roamly_trip_email_rate_limits from public, anon, authenticated;

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
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
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

create table if not exists public.roamly_recovery_email_rate_limits (
  actor_hash text primary key check (actor_hash ~ '^[a-f0-9]{64}$'),
  hour_window_start timestamptz not null,
  hour_count integer not null default 0 check (hour_count >= 0),
  day_window_start timestamptz not null,
  day_count integer not null default 0 check (day_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_recovery_email_rate_limits_updated_idx
  on public.roamly_recovery_email_rate_limits (updated_at);

alter table public.roamly_recovery_email_rate_limits enable row level security;
revoke all on table public.roamly_recovery_email_rate_limits from public, anon, authenticated;

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
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
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

notify pgrst, 'reload schema';
