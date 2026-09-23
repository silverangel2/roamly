with relation as (
  select c.oid, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'trip_feedback'
), slot_column as (
  select c.is_generated, c.generation_expression
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'trip_feedback' and c.column_name = 'feedback_slot'
), unique_index as (
  select i.indisunique and i.indisvalid as valid
  from pg_index i join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'trip_feedback_user_slot_unique'
)
select 'feedback slot is generated from feedback type and trip day' as check_name,
       exists (select 1 from slot_column where is_generated = 'ALWAYS'
         and generation_expression ilike '%feedback_type%'
         and generation_expression ilike '%trip_day%') as passed
union all
select 'unique feedback slot index is valid',
       coalesce((select valid from unique_index), false)
union all
select 'RLS remains enabled',
       coalesce((select relrowsecurity from relation), false)
union all
select 'owner-scoped feedback policies remain present',
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trip_feedback'
         and policyname = 'Roamly users create own trip feedback')
       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trip_feedback'
         and policyname = 'Roamly users update own trip feedback');
