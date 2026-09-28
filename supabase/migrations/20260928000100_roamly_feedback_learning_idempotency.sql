-- Make feedback-sourced traveler learning idempotent at the database boundary.
-- The identity preserves distinct preference values from one feedback record
-- while preventing the same canonical signal from being inserted twice.

do $$
begin
  if exists (
    select 1
    from public.traveler_preference_events
    where source = 'trip_feedback'
      and source_feedback_id is not null
    group by source_feedback_id, preference_key, proposed_value
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'ROAMLY_FEEDBACK_LEARNING_DUPLICATES_REQUIRE_REVIEW';
  end if;
end;
$$;

alter table public.traveler_preference_events
  add column if not exists feedback_learning_identity text
  generated always as (
    case
      when source = 'trip_feedback' and source_feedback_id is not null then
        source_feedback_id::text || ':' || preference_key || ':' ||
        md5(coalesce(proposed_value, 'null'::jsonb)::text)
      else null
    end
  ) stored;

create unique index if not exists traveler_preference_events_feedback_learning_uidx
  on public.traveler_preference_events (feedback_learning_identity);
