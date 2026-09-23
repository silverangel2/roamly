-- Read-only precheck. Run immediately before the first application only.
-- Does not inspect user rows or invoke mutating functions.
with checks as (
  select 'market quota table absent' as check_name,
         to_regclass('public.roamly_market_search_rate_limits') is null as passed
  union all
  select 'market quota function absent',
         to_regprocedure('public.roamly_consume_market_search_quota()') is null
  union all
  select 'auth users relation available',
         to_regclass('auth.users') is not null
  union all
  select 'required API roles available',
         exists (select 1 from pg_roles where rolname = 'anon')
         and exists (select 1 from pg_roles where rolname = 'authenticated')
         and exists (select 1 from pg_roles where rolname = 'service_role')
), output_rows as (
  select check_name, passed from checks
  union all
  select 'MARKET_SEARCH_RATE_LIMITS_PRE_MIGRATION_VERIFICATION',
         coalesce(bool_and(passed), false)
  from checks
)
select check_name, passed from output_rows order by check_name;
