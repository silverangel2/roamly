-- Share one durable delivery identity between location and scheduled Live Companion alerts.

-- The canonical identity is the SHA-256 key produced by
-- liveCompanionNotificationIdentity(user_id, trip_id, activity_id, event_type).
-- Keep it in its own column so the database can enforce the Live Companion
-- boundary without changing uniqueness for unrelated notification categories.
alter table public.roamly_companion_notification_deliveries
  add column if not exists live_companion_identity text;

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_type_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_type_check check (
    notification_type in (
      'booking_detected', 'booking_confirmed', 'trip_predeparture_7d', 'trip_predeparture_1d',
      'flight_delay', 'flight_cancelled', 'booking_changed', 'repair_proposed', 'repair_applied',
      'approval_required', 'daily_briefing', 'final_day_briefing', 'check_in_reminder',
      'trip_completed', 'feedback_request', 'nearby_activity', 'next_activity', 'leave_by', 'late', 'arrival'
    )
  );

update public.roamly_companion_notification_deliveries
set live_companion_identity = idempotency_key
where notification_type in ('nearby_activity', 'next_activity', 'leave_by', 'late', 'arrival')
  and live_companion_identity is null;

-- Preserve every historical row. If an earlier non-unique implementation
-- already admitted duplicate Live Companion rows, retain the first canonical
-- claim and leave later historical rows outside the new key space rather than
-- deleting them or unrelated notification history.
with ranked as (
  select
    ctid,
    row_number() over (
      partition by live_companion_identity
      order by created_at, id
    ) as duplicate_rank
  from public.roamly_companion_notification_deliveries
  where notification_type in ('nearby_activity', 'next_activity', 'leave_by', 'late', 'arrival')
    and live_companion_identity is not null
)
update public.roamly_companion_notification_deliveries d
set live_companion_identity = null
from ranked
where d.ctid = ranked.ctid
  and ranked.duplicate_rank > 1;

create unique index if not exists roamly_live_companion_delivery_identity_uidx
  on public.roamly_companion_notification_deliveries (live_companion_identity)
  where live_companion_identity is not null
    and notification_type in ('nearby_activity', 'next_activity', 'leave_by', 'late', 'arrival');

create index if not exists roamly_live_companion_delivery_identity_idx
  on public.roamly_companion_notification_deliveries (user_id, trip_id, notification_type, created_at desc)
  where notification_type in ('nearby_activity', 'next_activity', 'leave_by', 'late', 'arrival');
