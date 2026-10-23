-- Roamly E2E fix (2026-10-23): add 'processing' to the
-- public.roamly_trip_companion_events status CHECK.
--
-- Without this, the companion email/push dispatcher can never deliver
-- anything. sendScheduledTripNotifications (lib/roamly/pushServer.ts)
-- claims each due event with an atomic conditional update to
-- status='processing' (and every post-claim write filters on
-- status='processing'), but the status CHECK has never allowed that
-- value: created in 20260706_roamly_budget_booking_companion_notifications.sql
-- as ('scheduled', 'shown', 'completed', 'skipped', 'cancelled') and last
-- widened by 20261022_roamly_companion_panel_event_types.sql to add
-- 'expired' — still no 'processing'. Every claim therefore fails with
-- Postgres 23514 (check violation), the dispatcher skips the event, and
-- due events are selected run after run but never emailed, marked, or
-- even rescheduled (proven live in the 2026-10-23 E2E audit, §F:
-- 5 dispatches, 16-17 due events each, 0 sent, 0 mutated).
--
-- The list below is the CURRENT production list (as last widened by
-- 20261022_roamly_companion_panel_event_types.sql) plus 'processing' —
-- nothing is removed, so every existing writer keeps working.
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by
-- the fix build.

alter table public.roamly_trip_companion_events
  drop constraint if exists roamly_trip_companion_events_status_check;

alter table public.roamly_trip_companion_events
  add constraint roamly_trip_companion_events_status_check check (status in (
    'scheduled', 'processing', 'shown', 'completed', 'skipped', 'cancelled', 'expired'
  ));
