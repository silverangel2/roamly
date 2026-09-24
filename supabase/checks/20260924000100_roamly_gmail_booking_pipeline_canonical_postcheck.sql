-- ROAMLY GMAIL BOOKING PIPELINE CANONICAL SCHEMA POSTCHECK
-- READ-ONLY. Run only after the matching migration has been applied once.
-- Returns component diagnostics and one final row: FINAL_STATUS = PASS/FAIL.

with
expected_columns(table_name, column_name, expected_data_type, expected_udt_name, expected_nullable) as (
  values
    ('travel_email_messages','id','uuid','uuid','NO'),('travel_email_messages','user_id','uuid','uuid','NO'),('travel_email_messages','email_connection_id','uuid','uuid','NO'),('travel_email_messages','provider','text','text','NO'),('travel_email_messages','provider_message_id','text','text','NO'),('travel_email_messages','sender','text','text','YES'),('travel_email_messages','subject','text','text','YES'),('travel_email_messages','received_at','timestamp with time zone','timestamptz','YES'),('travel_email_messages','extracted_booking_facts','jsonb','jsonb','NO'),('travel_email_messages','parser_confidence','numeric','numeric','NO'),('travel_email_messages','processing_result','text','text','NO'),('travel_email_messages','filter_reasons','ARRAY','_text','NO'),('travel_email_messages','raw_body_retained','boolean','bool','NO'),('travel_email_messages','created_at','timestamp with time zone','timestamptz','NO'),('travel_email_messages','updated_at','timestamp with time zone','timestamptz','NO'),
    ('booking_extraction_results','id','uuid','uuid','NO'),('booking_extraction_results','user_id','uuid','uuid','NO'),('booking_extraction_results','trip_id','uuid','uuid','YES'),('booking_extraction_results','email_message_id','uuid','uuid','YES'),('booking_extraction_results','source_type','text','text','NO'),('booking_extraction_results','source_reference','text','text','YES'),('booking_extraction_results','extraction_method','text','text','NO'),('booking_extraction_results','extracted_booking_json','jsonb','jsonb','NO'),('booking_extraction_results','field_confidence_json','jsonb','jsonb','NO'),('booking_extraction_results','overall_confidence','numeric','numeric','NO'),('booking_extraction_results','match_status','text','text','NO'),('booking_extraction_results','matched_booking_id','uuid','uuid','YES'),('booking_extraction_results','match_reasons','ARRAY','_text','NO'),('booking_extraction_results','email_event_types','ARRAY','_text','NO'),('booking_extraction_results','auto_apply_allowed','boolean','bool','NO'),('booking_extraction_results','requires_user_approval','boolean','bool','NO'),('booking_extraction_results','applied_at','timestamp with time zone','timestamptz','YES'),('booking_extraction_results','idempotency_key','text','text','YES'),('booking_extraction_results','created_at','timestamp with time zone','timestamptz','NO'),('booking_extraction_results','updated_at','timestamp with time zone','timestamptz','NO'),
    ('booking_reconciliation_runs','id','uuid','uuid','NO'),('booking_reconciliation_runs','trip_id','uuid','uuid','NO'),('booking_reconciliation_runs','user_id','uuid','uuid','NO'),('booking_reconciliation_runs','source_booking_id','uuid','uuid','YES'),('booking_reconciliation_runs','status','text','text','NO'),('booking_reconciliation_runs','input_json','jsonb','jsonb','NO'),('booking_reconciliation_runs','output_json','jsonb','jsonb','NO'),('booking_reconciliation_runs','affected_layers','ARRAY','_text','NO'),('booking_reconciliation_runs','created_at','timestamp with time zone','timestamptz','NO'),('booking_reconciliation_runs','updated_at','timestamp with time zone','timestamptz','NO')
),
column_state as (
  select count(*) = 45 as all_count, count(*) filter (where i.column_name is null or i.data_type <> e.expected_data_type or i.udt_name <> e.expected_udt_name or i.is_nullable <> e.expected_nullable) = 0 as all_matching,
    string_agg(case when i.column_name is null then e.table_name || '.' || e.column_name || ':MISSING' when i.data_type <> e.expected_data_type or i.udt_name <> e.expected_udt_name or i.is_nullable <> e.expected_nullable then e.table_name || '.' || e.column_name || ':TYPE_OR_NULLABILITY_MISMATCH' end, ', ' order by e.table_name, e.column_name) as details
  from expected_columns e left join information_schema.columns i on i.table_schema='public' and i.table_name=e.table_name and i.column_name=e.column_name
),
tables_ok as (
  select count(*) = 3 as ok from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs') and c.relkind='r'
),
constraints_ok as (
  select
    exists (select 1 from pg_constraint where conname='travel_email_messages_provider_check' and pg_get_constraintdef(oid) ilike '%provider in%gmail%outlook%')
    and exists (select 1 from pg_constraint where conname='travel_email_messages_result_check')
    and exists (select 1 from pg_constraint where conname='travel_email_messages_confidence_check')
    and exists (select 1 from pg_constraint where conname='travel_email_messages_no_raw_body_check' and pg_get_constraintdef(oid) ilike '%raw_body_retained = false%')
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_source_check')
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_method_check')
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_status_check')
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_confidence_check')
    and exists (select 1 from pg_constraint where conname='booking_reconciliation_runs_status_check') as ok
),
foreign_keys_ok as (
  select
    exists (select 1 from pg_constraint where conname='travel_email_messages_user_id_fkey' and confrelid='auth.users'::regclass)
    and exists (select 1 from pg_constraint where conname='travel_email_messages_email_connection_id_fkey' and confrelid='public.email_connections'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_user_id_fkey' and confrelid='auth.users'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_trip_id_fkey' and confrelid='public.roamly_trips'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_email_message_id_fkey' and confrelid='public.travel_email_messages'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_extraction_results_matched_booking_id_fkey' and confrelid='public.roamly_bookings'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_reconciliation_runs_trip_id_fkey' and confrelid='public.roamly_trips'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_reconciliation_runs_user_id_fkey' and confrelid='auth.users'::regclass)
    and exists (select 1 from pg_constraint where conname='booking_reconciliation_runs_source_booking_id_fkey' and confrelid='public.roamly_bookings'::regclass)
    and exists (select 1 from pg_constraint where conname='roamly_booking_revisions_booking_id_fkey' and confrelid='public.roamly_bookings'::regclass)
    and not exists (select 1 from pg_constraint where conrelid in (to_regclass('public.booking_extraction_results'),to_regclass('public.booking_reconciliation_runs')) and confrelid=to_regclass('public.trip_bookings')) as ok
),
indexes_ok as (
  select
    exists (select 1 from pg_indexes where schemaname='public' and indexname='travel_email_messages_provider_message_uidx' and indexdef like '%(email_connection_id, provider, provider_message_id)%')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='travel_email_messages_user_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='travel_email_messages_processing_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='travel_email_messages_connection_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_source_uidx' and indexdef like '%(user_id, source_type, source_reference)%' and indexdef not like '% WHERE %')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_idempotency_uidx' and indexdef like '%(user_id, idempotency_key)%' and indexdef like '% WHERE %')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_user_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_trip_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_email_message_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_extraction_results_approval_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_reconciliation_runs_trip_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_reconciliation_runs_user_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='booking_reconciliation_runs_source_booking_idx') as ok
),
triggers_ok as (
  select count(*) = 3 as ok
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal and t.tgname in ('travel_email_messages_updated_at','booking_extraction_results_updated_at','booking_reconciliation_runs_updated_at')
),
security_ok as (
  select
    (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs') and c.relkind='r' and c.relrowsecurity) as rls_ok,
    (select count(*)=3 from pg_policies where schemaname='public' and policyname in ('Roamly users read own travel email messages','Roamly users read own booking extraction results','Roamly users read own booking reconciliation runs') and cmd='SELECT' and qual::text ilike '%user_id = auth.uid()%') as policies_ok,
    (select count(distinct table_name)=3 from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='SELECT' and table_name in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs')) as authenticated_select_ok,
    (select count(*)=3 from (select table_name from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and table_name in ('travel_email_messages','booking_extraction_results','booking_reconciliation_runs') group by table_name having count(distinct privilege_type)=4) granted_tables) as service_grants_ok
),
privacy_ok as (
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='travel_email_messages' and column_name='raw_body_retained' and column_default ilike '%false%') and exists (select 1 from pg_constraint where conname='travel_email_messages_no_raw_body_check' and pg_get_constraintdef(oid) ilike '%raw_body_retained = false%') as ok
),
checks as (
  select 'tables' as check_name, ok from tables_ok
  union all select 'all_45_columns_types_nullability', all_count and all_matching from column_state
  union all select 'constraints', ok from constraints_ok
  union all select 'canonical_foreign_keys_no_trip_bookings', ok from foreign_keys_ok
  union all select 'indexes_and_uniqueness', ok from indexes_ok
  union all select 'updated_at_triggers', ok from triggers_ok
  union all select 'rls_and_owner_scoped_policies', rls_ok and policies_ok from security_ok
  union all select 'authenticated_grants', authenticated_select_ok from security_ok
  union all select 'service_role_grants', service_grants_ok from security_ok
  union all select 'raw_body_privacy_boundary', ok from privacy_ok
)
select check_name, status
from (
  select 10 as sort_order, check_name, case when ok then 'PASS' else 'FAIL' end as status
  from checks
  union all
  select 999, 'FINAL_STATUS', case when bool_and(ok) then 'PASS' else 'FAIL' end
  from checks
) output_rows
order by sort_order;
