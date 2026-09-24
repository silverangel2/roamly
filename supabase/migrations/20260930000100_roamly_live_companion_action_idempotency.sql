-- Concurrency-safe identity boundaries for user-driven Live Companion actions.
-- Skip and Check-in status transitions are guarded in application code; these
-- unique indexes make their durable operational effects idempotent as well.

create unique index roamly_trip_events_activity_action_uidx
  on public.roamly_trip_events (user_id, trip_id, activity_id, event_type)
  where activity_id is not null
    and event_type in ('activity_checked_in', 'activity_skipped');

create unique index roamly_trip_companion_events_activity_action_uidx
  on public.roamly_trip_companion_events (
    user_id,
    trip_id,
    event_type,
    ((metadata ->> 'activityId'))
  )
  where event_type in ('activity_checked_in', 'activity_skipped')
    and metadata ? 'activityId'
    and nullif(trim(metadata ->> 'activityId'), '') is not null;

create unique index roamly_notifications_activity_action_uidx
  on public.roamly_notifications (
    user_id,
    trip_id,
    type,
    ((metadata ->> 'activityId'))
  )
  where type in ('activity_checked_in', 'activity_skipped')
    and metadata ? 'activityId'
    and nullif(trim(metadata ->> 'activityId'), '') is not null;
