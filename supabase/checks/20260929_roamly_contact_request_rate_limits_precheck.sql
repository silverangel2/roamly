-- Read-only precheck. Run immediately before the first application only.
-- Does not inspect customer rows or invoke mutating functions.
with checks as (
  select 'contact quota table absent' as check_name,
         to_regclass('public.roamly_contact_request_rate_limits') is null as passed
  union all
  select 'contact quota function absent',
         to_regprocedure('public.roamly_consume_contact_request_quota(text)') is null
  union all
  select 'contact quota index absent',
         to_regclass('public.roamly_contact_request_rate_limits_updated_idx') is null
  union all
  select 'service_role available',
         exists (select 1 from pg_roles where rolname = 'service_role')
), output_rows as (
  select check_name, passed from checks
  union all
  select 'CONTACT_REQUEST_RATE_LIMITS_PRE_MIGRATION_VERIFICATION',
         coalesce(bool_and(passed), false)
  from checks
)
select check_name, passed from output_rows order by check_name;
