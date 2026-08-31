-- Pre-departure reminder event and delivery support.

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
    'test_notification',
    'trip_predeparture_7d',
    'trip_predeparture_1d'
  ));

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_type_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_type_check
  check (
    notification_type in (
      'booking_detected',
      'booking_confirmed',
      'trip_predeparture_7d',
      'trip_predeparture_1d',
      'flight_delay',
      'flight_cancelled',
      'booking_changed',
      'repair_proposed',
      'repair_applied',
      'approval_required',
      'daily_briefing',
      'final_day_briefing',
      'check_in_reminder',
      'trip_completed',
      'feedback_request'
    )
  );

create unique index if not exists roamly_trip_predeparture_reminder_uidx
  on public.roamly_trip_companion_events (
    user_id,
    trip_id,
    event_type,
    ((metadata ->> 'reminder_key'))
  )
  where event_type in ('trip_predeparture_7d', 'trip_predeparture_1d')
    and metadata ? 'reminder_key';
