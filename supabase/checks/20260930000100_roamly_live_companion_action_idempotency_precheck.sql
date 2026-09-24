-- READ-ONLY precheck for 20260930000100_roamly_live_companion_action_idempotency.sql.
-- Returns exactly one final classification: SAFE_TO_APPLY, ALREADY_APPLIED,
-- CONFLICT, or BLOCKED.

with required_tables as (
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('roamly_activities', 'roamly_trip_events', 'roamly_trip_companion_events', 'roamly_notifications')
), expected_columns as (
  select * from (values
    ('roamly_activities', 'id', 'uuid'),
    ('roamly_activities', 'trip_id', 'uuid'),
    ('roamly_activities', 'status', 'text'),
    ('roamly_trip_events', 'user_id', 'uuid'),
    ('roamly_trip_events', 'trip_id', 'uuid'),
    ('roamly_trip_events', 'activity_id', 'uuid'),
    ('roamly_trip_events', 'event_type', 'text'),
    ('roamly_trip_companion_events', 'user_id', 'uuid'),
    ('roamly_trip_companion_events', 'trip_id', 'uuid'),
    ('roamly_trip_companion_events', 'event_type', 'text'),
    ('roamly_trip_companion_events', 'metadata', 'jsonb'),
    ('roamly_notifications', 'user_id', 'uuid'),
    ('roamly_notifications', 'trip_id', 'uuid'),
    ('roamly_notifications', 'type', 'text'),
    ('roamly_notifications', 'metadata', 'jsonb')
  ) as columns(table_name, column_name, data_type)
), required_columns as (
  select expected_columns.*
  from expected_columns
  join information_schema.columns
    on columns.table_schema = 'public'
   and columns.table_name = expected_columns.table_name
   and columns.column_name = expected_columns.column_name
   and columns.data_type = expected_columns.data_type
), duplicate_trip_events as (
  select count(*) as duplicate_groups
  from (
    select user_id, trip_id, activity_id, event_type
    from public.roamly_trip_events
    where activity_id is not null
      and event_type in ('activity_checked_in', 'activity_skipped')
    group by user_id, trip_id, activity_id, event_type
    having count(*) > 1
  ) grouped
), duplicate_companion_events as (
  select count(*) as duplicate_groups
  from (
    select user_id, trip_id, event_type, metadata ->> 'activityId' as activity_id
    from public.roamly_trip_companion_events
    where event_type in ('activity_checked_in', 'activity_skipped')
      and metadata ? 'activityId'
      and nullif(trim(metadata ->> 'activityId'), '') is not null
    group by user_id, trip_id, event_type, metadata ->> 'activityId'
    having count(*) > 1
  ) grouped
), duplicate_notifications as (
  select count(*) as duplicate_groups
  from (
    select user_id, trip_id, type, metadata ->> 'activityId' as activity_id
    from public.roamly_notifications
    where type in ('activity_checked_in', 'activity_skipped')
      and metadata ? 'activityId'
      and nullif(trim(metadata ->> 'activityId'), '') is not null
    group by user_id, trip_id, type, metadata ->> 'activityId'
    having count(*) > 1
  ) grouped
), expected_indexes as (
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'roamly_trip_events_activity_action_uidx',
      'roamly_trip_companion_events_activity_action_uidx',
      'roamly_notifications_activity_action_uidx'
    )
), object_state as (
  select
    (select count(*) from required_tables) = 4 as tables_present,
    (select count(*) from required_columns) = 15 as columns_present,
    (select count(*) from expected_indexes) = 3
      and (select count(*) from expected_indexes where indexdef ilike '%unique index%') = 3 as indexes_present,
    (select count(*) from expected_indexes) = 0
      or (select count(*) from expected_indexes where indexdef ilike '%unique index%') = (select count(*) from expected_indexes) as no_conflicting_index_definitions,
    (select duplicate_groups from duplicate_trip_events) = 0
      and (select duplicate_groups from duplicate_companion_events) = 0
      and (select duplicate_groups from duplicate_notifications) = 0 as no_duplicate_rows,
    exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'roamly_activities') as activity_table_present
)
select
  case
    when not activity_table_present then 'BLOCKED'
    when tables_present and columns_present and indexes_present and no_conflicting_index_definitions then 'ALREADY_APPLIED'
    when not tables_present or not columns_present or not no_duplicate_rows or (not indexes_present and not no_conflicting_index_definitions) then 'CONFLICT'
    else 'SAFE_TO_APPLY'
  end as final_classification,
  tables_present,
  columns_present,
  indexes_present,
  no_conflicting_index_definitions,
  no_duplicate_rows,
  activity_table_present,
  (select count(*) from required_tables) as required_table_count,
  (select count(*) from required_columns) as required_column_count,
  (select count(*) from expected_indexes) as existing_target_index_count,
  (select duplicate_groups from duplicate_trip_events) as duplicate_trip_event_groups,
  (select duplicate_groups from duplicate_companion_events) as duplicate_companion_event_groups,
  (select duplicate_groups from duplicate_notifications) as duplicate_notification_groups;
