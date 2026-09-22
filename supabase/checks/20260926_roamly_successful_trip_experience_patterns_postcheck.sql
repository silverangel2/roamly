with checks as (
  select
    'pattern table exists' as check_name,
    (to_regclass('public.successful_trip_experience_patterns') is not null) as passed,
    true as mandatory,
    10 as sort_key
  union all
  select
    'aggregate-only columns exist',
    (
      select count(*) = 16
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'successful_trip_experience_patterns'
        and column_name in (
          'id', 'pattern_key', 'destination_key', 'travel_style',
          'accommodation_preference', 'transportation_preference',
          'duration_bucket', 'travelers_bucket', 'sample_count',
          'average_satisfaction', 'average_schedule_realism',
          'average_budget_accuracy', 'average_hotel_location_satisfaction',
          'average_hotel_quality_satisfaction', 'average_transportation_satisfaction',
          'updated_at'
        )
    ),
    true,
    20
  union all
  select
    'RLS enabled',
    coalesce((select relrowsecurity from pg_class where oid = 'public.successful_trip_experience_patterns'::regclass), false),
    true,
    30
  union all
  select
    'service role policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'successful_trip_experience_patterns'
        and policyname = 'Roamly service role manages successful trip patterns'
        and roles = '{service_role}'
    ),
    true,
    40
  union all
  select
    'no authenticated policies exist',
    not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'successful_trip_experience_patterns'
        and 'authenticated' = any (roles)
    ),
    true,
    50
  union all
  select
    'sample threshold constraint exists',
    exists (
      select 1
      from pg_constraint
      where conrelid = 'public.successful_trip_experience_patterns'::regclass
        and pg_get_constraintdef(oid) like '%sample_count%3%'
    ),
    true,
    60
  union all
  select
    'destination index exists',
    (to_regclass('public.successful_trip_experience_patterns_destination_idx') is not null),
    true,
    70
), output_rows as (
  select check_name, passed, sort_key
  from checks
  union all
  select
    'SUCCESSFUL_TRIP_EXPERIENCE_PATTERNS_POST_MIGRATION_VERIFICATION',
    coalesce(bool_and(passed) filter (where mandatory), false),
    999
  from checks
)
select check_name, passed
from output_rows
order by sort_key, check_name;
