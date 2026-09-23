-- Rate-limit public support email delivery without persisting raw client IP addresses.
-- The application submits an HMAC-SHA256 of Vercel's trusted x-forwarded-for value.

create table if not exists public.roamly_contact_request_rate_limits (
  actor_hash text primary key check (actor_hash ~ '^[a-f0-9]{64}$'),
  hour_window_start timestamptz not null,
  hour_count integer not null default 0 check (hour_count >= 0),
  day_window_start timestamptz not null,
  day_count integer not null default 0 check (day_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_contact_request_rate_limits_updated_idx
  on public.roamly_contact_request_rate_limits (updated_at);

alter table public.roamly_contact_request_rate_limits enable row level security;
revoke all on table public.roamly_contact_request_rate_limits from public, anon, authenticated;

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
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
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
