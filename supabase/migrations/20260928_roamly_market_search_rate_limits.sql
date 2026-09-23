-- Atomically cap authenticated live-market searches per account.
-- The RPC derives the caller from auth.uid(); clients cannot choose a user or bucket.

create table if not exists public.roamly_market_search_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('minute', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket)
);

alter table public.roamly_market_search_rate_limits enable row level security;
revoke all on table public.roamly_market_search_rate_limits from public, anon, authenticated;

create or replace function public.roamly_consume_market_search_quota()
returns table (
  allowed boolean,
  retry_after_seconds integer,
  minute_remaining integer,
  day_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  current_time_utc timestamptz := clock_timestamp();
  minute_start timestamptz;
  day_start timestamptz;
  minute_count integer;
  day_count integer;
  retry_after integer := 0;
begin
  if caller_id is null then
    raise exception 'authenticated user required';
  end if;

  minute_start := to_timestamp(floor(extract(epoch from current_time_utc) / 60) * 60);
  day_start := to_timestamp(floor(extract(epoch from current_time_utc) / 86400) * 86400);

  insert into public.roamly_market_search_rate_limits as current_limit (user_id, bucket, window_start, request_count)
  values (caller_id, 'minute', minute_start, 1)
  on conflict (user_id, bucket) do update
    set window_start = excluded.window_start,
        request_count = case
          when current_limit.window_start = excluded.window_start then current_limit.request_count + 1
          else 1
        end,
        updated_at = current_time_utc
  returning request_count into minute_count;

  insert into public.roamly_market_search_rate_limits as current_limit (user_id, bucket, window_start, request_count)
  values (caller_id, 'day', day_start, 1)
  on conflict (user_id, bucket) do update
    set window_start = excluded.window_start,
        request_count = case
          when current_limit.window_start = excluded.window_start then current_limit.request_count + 1
          else 1
        end,
        updated_at = current_time_utc
  returning request_count into day_count;

  if minute_count > 12 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (minute_start + interval '1 minute' - current_time_utc))::numeric)::integer);
  end if;
  if day_count > 120 then
    retry_after := greatest(retry_after, ceil(extract(epoch from (day_start + interval '1 day' - current_time_utc))::numeric)::integer);
  end if;

  return query select
    minute_count <= 12 and day_count <= 120,
    greatest(0, retry_after),
    greatest(0, 12 - minute_count),
    greatest(0, 120 - day_count);
end;
$$;

revoke all on function public.roamly_consume_market_search_quota() from public, anon;
grant execute on function public.roamly_consume_market_search_quota() to authenticated;
