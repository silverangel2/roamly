with checks as (
  select
    'pgcrypto extension available' as check_name,
    'gen_random_uuid must be available before the new table is created' as check_description,
    (to_regprocedure('gen_random_uuid()') is not null) as passed,
    true as mandatory,
    10 as sort_key
  union all
  select
    'pattern table absent',
    'the new table must not already exist so the first application is observable',
    (to_regclass('public.successful_trip_experience_patterns') is null),
    true,
    20
  union all
  select
    'destination index absent',
    'the new index must not already exist before the first application',
    (to_regclass('public.successful_trip_experience_patterns_destination_idx') is null),
    true,
    30
  union all
  select
    'service policy name absent',
    'the new service-role policy name must not already exist before the first application',
    not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'successful_trip_experience_patterns'
        and policyname = 'Roamly service role manages successful trip patterns'
    ),
    true,
    40
), output_rows as (
  select check_name, check_description, passed, sort_key
  from checks
  union all
  select
    'SUCCESSFUL_TRIP_EXPERIENCE_PATTERNS_PRE_MIGRATION_VERIFICATION',
    'all mandatory pre-migration checks pass',
    coalesce(bool_and(passed) filter (where mandatory), false),
    999
  from checks
)
select check_name, check_description, passed
from output_rows
order by sort_key, check_name;
