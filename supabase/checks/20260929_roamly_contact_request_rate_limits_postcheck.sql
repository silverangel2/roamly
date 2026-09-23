-- Read-only postcheck. Run after the migration returns success.
-- Does not inspect customer rows or invoke the quota-consuming function.
with relation as (
  select c.oid, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'roamly_contact_request_rate_limits'
), expected_columns(column_name, data_type, is_nullable) as (
  values
    ('actor_hash', 'text', 'NO'),
    ('hour_window_start', 'timestamp with time zone', 'NO'),
    ('hour_count', 'integer', 'NO'),
    ('day_window_start', 'timestamp with time zone', 'NO'),
    ('day_count', 'integer', 'NO'),
    ('updated_at', 'timestamp with time zone', 'NO')
), column_check as (
  select count(*) = 6 as passed
  from expected_columns e
  join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = 'roamly_contact_request_rate_limits'
   and c.column_name = e.column_name
   and c.data_type = e.data_type
   and c.is_nullable = e.is_nullable
), function_record as (
  select p.oid, p.prosecdef, p.proconfig, p.proretset, p.prorettype,
         pg_get_function_identity_arguments(p.oid) as identity_arguments,
         pg_get_function_result(p.oid) as result_type
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'roamly_consume_contact_request_quota'
), checks as (
  select 'contact quota table exists' as check_name,
         exists (select 1 from relation) as passed
  union all
  select 'required columns and types exist',
         coalesce((select passed from column_check), false)
  union all
  select 'primary key is actor hash',
         exists (
           select 1 from pg_constraint
           where conrelid = (select oid from relation)
             and contype = 'p'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (actor_hash)'
         )
  union all
  select 'RLS enabled',
         coalesce((select relrowsecurity from relation), false)
  union all
  select 'no table access for public API roles',
         case when exists (select 1 from relation) then
           not has_table_privilege('anon', 'public.roamly_contact_request_rate_limits', 'SELECT')
           and not has_table_privilege('authenticated', 'public.roamly_contact_request_rate_limits', 'SELECT')
           and not has_table_privilege('anon', 'public.roamly_contact_request_rate_limits', 'INSERT')
           and not has_table_privilege('authenticated', 'public.roamly_contact_request_rate_limits', 'INSERT')
           and not has_table_privilege('anon', 'public.roamly_contact_request_rate_limits', 'UPDATE')
           and not has_table_privilege('authenticated', 'public.roamly_contact_request_rate_limits', 'UPDATE')
           and not has_table_privilege('anon', 'public.roamly_contact_request_rate_limits', 'DELETE')
           and not has_table_privilege('authenticated', 'public.roamly_contact_request_rate_limits', 'DELETE')
         else false end
  union all
  select 'cleanup index exists',
         to_regclass('public.roamly_contact_request_rate_limits_updated_idx') is not null
  union all
  select 'service-only security definer RPC exists',
         exists (
           select 1 from function_record f
           where f.identity_arguments = 'p_actor_hash text'
             and f.prosecdef
             and f.proretset
             and f.prorettype = 'record'::regtype
             and f.result_type = 'TABLE(allowed boolean, retry_after_seconds integer, hour_remaining integer, day_remaining integer)'
             and 'search_path=public' = any(coalesce(f.proconfig, array[]::text[]))
             and has_function_privilege('service_role', f.oid, 'EXECUTE')
             and not has_function_privilege('anon', f.oid, 'EXECUTE')
             and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
         )
), output_rows as (
  select check_name, passed from checks
  union all
  select 'CONTACT_REQUEST_RATE_LIMITS_POST_MIGRATION_VERIFICATION',
         coalesce(bool_and(passed), false)
  from checks
)
select check_name, passed from output_rows order by check_name;
