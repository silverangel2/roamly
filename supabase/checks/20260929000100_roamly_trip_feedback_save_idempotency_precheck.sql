with checks as (
  select 'trip feedback table exists' as check_name,
         to_regclass('public.trip_feedback') is not null as passed
  union all
  select 'feedback slot column absent before migration',
         not exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'trip_feedback' and column_name = 'feedback_slot'
         )
  union all
  select 'unique slot index absent before migration',
         to_regclass('public.trip_feedback_user_slot_unique') is null
  union all
  select 'no existing duplicate feedback slots',
         not exists (
           select 1
           from public.trip_feedback
           group by trip_id, user_id,
             case when feedback_type = 'post_trip' then 0 else coalesce(trip_day, -1) end
           having count(*) > 1
         )
)
select check_name, passed from checks order by check_name;
