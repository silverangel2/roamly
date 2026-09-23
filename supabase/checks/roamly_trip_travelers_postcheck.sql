-- Read-only postcheck for 20260917_roamly_trip_travelers.sql.
-- Run immediately after manual application. No mutation statements are used.

-- 1. Table existence and relation kind.
select
  n.nspname as schema_name,
  c.relname as relation_name,
  c.relkind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'roamly_trip_travelers';

-- 2. Exact columns, types, nullability, and defaults.
select
  table_schema,
  table_name,
  column_name,
  ordinal_position,
  data_type,
  udt_schema,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'roamly_trip_travelers'
order by ordinal_position;

-- 3. Exact constraints and foreign-key delete behavior.
select
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'c' then 'CHECK'
    else con.contype::text
  end as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'roamly_trip_travelers'
order by con.conname;

-- 4. Exact indexes, including partial account-holder uniqueness.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'roamly_trip_travelers'
order by indexname;

-- 5. Exact trigger and helper binding.
select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'roamly_trip_travelers';

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'roamly_set_updated_at';

-- 6. Exact policy set.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'roamly_trip_travelers'
order by policyname;

-- 7. Effective table privileges relevant to customer/server access.
select
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'roamly_trip_travelers'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

-- 8. Immediate post-application row check. Expected to be zero because the
-- migration contains no backfill or other data-writing statement.
select count(*) as trip_traveler_rows_immediately_after_migration
from public.roamly_trip_travelers;

-- 9. Baseline objects remain present.
select
  required_relation,
  to_regclass(required_relation) is not null as present
from (
  values
    ('public.roamly_trips'),
    ('public.traveler_profiles'),
    ('public.traveler_preference_events'),
    ('public.trip_feedback'),
    ('public.roamly_bookings')
) as relations(required_relation);

-- 10. Baseline comparison snapshot. Compare these values with the completed
-- precheck results; this migration contains no statements that rewrite them.
select
  (select count(*) from public.roamly_trips) as trip_rows,
  (select count(*) from public.roamly_trips where travelers_count > 1) as multi_traveler_trips,
  (select count(*) from public.traveler_profiles) as traveler_profile_rows,
  (select count(*) from public.traveler_profiles where passport_issuing_country is not null) as profiles_with_passport_country;
