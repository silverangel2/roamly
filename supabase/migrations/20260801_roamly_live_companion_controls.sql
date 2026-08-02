-- Live Companion active-trip controls and notification event types.

alter table public.roamly_companion_preferences
  add column if not exists live_companion_enabled boolean not null default true,
  add column if not exists live_companion_paused_until timestamptz,
  add column if not exists background_location_enabled boolean not null default false;

alter table public.roamly_trip_companion_events
  drop constraint if exists roamly_trip_companion_events_event_type_check,
  drop constraint if exists roamly_trip_companion_events_type_live_check;

alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_event_type_check check (event_type in (
    'one_week_before',
    'one_day_before',
    'countdown_24h',
    'document_check',
    'packing_check',
    'country_info',
    'check_in_reminder',
    'travel_day_started',
    'trip_activated',
    'nearby_activity',
    'up_next_activity',
    'booking_reminder',
    'budget_warning',
    'navigation_opened',
    'activity_checked_in',
    'activity_skipped',
    'activity_completed',
    'arrival_detected',
    'departure_reminder',
    'running_late',
    'route_status',
    'booking_schedule_changed',
    'test_notification'
  ));
