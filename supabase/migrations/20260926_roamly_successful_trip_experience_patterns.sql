-- Anonymous aggregate patterns derived from qualifying successful-trip contexts.
-- Raw feedback, user IDs, trip IDs, free text, and itinerary text are intentionally absent.

create table if not exists public.successful_trip_experience_patterns (
  id uuid primary key default gen_random_uuid(),
  pattern_key text not null unique,
  destination_key text,
  travel_style text,
  accommodation_preference text,
  transportation_preference text,
  duration_bucket text not null,
  travelers_bucket text not null,
  sample_count integer not null default 0 check (sample_count >= 0),
  average_satisfaction numeric,
  average_schedule_realism numeric,
  average_budget_accuracy numeric,
  average_hotel_location_satisfaction numeric,
  average_hotel_quality_satisfaction numeric,
  average_transportation_satisfaction numeric,
  updated_at timestamptz not null default now(),
  check (sample_count = 0 or sample_count >= 3)
);

create index if not exists successful_trip_experience_patterns_destination_idx
  on public.successful_trip_experience_patterns (destination_key, sample_count desc);

alter table public.successful_trip_experience_patterns enable row level security;

drop policy if exists "Roamly service role manages successful trip patterns"
  on public.successful_trip_experience_patterns;
create policy "Roamly service role manages successful trip patterns"
on public.successful_trip_experience_patterns
for all
to service_role
using (true)
with check (true);
