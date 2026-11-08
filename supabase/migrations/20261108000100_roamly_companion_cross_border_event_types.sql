-- Roamly daily test 2026-11-08 (Trujillo, Peru — first international
-- destination to reach companion unlock in the daily test): the
-- pre-trip timeline builder (lib/roamly/tripCompanion.ts,
-- buildPreTripTimeline) emits 8 cross-border event types for
-- international trips, and NONE of them is in the production
-- event_type CHECK. scheduleCompanionEvents inserts the whole
-- timeline as ONE multi-row insert, so one bad type fails the
-- entire batch: an international trip unlocks but holds ZERO
-- companion events and therefore gets ZERO dispatcher reminder
-- emails (two companion_scheduling_failed records on the test
-- trip, 12:43:38Z and 12:48:26Z). Domestic trips are unaffected
-- (their batches contain only allowed types).
--
-- This migration widens the CHECK to include the 8 cross-border
-- types. Nothing is removed, so every existing writer keeps
-- working.
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule).
--
-- The event_type list below is the CURRENT production list (as last
-- widened by 20261022_roamly_companion_panel_event_types.sql)
-- plus the eight additions.

alter table public.roamly_trip_companion_events
  drop constraint if exists roamly_trip_companion_events_event_type_check;

alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_event_type_check check (event_type in (
    'one_week_before', 'one_day_before', 'countdown_24h', 'document_check', 'packing_check',
    'country_info', 'check_in_reminder', 'travel_day_started', 'trip_activated',
    'nearby_activity', 'activity_start', 'up_next_activity', 'booking_reminder', 'budget_warning',
    'navigation_opened', 'activity_checked_in', 'activity_skipped', 'activity_completed',
    'arrival_detected', 'departure_reminder', 'running_late', 'route_status',
    'booking_schedule_changed', 'test_notification',
    'leave_by', 'loud_alert',
    'cross_border_documents', 'offline_maps', 'roaming_esim', 'save_hotel_address_offline',
    'destination_emergency_number', 'border_documents', 'currency_payment', 'border_time_buffer'
  ));
