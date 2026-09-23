-- ROAMLY BOOKING REFERRAL FOUNDATION PRECHECK
-- READ-ONLY. Execute manually immediately before applying the migration.

select 'baseline_tables' as result_set, expected.table_name,
  case when actual.table_name is null then 'MISSING' else 'PRESENT' end as state
from (values ('roamly_bookings'), ('roamly_trips'), ('roamly_itineraries')) expected(table_name)
left join information_schema.tables actual
  on actual.table_schema = 'public' and actual.table_name = expected.table_name
order by expected.table_name;

select 'baseline_columns' as result_set, table_name, ordinal_position, column_name,
  data_type, udt_schema, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by table_name, ordinal_position;

select 'baseline_constraints' as result_set, ns.nspname as schema_name,
  tbl.relname as table_name, con.conname as constraint_name,
  case con.contype when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE' when 'c' then 'CHECK' else con.contype::text end as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class tbl on tbl.oid = con.conrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname = 'public'
  and tbl.relname in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by tbl.relname, con.conname;

select 'baseline_indexes' as result_set, schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by tablename, indexname;

select 'baseline_rls' as result_set, n.nspname as schema_name, c.relname as table_name,
  c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by c.relname;

select 'baseline_policies' as result_set, schemaname, tablename, policyname,
  permissive, roles, cmd, qual as using_expression, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by tablename, policyname;

select 'baseline_triggers' as result_set, trigger_schema, event_object_schema,
  event_object_table, trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
order by event_object_table, trigger_name, event_manipulation;

select 'relevant_functions' as result_set, n.nspname as schema_name, p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ilike '%booking%' or p.proname ilike '%referral%'
    or p.proname ilike '%affiliate%' or p.proname ilike '%conversion%')
order by p.proname, identity_arguments;

select 'target_objects' as result_set, object_type, object_name, state
from (
  select 'table' as object_type, 'roamly_booking_referrals' as object_name,
    case when to_regclass('public.roamly_booking_referrals') is null then 'AVAILABLE' else 'CONFLICT' end as state
  union all
  select 'column', 'roamly_bookings.referral_id',
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roamly_bookings' and column_name = 'referral_id') then 'CONFLICT' else 'AVAILABLE' end
  union all
  select 'foreign_key', 'roamly_bookings_referral_id_fkey',
    case when exists (select 1 from pg_constraint con join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public' and con.conname = 'roamly_bookings_referral_id_fkey') then 'CONFLICT' else 'AVAILABLE' end
  union all
  select 'unique_index', 'roamly_bookings_referral_capture_uidx',
    case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'roamly_bookings_referral_capture_uidx' and c.relkind = 'i') then 'CONFLICT' else 'AVAILABLE' end
) objects
order by object_type, object_name;

select 'legacy_referral_metadata' as result_set, id as booking_id, user_id, trip_id,
  booking_status, traveler_confirmed, metadata->>'affiliateClickId' as affiliate_click_id,
  metadata->>'recommendationId' as recommendation_id,
  metadata->>'sourceReference' as source_reference, created_at, updated_at
from public.roamly_bookings
where nullif(trim(metadata->>'affiliateClickId'), '') is not null
order by created_at, id;

select 'malformed_legacy_referral_ids' as result_set, id as booking_id, user_id, trip_id,
  metadata->>'affiliateClickId' as affiliate_click_id, metadata
from public.roamly_bookings
where nullif(trim(metadata->>'affiliateClickId'), '') is not null
  and metadata->>'affiliateClickId' !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
order by id;

with valid_ids as (
  select id, user_id, trip_id, lower(trim(metadata->>'affiliateClickId')) as legacy_referral_id
  from public.roamly_bookings
  where metadata->>'affiliateClickId' ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
select 'duplicate_legacy_identities' as result_set, user_id, trip_id,
  legacy_referral_id, count(*) as booking_count, array_agg(id order by id) as booking_ids
from valid_ids
group by user_id, trip_id, legacy_referral_id
having count(*) > 1
order by booking_count desc, legacy_referral_id;

select 'legacy_referral_booking_states' as result_set, booking_status, traveler_confirmed,
  coalesce(reconciliation_status, 'unknown') as reconciliation_status,
  coalesce(metadata->>'captureState', 'none') as capture_state, count(*) as booking_count
from public.roamly_bookings
where nullif(trim(metadata->>'affiliateClickId'), '') is not null
group by booking_status, traveler_confirmed, coalesce(reconciliation_status, 'unknown'), coalesce(metadata->>'captureState', 'none')
order by booking_status, traveler_confirmed, reconciliation_status, capture_state;

select 'orphan_referral_ids' as result_set, 'REVIEW' as status,
  'Cannot be established before durable referral relation exists' as details;

select 'user_trip_mismatches' as result_set, 'REVIEW' as status,
  'Cannot be established before durable referral relation exists' as details;

with tables_state as (
  select
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_bookings') as bookings_present,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_trips') as trips_present,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_itineraries') as itineraries_present
), malformed as (
  select count(*) as count from public.roamly_bookings
  where nullif(trim(metadata->>'affiliateClickId'), '') is not null
    and metadata->>'affiliateClickId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
), duplicates as (
  select count(*) as count from (
    select user_id, trip_id, lower(trim(metadata->>'affiliateClickId'))
    from public.roamly_bookings
    where metadata->>'affiliateClickId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    group by user_id, trip_id, lower(trim(metadata->>'affiliateClickId'))
    having count(*) > 1
  ) grouped_duplicates
), target_table as (
  select to_regclass('public.roamly_booking_referrals') is not null as exists_now
), target_column as (
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roamly_bookings' and column_name = 'referral_id') as exists_now
), target_fk as (
  select exists (select 1 from pg_constraint con join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public' and con.conname = 'roamly_bookings_referral_id_fkey') as exists_now
), target_index as (
  select exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'roamly_bookings_referral_capture_uidx' and c.relkind = 'i') as exists_now
), rls_baseline as (
  select count(*) as enabled_count from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries') and c.relrowsecurity
), policy_baseline as (
  select count(*) as policy_count from pg_policies
  where schemaname = 'public' and tablename in ('roamly_bookings', 'roamly_trips', 'roamly_itineraries')
)
select check_name, status, details
from (
  select 'tables_present', case when bookings_present and trips_present and itineraries_present then 'PASS' else 'FAIL' end,
    concat('roamly_bookings=', bookings_present, '; roamly_trips=', trips_present, '; roamly_itineraries=', itineraries_present) from tables_state
  union all select 'target_referral_table_state', case when exists_now then 'REVIEW' else 'PASS' end, case when exists_now then 'already exists' else 'absent' end from target_table
  union all select 'target_column_state', case when exists_now then 'REVIEW' else 'PASS' end, case when exists_now then 'already exists' else 'absent' end from target_column
  union all select 'malformed_referral_ids', case when count = 0 then 'PASS' else 'FAIL' end, concat('malformed_count=', count) from malformed
  union all select 'duplicate_proposed_identities', case when count = 0 then 'PASS' else 'FAIL' end, concat('duplicate_identity_groups=', count) from duplicates
  union all select 'orphan_referral_ids', 'REVIEW', 'Cannot be established before durable referral relation exists'
  union all select 'user_trip_mismatches', 'REVIEW', 'Cannot be established before durable referral relation exists'
  union all select 'target_referral_table_name_available', case when exists_now then 'REVIEW' else 'PASS' end, case when exists_now then 'name conflict' else 'name available' end from target_table
  union all select 'target_fk_name_available', case when exists_now then 'REVIEW' else 'PASS' end, case when exists_now then 'name conflict' else 'name available' end from target_fk
  union all select 'target_unique_index_name_available', case when exists_now then 'REVIEW' else 'PASS' end, case when exists_now then 'name conflict' else 'name available' end from target_index
  union all select 'rls_baseline_captured', case when enabled_count = 3 then 'PASS' else 'FAIL' end, concat('enabled=', enabled_count, '/3') from rls_baseline
  union all select 'policy_baseline_captured', case when policy_count > 0 then 'PASS' else 'REVIEW' end, concat('policy_count=', policy_count) from policy_baseline
) summary(check_name, status, details)
order by check_name;
