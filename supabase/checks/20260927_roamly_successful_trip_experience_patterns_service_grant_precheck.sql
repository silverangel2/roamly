select
  'successful trip pattern table exists' as check_name,
  (to_regclass('public.successful_trip_experience_patterns') is not null) as passed
union all
select
  'service role privilege state',
  has_table_privilege(
    'service_role',
    'public.successful_trip_experience_patterns',
    'select,insert,update,delete'
  )
union all
select
  'SERVICE_GRANT_PRE_MIGRATION_VERIFICATION',
  (to_regclass('public.successful_trip_experience_patterns') is not null)
  and coalesce((select relrowsecurity from pg_class where oid = 'public.successful_trip_experience_patterns'::regclass), false);
