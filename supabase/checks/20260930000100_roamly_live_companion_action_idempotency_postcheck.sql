-- READ-ONLY postcheck for 20260930000100_roamly_live_companion_action_idempotency.sql.

with expected_indexes as (
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'roamly_trip_events_activity_action_uidx',
      'roamly_trip_companion_events_activity_action_uidx',
      'roamly_notifications_activity_action_uidx'
    )
), checks as (
  select
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_activities') as activities_exist,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_trip_events') as trip_events_exist,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_trip_companion_events') as companion_events_exist,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'roamly_notifications') as notifications_exist,
    (select count(*) from expected_indexes) = 3 as indexes_exist,
    exists (select 1 from expected_indexes where indexname = 'roamly_trip_events_activity_action_uidx' and indexdef like '%UNIQUE INDEX%') as trip_event_index_unique,
    exists (select 1 from expected_indexes where indexname = 'roamly_trip_companion_events_activity_action_uidx' and indexdef like '%UNIQUE INDEX%') as companion_event_index_unique,
    exists (select 1 from expected_indexes where indexname = 'roamly_notifications_activity_action_uidx' and indexdef like '%UNIQUE INDEX%') as notification_index_unique,
    not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'roamly_trip_events_activity_action_uidx'
        and indexdef not like '%activity_id%event_type%'
    ) as trip_event_definition_ok,
    not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'roamly_trip_companion_events_activity_action_uidx'
        and (indexdef not like '%event_type%' or indexdef not like '%metadata%activityId%')
    ) as companion_event_definition_ok,
    not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'roamly_notifications_activity_action_uidx'
        and (indexdef not like '%type%' or indexdef not like '%metadata%activityId%')
    ) as notification_definition_ok
)
select
  case when activities_exist and trip_events_exist and companion_events_exist and notifications_exist
    and indexes_exist and trip_event_index_unique and companion_event_index_unique
    and notification_index_unique and trip_event_definition_ok
    and companion_event_definition_ok and notification_definition_ok
    then 'PASS' else 'FAIL' end as final_status,
  *
from checks;
