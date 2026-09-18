-- ROAMLY BOOKING SUPERSESSION V1 POSTCHECK
-- READ-ONLY. Execute manually after applying the migration.
-- No CREATE, ALTER, INSERT, UPDATE, DELETE, or RPC mutation statements.

-- ============================================================
-- 1. New column
-- ============================================================

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
  and table_name = 'roamly_bookings'
  and column_name = 'superseded_by_booking_id';


-- ============================================================
-- 2. New constraints and normalized definitions
-- ============================================================

select
  ns.nspname as schema_name,
  rel.relname as table_name,
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    else con.contype::text
  end as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition,
  con.condeferrable,
  con.condeferred
from pg_constraint con
join pg_class rel
  on rel.oid = con.conrelid
join pg_namespace ns
  on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'roamly_bookings'
  and con.conname in (
    'roamly_bookings_owner_trip_id_uq',
    'roamly_bookings_superseded_by_self_ck',
    'roamly_bookings_superseded_by_fkey'
  )
order by con.conname;


-- ============================================================
-- 3. Supporting unique key and existing primary key
-- ============================================================

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'roamly_bookings'
  and indexname in (
    'roamly_bookings_owner_trip_id_uq',
    'roamly_bookings_pkey'
  )
order by indexname;


-- ============================================================
-- 4. Exact FK target and delete action
-- ============================================================

select
  con.conname as constraint_name,
  source_ns.nspname as source_schema,
  source_rel.relname as source_table,
  target_ns.nspname as target_schema,
  target_rel.relname as target_table,
  pg_get_constraintdef(con.oid, true) as definition,
  con.condeferrable,
  con.condeferred
from pg_constraint con
join pg_class source_rel
  on source_rel.oid = con.conrelid
join pg_namespace source_ns
  on source_ns.oid = source_rel.relnamespace
join pg_class target_rel
  on target_rel.oid = con.confrelid
join pg_namespace target_ns
  on target_ns.oid = target_rel.relnamespace
where source_ns.nspname = 'public'
  and source_rel.relname = 'roamly_bookings'
  and con.conname = 'roamly_bookings_superseded_by_fkey';


-- ============================================================
-- 5. RLS and exact policy preservation
-- ============================================================

select
  n.nspname as schema_name,
  c.relname as relation_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'roamly_bookings';

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
  and tablename = 'roamly_bookings'
order by policyname;


-- ============================================================
-- 6. Supersession write boundary
-- ============================================================

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
join pg_class c
  on c.oid = t.tgrelid
join pg_namespace n
  on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'roamly_bookings'
  and t.tgname = 'roamly_bookings_supersession_guard';

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'roamly_guard_booking_supersession';

select
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'roamly_bookings'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, privilege_type;


-- ============================================================
-- 7. No lineage rows or migration-created booking rows
-- ============================================================

select
  count(*) as total_booking_rows,
  count(*) filter (
    where superseded_by_booking_id is not null
  ) as lineage_rows,
  count(*) filter (
    where traveler_confirmed = true
  ) as traveler_confirmed_rows,
  count(*) filter (
    where booking_status in ('booked', 'paid', 'reserved')
  ) as confirmed_like_status_rows,
  count(*) filter (
    where booking_status in ('cancelled', 'refunded')
  ) as cancelled_or_refunded_rows
from public.roamly_bookings;


-- ============================================================
-- 8. Structural lineage integrity checks
-- ============================================================

select
  count(*) filter (
    where superseded_by_booking_id = id
  ) as self_links,
  count(*) filter (
    where superseded_by_booking_id is not null
      and trip_id is null
  ) as tripless_lineage_rows,
  count(*) filter (
    where successor.id is null
  ) as missing_successors,
  count(*) filter (
    where successor.id is not null
      and (
        successor.user_id <> predecessor.user_id
        or successor.trip_id <> predecessor.trip_id
      )
  ) as cross_owner_or_cross_trip_links
from public.roamly_bookings predecessor
left join public.roamly_bookings successor
  on successor.user_id = predecessor.user_id
 and successor.trip_id = predecessor.trip_id
 and successor.id = predecessor.superseded_by_booking_id
where predecessor.superseded_by_booking_id is not null;


-- ============================================================
-- 9. Existing baseline objects remain present
-- ============================================================

select
  required_relation,
  to_regclass(required_relation) is not null as present
from (
  values
    ('public.roamly_trips'),
    ('public.roamly_bookings'),
    ('public.roamly_booking_revisions'),
    ('public.booking_reconciliation_runs'),
    ('public.booking_change_events'),
    ('public.roamly_booking_referrals')
) as relations(required_relation);


-- ============================================================
-- 10. Booking status values remain unchanged
-- ============================================================

select
  booking_status,
  count(*) as row_count
from public.roamly_bookings
group by booking_status
order by booking_status;


-- ============================================================
-- 11. Existing booking trigger remains present
-- ============================================================

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
join pg_class c
  on c.oid = t.tgrelid
join pg_namespace n
  on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname = 'roamly_bookings'
order by t.tgname;


-- ============================================================
-- 12. No unexpected lineage objects
-- ============================================================

select
  table_schema,
  table_name,
  column_name
from information_schema.columns
where table_schema = 'public'
  and (
    column_name ilike '%supersed%'
    or column_name ilike '%replac%'
    or column_name ilike '%lineage%'
  )
order by table_name, column_name;
