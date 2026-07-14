-- Trip feedback and feedback-sourced learning proposals.

create extension if not exists pgcrypto;

create table if not exists public.trip_feedback (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null default 'post_trip',
  trip_day integer,
  overall_satisfaction integer,
  itinerary_pace text,
  transportation_satisfaction integer,
  hotel_location_satisfaction integer,
  hotel_quality_satisfaction integer,
  budget_accuracy integer,
  schedule_realism integer,
  favourite_activities jsonb not null default '[]'::jsonb,
  disappointing_activities jsonb not null default '[]'::jsonb,
  skipped_activities jsonb not null default '[]'::jsonb,
  reasons_for_skipping jsonb not null default '{}'::jsonb,
  would_use_roamly_again boolean,
  free_text_feedback text,
  today_pace text,
  transportation_difficult boolean,
  adjust_tomorrow boolean,
  recommendation_usefulness integer,
  learned_preferences_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (feedback_type in ('post_trip', 'in_trip')),
  check (trip_day is null or trip_day > 0),
  check (overall_satisfaction is null or (overall_satisfaction >= 1 and overall_satisfaction <= 5)),
  check (transportation_satisfaction is null or (transportation_satisfaction >= 1 and transportation_satisfaction <= 5)),
  check (hotel_location_satisfaction is null or (hotel_location_satisfaction >= 1 and hotel_location_satisfaction <= 5)),
  check (hotel_quality_satisfaction is null or (hotel_quality_satisfaction >= 1 and hotel_quality_satisfaction <= 5)),
  check (budget_accuracy is null or (budget_accuracy >= 1 and budget_accuracy <= 5)),
  check (schedule_realism is null or (schedule_realism >= 1 and schedule_realism <= 5)),
  check (recommendation_usefulness is null or (recommendation_usefulness >= 1 and recommendation_usefulness <= 5))
);

create index if not exists trip_feedback_user_idx on public.trip_feedback (user_id, created_at desc);
create index if not exists trip_feedback_trip_idx on public.trip_feedback (trip_id, created_at desc);
create index if not exists trip_feedback_type_idx on public.trip_feedback (feedback_type, created_at desc);

drop trigger if exists trip_feedback_updated_at on public.trip_feedback;
create trigger trip_feedback_updated_at
before update on public.trip_feedback
for each row execute function public.roamly_set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'traveler_preference_events_source_feedback_id_fkey'
  ) then
    alter table public.traveler_preference_events
      add constraint traveler_preference_events_source_feedback_id_fkey
      foreign key (source_feedback_id)
      references public.trip_feedback(id)
      on delete set null
      not valid;
  end if;
end;
$$;

alter table public.trip_feedback enable row level security;

drop policy if exists "Roamly users read own trip feedback" on public.trip_feedback;
create policy "Roamly users read own trip feedback"
on public.trip_feedback
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own trip feedback" on public.trip_feedback;
create policy "Roamly users create own trip feedback"
on public.trip_feedback
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.roamly_trips t
    where t.id = trip_feedback.trip_id
      and t.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users update own trip feedback" on public.trip_feedback;
create policy "Roamly users update own trip feedback"
on public.trip_feedback
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users delete own trip feedback" on public.trip_feedback;
create policy "Roamly users delete own trip feedback"
on public.trip_feedback
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages trip feedback" on public.trip_feedback;
create policy "Roamly service role manages trip feedback"
on public.trip_feedback
for all
to service_role
using (true)
with check (true);
