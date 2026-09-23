-- ROAMLY BOOKING REFERRAL FOUNDATION POSTCHECK
-- READ-ONLY. Execute manually after applying the migration.

select 'target_table' as result_set, to_regclass('public.roamly_booking_referrals') as table_name;

select 'target_columns' as result_set, ordinal_position, column_name, data_type,
  udt_schema, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'roamly_booking_referrals'
order by ordinal_position;

select 'target_booking_column' as result_set, column_name, data_type, udt_schema,
  udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'roamly_bookings' and column_name = 'referral_id';

with expected(column_name, data_type, udt_schema, udt_name, is_nullable, column_default) as (
  values
    ('id', 'uuid', 'pg_catalog', 'uuid', 'NO', 'gen_random_uuid()'),
    ('user_id', 'uuid', 'pg_catalog', 'uuid', 'NO', null),
    ('trip_id', 'uuid', 'pg_catalog', 'uuid', 'NO', null),
    ('recommendation_id', 'text', 'pg_catalog', 'text', 'YES', null),
    ('booking_type', 'text', 'pg_catalog', 'text', 'NO', '''other''::text'),
    ('provider', 'text', 'pg_catalog', 'text', 'NO', null),
    ('commercial_partner', 'text', 'pg_catalog', 'text', 'NO', null),
    ('destination_url', 'text', 'pg_catalog', 'text', 'NO', null),
    ('affiliate_url', 'text', 'pg_catalog', 'text', 'NO', null),
    ('provider_tracking_reference', 'text', 'pg_catalog', 'text', 'NO', null),
    ('metadata', 'jsonb', 'pg_catalog', 'jsonb', 'NO', '''{}''::jsonb'),
    ('created_at', 'timestamp with time zone', 'pg_catalog', 'timestamptz', 'NO', 'now()')
), actual as (
  select column_name, data_type, udt_schema, udt_name, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'roamly_booking_referrals'
)
select 'target_columns_exact' as result_set, e.column_name, e.data_type as expected_data_type,
  a.data_type as actual_data_type, e.udt_schema as expected_udt_schema,
  a.udt_schema as actual_udt_schema, e.udt_name as expected_udt_name,
  a.udt_name as actual_udt_name, e.is_nullable as expected_is_nullable,
  a.is_nullable as actual_is_nullable, e.column_default as expected_default,
  a.column_default as actual_default,
  case when a.column_name is not null
    and a.data_type = e.data_type and a.udt_schema = e.udt_schema
    and a.udt_name = e.udt_name and a.is_nullable = e.is_nullable
    and coalesce(a.column_default, '') = coalesce(e.column_default, '')
    then 'PASS' else 'FAIL' end as status
from expected e left join actual a using (column_name)
order by e.column_name;

select 'target_booking_referral_column_exact' as result_set, c.column_name,
  c.data_type, c.udt_schema, c.udt_name, c.is_nullable, c.column_default,
  case when c.data_type = 'uuid' and c.udt_schema = 'pg_catalog'
    and c.udt_name = 'uuid' and c.is_nullable = 'YES' and c.column_default is null
    then 'PASS' else 'FAIL' end as status
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'roamly_bookings'
  and c.column_name = 'referral_id';

select 'target_constraints' as result_set, ns.nspname as schema_name, tbl.relname as table_name,
  con.conname as constraint_name, case con.contype when 'p' then 'PRIMARY KEY'
  when 'f' then 'FOREIGN KEY' when 'u' then 'UNIQUE' when 'c' then 'CHECK'
  else con.contype::text end as constraint_type, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class tbl on tbl.oid = con.conrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname = 'public'
  and (tbl.relname = 'roamly_booking_referrals'
    or con.conname in ('roamly_bookings_referral_trip_check', 'roamly_bookings_referral_id_fkey'))
order by tbl.relname, con.conname;

select 'target_named_constraints_exact' as result_set, expected.constraint_name,
  actual.table_name, actual.constraint_type, actual.definition,
  case when actual.constraint_name is not null
    and actual.definition = expected.expected_definition then 'PASS' else 'FAIL' end as status
from (values
  ('roamly_booking_referrals_pkey', 'roamly_booking_referrals', 'PRIMARY KEY', 'PRIMARY KEY (id)'),
  ('roamly_booking_referrals_identity_uq', 'roamly_booking_referrals', 'UNIQUE', 'UNIQUE (id, user_id, trip_id)'),
  ('roamly_bookings_referral_trip_check', 'roamly_bookings', 'CHECK', 'CHECK (((referral_id IS NULL) OR (trip_id IS NOT NULL)))'),
  ('roamly_bookings_referral_id_fkey', 'roamly_bookings', 'FOREIGN KEY', 'FOREIGN KEY (referral_id, user_id, trip_id) REFERENCES public.roamly_booking_referrals(id, user_id, trip_id) ON DELETE RESTRICT')
) expected(constraint_name, table_name, constraint_type, expected_definition)
left join (
  select con.conname as constraint_name, tbl.relname as table_name,
    case con.contype when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY'
      when 'u' then 'UNIQUE' when 'c' then 'CHECK' else con.contype::text end as constraint_type,
    pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class tbl on tbl.oid = con.conrelid
  join pg_namespace ns on ns.oid = tbl.relnamespace
  where ns.nspname = 'public'
) actual using (constraint_name)
order by expected.constraint_name;

select 'target_indexes' as result_set, schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and (tablename = 'roamly_booking_referrals'
    or indexname in ('roamly_bookings_referral_capture_uidx', 'roamly_booking_referrals_provider_tracking_uidx'))
order by tablename, indexname;

select 'target_unique_capture_index_exact' as result_set, c.relname as index_name,
  i.indisunique, pg_get_expr(i.indpred, i.indrelid) as predicate,
  pg_get_indexdef(i.indexrelid) as index_definition,
  case when i.indisunique
    and pg_get_expr(i.indpred, i.indrelid) = '(referral_id IS NOT NULL)'
    and (select array_agg(a.attname order by k.ordinality)
         from unnest(i.indkey) with ordinality k(attnum, ordinality)
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
      = array['user_id', 'trip_id', 'referral_id']::name[]
    then 'PASS' else 'FAIL' end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_index i on i.indexrelid = c.oid
join pg_class t on t.oid = i.indrelid
where n.nspname = 'public' and c.relname = 'roamly_bookings_referral_capture_uidx'
  and t.relname = 'roamly_bookings';

select 'target_rls' as result_set, n.nspname as schema_name, c.relname as table_name,
  c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'roamly_booking_referrals';

select 'target_policies' as result_set, schemaname, tablename, policyname,
  permissive, roles, cmd, qual as using_expression, with_check
from pg_policies
where schemaname = 'public' and tablename = 'roamly_booking_referrals'
order by policyname;

select 'baseline_policies_after_migration' as result_set, schemaname, tablename,
  policyname, permissive, roles, cmd, qual as using_expression, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by tablename, policyname;

select 'target_triggers' as result_set, trigger_schema, event_object_schema,
  event_object_table, trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('roamly_booking_referrals', 'roamly_bookings')
  and (event_object_table = 'roamly_booking_referrals' or trigger_name ilike '%referral%')
order by event_object_table, trigger_name, event_manipulation;

select 'relevant_functions_after_migration' as result_set, n.nspname as schema_name,
  p.proname as function_name, pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ilike '%booking%' or p.proname ilike '%referral%'
    or p.proname ilike '%affiliate%' or p.proname ilike '%conversion%')
order by p.proname, identity_arguments;

select 'legacy_metadata_preservation' as result_set, count(*) as legacy_rows
from public.roamly_bookings
where nullif(trim(metadata->>'affiliateClickId'), '') is not null;

select 'unexpected_target_objects' as result_set, object_type, object_name
from (
  select 'function' as object_type, p.proname as object_name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('roamly_create_booking_referral', 'roamly_capture_booking_referral')
  union all
  select 'trigger', trigger_name
  from information_schema.triggers
  where event_object_schema = 'public'
    and event_object_table = 'roamly_booking_referrals'
) objects
order by object_type, object_name;

select check_name, status, details
from (
  select 'roamly_booking_referrals_exists' as check_name,
    case when to_regclass('public.roamly_booking_referrals') is not null then 'PASS' else 'FAIL' end as status,
    'public.roamly_booking_referrals' as details
  union all
  select 'referral_id_column', case when exists (
    select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'roamly_bookings' and column_name = 'referral_id'
  ) then 'PASS' else 'FAIL' end, 'public.roamly_bookings.referral_id'
  union all
  select 'referral_table_columns_exact', case when (
    select count(*) from (
      select column_name, data_type, udt_schema, udt_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'roamly_booking_referrals'
    ) actual
    where (actual.column_name, actual.data_type, actual.udt_schema, actual.udt_name,
           actual.is_nullable, coalesce(actual.column_default, '')) in (
      ('id', 'uuid', 'pg_catalog', 'uuid', 'NO', 'gen_random_uuid()'),
      ('user_id', 'uuid', 'pg_catalog', 'uuid', 'NO', ''),
      ('trip_id', 'uuid', 'pg_catalog', 'uuid', 'NO', ''),
      ('recommendation_id', 'text', 'pg_catalog', 'text', 'YES', ''),
      ('booking_type', 'text', 'pg_catalog', 'text', 'NO', '''other''::text'),
      ('provider', 'text', 'pg_catalog', 'text', 'NO', ''),
      ('commercial_partner', 'text', 'pg_catalog', 'text', 'NO', ''),
      ('destination_url', 'text', 'pg_catalog', 'text', 'NO', ''),
      ('affiliate_url', 'text', 'pg_catalog', 'text', 'NO', ''),
      ('provider_tracking_reference', 'text', 'pg_catalog', 'text', 'NO', ''),
      ('metadata', 'jsonb', 'pg_catalog', 'jsonb', 'NO', '''{}''::jsonb'),
      ('created_at', 'timestamp with time zone', 'pg_catalog', 'timestamptz', 'NO', 'now()')
    )
  ) = 12 and (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'roamly_booking_referrals'
  ) = 12 then 'PASS' else 'FAIL' end, '12 expected columns/types/nullability/defaults'
  union all
  select 'booking_referral_column_exact', case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'roamly_bookings'
      and column_name = 'referral_id' and data_type = 'uuid'
      and udt_schema = 'pg_catalog' and udt_name = 'uuid'
      and is_nullable = 'YES' and column_default is null
  ) then 'PASS' else 'FAIL' end, 'nullable public.roamly_bookings.referral_id uuid'
  union all
  select 'referral_fk', case when exists (
    select 1 from pg_constraint con join pg_namespace n on n.oid = con.connamespace
      where n.nspname = 'public' and con.conname = 'roamly_bookings_referral_id_fkey'
  ) then 'PASS' else 'FAIL' end, 'roamly_bookings_referral_id_fkey'
  union all
  select 'referral_capture_unique_index', case when exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'roamly_bookings_referral_capture_uidx' and c.relkind = 'i'
  ) then 'PASS' else 'FAIL' end, 'roamly_bookings_referral_capture_uidx'
  union all
  select 'referral_capture_unique_index_exact', case when exists (
    select 1
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_index i on i.indexrelid = c.oid
    join pg_class t on t.oid = i.indrelid
    where n.nspname = 'public' and c.relname = 'roamly_bookings_referral_capture_uidx'
      and t.relname = 'roamly_bookings' and i.indisunique
      and pg_get_expr(i.indpred, i.indrelid) = '(referral_id IS NOT NULL)'
      and (select array_agg(a.attname order by k.ordinality)
           from unnest(i.indkey) with ordinality k(attnum, ordinality)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
        = array['user_id', 'trip_id', 'referral_id']::name[]
  ) then 'PASS' else 'FAIL' end, '(user_id, trip_id, referral_id) WHERE referral_id IS NOT NULL'
  union all
  select 'referral_table_rls', case when exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'roamly_booking_referrals' and c.relrowsecurity
  ) then 'PASS' else 'FAIL' end, 'RLS enabled'
  union all
  select 'referral_read_policy', case when exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'roamly_booking_referrals'
      and policyname = 'Roamly users read own booking referrals' and cmd = 'SELECT'
  ) then 'PASS' else 'FAIL' end, 'ownership-bound authenticated SELECT policy'
  union all
  select 'legacy_rows_rewritten', 'REVIEW', 'Compare legacy_metadata_preservation with precheck; migration performs no backfill'
  union all
  select 'baseline_objects_unchanged', 'REVIEW', 'Compare baseline policy/index/trigger/function result sets with precheck'
) summary
order by check_name;
