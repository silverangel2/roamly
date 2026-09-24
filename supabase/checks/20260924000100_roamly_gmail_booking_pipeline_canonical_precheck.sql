-- ROAMLY GMAIL BOOKING PIPELINE CANONICAL SCHEMA PRECHECK
-- READ-ONLY. Run this query in the production Supabase SQL Editor before
-- considering application of the matching forward-only migration.
--
-- The final row is FINAL_CLASSIFICATION and returns exactly one of:
-- SAFE_TO_APPLY, ALREADY_APPLIED, CONFLICT, BLOCKED.

with
expected_tables(table_name) as (
  values
    ('travel_email_messages'::text),
    ('booking_extraction_results'::text),
    ('booking_reconciliation_runs'::text)
),
target_table_state as (
  select e.table_name, c.oid is not null as present, c.relkind = 'r' as is_table
  from expected_tables e
  left join pg_class c on c.oid = to_regclass('public.' || e.table_name)
),
expected_columns(table_name, column_name, expected_data_type, expected_udt_name, expected_nullable) as (
  values
    ('travel_email_messages','id','uuid','uuid','NO'),('travel_email_messages','user_id','uuid','uuid','NO'),('travel_email_messages','email_connection_id','uuid','uuid','NO'),('travel_email_messages','provider','text','text','NO'),('travel_email_messages','provider_message_id','text','text','NO'),('travel_email_messages','sender','text','text','YES'),('travel_email_messages','subject','text','text','YES'),('travel_email_messages','received_at','timestamp with time zone','timestamptz','YES'),('travel_email_messages','extracted_booking_facts','jsonb','jsonb','NO'),('travel_email_messages','parser_confidence','numeric','numeric','NO'),('travel_email_messages','processing_result','text','text','NO'),('travel_email_messages','filter_reasons','ARRAY','_text','NO'),('travel_email_messages','raw_body_retained','boolean','bool','NO'),('travel_email_messages','created_at','timestamp with time zone','timestamptz','NO'),('travel_email_messages','updated_at','timestamp with time zone','timestamptz','NO'),
    ('booking_extraction_results','id','uuid','uuid','NO'),('booking_extraction_results','user_id','uuid','uuid','NO'),('booking_extraction_results','trip_id','uuid','uuid','YES'),('booking_extraction_results','email_message_id','uuid','uuid','YES'),('booking_extraction_results','source_type','text','text','NO'),('booking_extraction_results','source_reference','text','text','YES'),('booking_extraction_results','extraction_method','text','text','NO'),('booking_extraction_results','extracted_booking_json','jsonb','jsonb','NO'),('booking_extraction_results','field_confidence_json','jsonb','jsonb','NO'),('booking_extraction_results','overall_confidence','numeric','numeric','NO'),('booking_extraction_results','match_status','text','text','NO'),('booking_extraction_results','matched_booking_id','uuid','uuid','YES'),('booking_extraction_results','match_reasons','ARRAY','_text','NO'),('booking_extraction_results','email_event_types','ARRAY','_text','NO'),('booking_extraction_results','auto_apply_allowed','boolean','bool','NO'),('booking_extraction_results','requires_user_approval','boolean','bool','NO'),('booking_extraction_results','applied_at','timestamp with time zone','timestamptz','YES'),('booking_extraction_results','idempotency_key','text','text','YES'),('booking_extraction_results','created_at','timestamp with time zone','timestamptz','NO'),('booking_extraction_results','updated_at','timestamp with time zone','timestamptz','NO'),
    ('booking_reconciliation_runs','id','uuid','uuid','NO'),('booking_reconciliation_runs','trip_id','uuid','uuid','NO'),('booking_reconciliation_runs','user_id','uuid','uuid','NO'),('booking_reconciliation_runs','source_booking_id','uuid','uuid','YES'),('booking_reconciliation_runs','status','text','text','NO'),('booking_reconciliation_runs','input_json','jsonb','jsonb','NO'),('booking_reconciliation_runs','output_json','jsonb','jsonb','NO'),('booking_reconciliation_runs','affected_layers','ARRAY','_text','NO'),('booking_reconciliation_runs','created_at','timestamp with time zone','timestamptz','NO'),('booking_reconciliation_runs','updated_at','timestamp with time zone','timestamptz','NO')
),
column_state as (
  select count(*) as expected_count, count(i.column_name) as present_count,
    count(*) filter (where i.column_name is null or i.data_type <> e.expected_data_type or i.udt_name <> e.expected_udt_name or i.is_nullable <> e.expected_nullable) as mismatch_count,
    string_agg(case when i.column_name is null then e.table_name || '.' || e.column_name || ':MISSING' when i.data_type <> e.expected_data_type or i.udt_name <> e.expected_udt_name or i.is_nullable <> e.expected_nullable then e.table_name || '.' || e.column_name || ':TYPE_OR_NULLABILITY_MISMATCH' end, ', ' order by e.table_name, e.column_name) as mismatches
  from expected_columns e
  left join information_schema.columns i on i.table_schema = 'public' and i.table_name = e.table_name and i.column_name = e.column_name
),
dependency_state as (
  select
    to_regclass('public.roamly_bookings') is not null as bookings_present,
    to_regclass('public.roamly_booking_revisions') is not null as revisions_present,
    to_regclass('public.email_connections') is not null as connections_present,
    to_regclass('public.roamly_trips') is not null as trips_present,
    to_regprocedure('public.roamly_set_updated_at()') is not null as updated_at_function_present,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='roamly_bookings' and column_name='id' and data_type='uuid' and udt_name='uuid') as bookings_id_uuid,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='roamly_bookings' and column_name='user_id' and data_type='uuid' and udt_name='uuid') as bookings_user_id_uuid,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='roamly_bookings' and column_name='trip_id' and data_type='uuid' and udt_name='uuid') as bookings_trip_id_uuid,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_connections' and column_name='id' and data_type='uuid' and udt_name='uuid') as connections_id_uuid,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='roamly_trips' and column_name='id' and data_type='uuid' and udt_name='uuid') as trips_id_uuid,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='roamly_booking_revisions' and column_name='booking_id' and data_type='uuid' and udt_name='uuid') as revisions_booking_id_uuid
),
named_object_state as (
  select
    exists (select 1 from pg_class where relname='travel_email_messages_provider_message_uidx' and relkind='i') as travel_message_unique_index,
    exists (select 1 from pg_class where relname='booking_extraction_results_source_uidx' and relkind='i') as extraction_source_index,
    exists (select 1 from pg_class where relname='booking_extraction_results_idempotency_uidx' and relkind='i') as extraction_idempotency_index,
    exists (select 1 from pg_class where relname='booking_reconciliation_runs_trip_idx' and relkind='i') as reconciliation_trip_index,
    exists (select 1 from pg_class where relname='booking_reconciliation_runs_user_idx' and relkind='i') as reconciliation_user_index,
    exists (select 1 from pg_class where relname='booking_reconciliation_runs_source_booking_idx' and relkind='i') as reconciliation_source_index,
    exists (select 1 from pg_constraint where conname='travel_email_messages_no_raw_body_check') as raw_body_constraint,
    exists (select 1 from pg_constraint where conname='booking_extraction_results_matched_booking_id_fkey') as extraction_booking_fk,
    exists (select 1 from pg_constraint where conname='booking_reconciliation_runs_source_booking_id_fkey') as reconciliation_booking_fk,
    exists (select 1 from pg_trigger where tgname='travel_email_messages_updated_at') as travel_message_trigger,
    exists (select 1 from pg_trigger where tgname='booking_extraction_results_updated_at') as extraction_trigger,
    exists (select 1 from pg_trigger where tgname='booking_reconciliation_runs_updated_at') as reconciliation_trigger
),
canonical_fk_state as (
  select
    exists (select 1 from pg_constraint where conname='booking_extraction_results_email_message_id_fkey' and confrelid=to_regclass('public.travel_email_messages')) as extraction_email_fk,
    exists (select 1 from pg_constraint where conname='booking_extraction_results_matched_booking_id_fkey' and confrelid=to_regclass('public.roamly_bookings')) as extraction_booking_fk_canonical,
    exists (select 1 from pg_constraint where conname='booking_reconciliation_runs_source_booking_id_fkey' and confrelid=to_regclass('public.roamly_bookings')) as reconciliation_booking_fk_canonical,
    exists (select 1 from pg_constraint where conname='roamly_booking_revisions_booking_id_fkey' and confrelid=to_regclass('public.roamly_bookings')) as revisions_booking_fk_canonical,
    not exists (select 1 from pg_constraint where conrelid in (to_regclass('public.booking_extraction_results'),to_regclass('public.booking_reconciliation_runs')) and confrelid=to_regclass('public.trip_bookings')) as no_obsolete_trip_bookings_fk
),
index_definition_state as (
  select
    exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_source_uidx' and indexdef like '%(user_id, source_type, source_reference)%' and indexdef not like '% WHERE %') as full_source_uniqueness,
    exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_idempotency_uidx' and indexdef like '%(user_id, idempotency_key)%' and indexdef like '% WHERE %') as idempotency_uniqueness,
    exists (select 1 from pg_indexes where schemaname='public' and indexname='travel_email_messages_provider_message_uidx' and indexdef like '%(email_connection_id, provider, provider_message_id)%') as travel_message_uniqueness
),
security_state as (
  select
    (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs') and c.relkind='r' and c.relrowsecurity) as rls_enabled,
    (select count(*)=3 from pg_policies where schemaname='public' and policyname in ('Roamly users read own travel email messages','Roamly users read own booking extraction results','Roamly users read own booking reconciliation runs') and cmd='SELECT') as read_policies,
    (select count(distinct table_name)=3 from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='SELECT' and table_name in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs')) as authenticated_select_grants,
    (select count(*)=3 from (select table_name from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and privilege_type in ('INSERT','UPDATE','DELETE') and table_name in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs') group by table_name having count(distinct privilege_type)=3) granted_tables) as service_write_grants
),
collision_state as (
  select
    not exists (select 1 from pg_class where relname in ('travel_email_messages_provider_message_uidx','booking_extraction_results_source_uidx','booking_extraction_results_idempotency_uidx','booking_reconciliation_runs_trip_idx','booking_reconciliation_runs_user_idx','booking_reconciliation_runs_source_booking_idx') and relkind='i')
    and not exists (select 1 from pg_constraint where conname in ('travel_email_messages_no_raw_body_check','booking_extraction_results_matched_booking_id_fkey','booking_reconciliation_runs_source_booking_id_fkey'))
    as named_index_constraint_names_available,
    not exists (select 1 from pg_trigger where tgname in ('travel_email_messages_updated_at','booking_extraction_results_updated_at','booking_reconciliation_runs_updated_at')) as trigger_names_available,
    not exists (select 1 from pg_policies where schemaname='public' and policyname in ('Roamly users read own travel email messages','Roamly users read own booking extraction results','Roamly users read own booking reconciliation runs')) as policy_names_available
),
privacy_state as (
  select
    exists (select 1 from pg_constraint where conname='travel_email_messages_no_raw_body_check' and pg_get_constraintdef(oid) ilike '%raw_body_retained = false%') as raw_body_constraint,
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='travel_email_messages' and column_name='raw_body_retained' and column_default ilike '%false%') as raw_body_default
),
shape_state as (
  select
    (select bool_and(present and is_table) from target_table_state) as all_target_tables,
    (select bool_or(present) from target_table_state) as any_target_table,
    (select expected_count=present_count and mismatch_count=0 from column_state) as all_columns,
    (select bookings_present and revisions_present and connections_present and trips_present and updated_at_function_present and bookings_id_uuid and bookings_user_id_uuid and bookings_trip_id_uuid and connections_id_uuid and trips_id_uuid and revisions_booking_id_uuid from dependency_state) as dependencies,
    (select extraction_email_fk and extraction_booking_fk_canonical and reconciliation_booking_fk_canonical and revisions_booking_fk_canonical and no_obsolete_trip_bookings_fk from canonical_fk_state) as canonical_foreign_keys,
    (select full_source_uniqueness and idempotency_uniqueness and travel_message_uniqueness from index_definition_state) as indexes,
    (select travel_message_unique_index and extraction_source_index and extraction_idempotency_index and reconciliation_trip_index and reconciliation_user_index and reconciliation_source_index and raw_body_constraint and extraction_booking_fk and reconciliation_booking_fk and travel_message_trigger and extraction_trigger and reconciliation_trigger from named_object_state) as named_objects,
    (select rls_enabled and read_policies=3 and authenticated_select_grants and service_write_grants from security_state) as security,
    (select raw_body_constraint and raw_body_default from privacy_state) as privacy,
    (select named_index_constraint_names_available and trigger_names_available and policy_names_available from collision_state) as collision_free
),
checks as (
  select 10 as sort_order, 'target_tables' as check_name, case when all_target_tables then 'PRESENT' else 'ABSENT_OR_PARTIAL' end as observed, (not any_target_table or all_target_tables) as passed, 'Expected target tables: travel_email_messages, booking_extraction_results, booking_reconciliation_runs' as details from shape_state
  union all select 20, 'target_columns_and_types', (select present_count || '/' || expected_count || ' columns present; mismatches=' || mismatch_count from column_state), all_columns, coalesce((select mismatches from column_state),'none') from shape_state
  union all select 30, 'canonical_dependencies', case when dependencies then 'PRESENT_AND_COMPATIBLE' else 'MISSING_OR_INCOMPATIBLE' end, dependencies, 'roamly_bookings, roamly_booking_revisions, email_connections, roamly_trips, and roamly_set_updated_at()' from shape_state
  union all select 40, 'foreign_keys', case when canonical_foreign_keys then 'CANONICAL' else 'MISSING_CONFLICTING_OR_OBSOLETE' end, canonical_foreign_keys, 'Booking references must target roamly_bookings; trip_bookings is forbidden' from shape_state
  union all select 50, 'indexes_and_uniqueness', case when indexes then 'EXPECTED' else 'MISSING_OR_CONFLICTING' end, indexes, 'Includes full source uniqueness for PostgREST onConflict and partial idempotency uniqueness' from shape_state
  union all select 60, 'constraints_triggers_and_named_objects', case when named_objects then 'EXPECTED' else 'MISSING_OR_CONFLICTING' end, named_objects, 'Checks privacy constraint, foreign keys, indexes, and updated_at triggers' from shape_state
  union all select 70, 'rls_policies_and_grants', case when security then 'EXPECTED' else 'MISSING_OR_CONFLICTING' end, security, 'RLS enabled; authenticated SELECT is owner-scoped; service role has server writes' from shape_state
  union all select 80, 'privacy_raw_body_boundary', case when privacy then 'ENFORCED' else 'MISSING_OR_CONFLICTING' end, privacy, 'raw_body_retained must default false and be constrained false' from shape_state
  union all select 90, 'target_name_collisions', case when collision_free then 'NONE' else 'CONFLICTING_OBJECT_NAME' end, collision_free, 'No target index, constraint, trigger, or policy names may already belong to another object' from shape_state
),
classification as (
  select case
    when not dependencies then 'BLOCKED'
    when all_target_tables and all_columns and canonical_foreign_keys and indexes and named_objects and security and privacy then 'ALREADY_APPLIED'
    when any_target_table then 'CONFLICT'
    when not collision_free then 'CONFLICT'
    else 'SAFE_TO_APPLY'
  end as result
  from shape_state
)
select check_name, observed, status, details
from (
  select sort_order, check_name, observed, case when passed then 'PASS' else 'FAIL' end as status, details
  from checks
  union all
  select 999, 'FINAL_CLASSIFICATION', result, result, 'Run the migration only if this value is SAFE_TO_APPLY or ALREADY_APPLIED.'
  from classification
) output_rows
order by sort_order;
