-- Keep one post-trip response per trip and one in-trip check-in per trip day.
-- Precheck must be clean before applying so historical feedback is never rewritten.

alter table public.trip_feedback
  add column if not exists feedback_slot integer
  generated always as (
    case
      when feedback_type = 'post_trip' then 0
      else coalesce(trip_day, -1)
    end
  ) stored;

create unique index if not exists trip_feedback_user_slot_unique
  on public.trip_feedback (trip_id, user_id, feedback_slot);
