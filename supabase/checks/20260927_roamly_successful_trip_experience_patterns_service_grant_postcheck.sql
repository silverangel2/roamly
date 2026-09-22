select
  'service role has required table privileges' as check_name,
  has_table_privilege(
    'service_role',
    'public.successful_trip_experience_patterns',
    'select,insert,update,delete'
  ) as passed
union all
select
  'RLS remains enabled',
  coalesce((select relrowsecurity from pg_class where oid = 'public.successful_trip_experience_patterns'::regclass), false)
union all
select
  'SERVICE_GRANT_POST_MIGRATION_VERIFICATION',
  has_table_privilege(
    'service_role',
    'public.successful_trip_experience_patterns',
    'select,insert,update,delete'
  )
  and coalesce((select relrowsecurity from pg_class where oid = 'public.successful_trip_experience_patterns'::regclass), false);
