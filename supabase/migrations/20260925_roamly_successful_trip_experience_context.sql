alter table public.trip_feedback
  add column if not exists experience_context_json jsonb not null default '{}'::jsonb;

alter table public.trip_feedback
  add constraint trip_feedback_experience_context_object_check
  check (jsonb_typeof(experience_context_json) = 'object');

comment on column public.trip_feedback.experience_context_json is
  'Privacy-safe aggregate-ready trip context; excludes names, booking references, raw itinerary text, and free-form notes.';
