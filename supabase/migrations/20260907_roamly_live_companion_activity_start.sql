-- Add the server-time Live Companion start transition to the existing
-- durable push identity boundary.

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_type_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_type_check check (
    notification_type in (
      'booking_detected', 'booking_confirmed', 'trip_predeparture_7d', 'trip_predeparture_1d',
      'flight_delay', 'flight_cancelled', 'booking_changed', 'repair_proposed', 'repair_applied',
      'approval_required', 'daily_briefing', 'final_day_briefing', 'check_in_reminder',
      'trip_completed', 'feedback_request', 'nearby_activity', 'activity_start', 'next_activity',
      'leave_by', 'late', 'arrival'
    )
  );

alter table public.roamly_trip_companion_events
  drop constraint if exists roamly_trip_companion_events_event_type_check;

alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_event_type_check check (event_type in (
    'one_week_before', 'one_day_before', 'countdown_24h', 'document_check', 'packing_check',
    'country_info', 'check_in_reminder', 'travel_day_started', 'trip_activated',
    'nearby_activity', 'activity_start', 'up_next_activity', 'booking_reminder', 'budget_warning',
    'navigation_opened', 'activity_checked_in', 'activity_skipped', 'activity_completed',
    'arrival_detected', 'departure_reminder', 'running_late', 'route_status',
    'booking_schedule_changed', 'test_notification'
  ));

-- Extend the existing canonical identity index so concurrent lifecycle runs
-- cannot create two start deliveries for the same user/trip/activity.
drop index if exists public.roamly_live_companion_delivery_identity_uidx;

create unique index if not exists roamly_live_companion_delivery_identity_uidx
  on public.roamly_companion_notification_deliveries (live_companion_identity)
  where live_companion_identity is not null
    and notification_type in ('nearby_activity', 'activity_start', 'next_activity', 'leave_by', 'late', 'arrival');
