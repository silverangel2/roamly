-- Roamly production wiring, Phase 7 (M3): widen
-- public.roamly_trip_companion_events for the panel v2 runtime
-- (DESIGN-PRODUCTION.md §6 M3): two panel item kinds join the
-- event_type CHECK — 'leave_by' (the anticipation reminder the
-- panel is built around) and 'loud_alert' (BUILD2-SPEC addition A:
-- a collision the traveler must see) — and the 'expired' status
-- joins the status CHECK so a panel event can end its visible life
-- without being cancelled or deleted (expiry is panel-only; the
-- record remains).
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by
-- the Phase 7 build.
--
-- The event_type list below is the CURRENT production list (as last
-- widened by 20260907_roamly_live_companion_activity_start.sql)
-- plus the two additions — nothing is removed, so every existing
-- writer keeps working.

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
    'leave_by', 'loud_alert'
  ));

alter table public.roamly_trip_companion_events
  drop constraint if exists roamly_trip_companion_events_status_check;

alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_status_check check (status in (
    'scheduled', 'shown', 'completed', 'skipped', 'cancelled', 'expired'
  ));
