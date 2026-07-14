-- Structured booking extraction and trip matching results.

create table if not exists public.booking_extraction_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete set null,
  email_message_id uuid references public.travel_email_messages(id) on delete set null,
  source_type text not null,
  source_reference text,
  extraction_method text not null,
  extracted_booking_json jsonb not null default '{}'::jsonb,
  field_confidence_json jsonb not null default '{}'::jsonb,
  overall_confidence numeric not null default 0,
  match_status text not null default 'unmatched',
  matched_booking_id uuid references public.trip_bookings(id) on delete set null,
  match_reasons text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_extraction_results
  drop constraint if exists booking_extraction_results_source_check,
  drop constraint if exists booking_extraction_results_method_check,
  drop constraint if exists booking_extraction_results_status_check,
  drop constraint if exists booking_extraction_results_confidence_check,
  add constraint booking_extraction_results_source_check check (source_type in ('email', 'upload', 'manual', 'affiliate_conversion')),
  add constraint booking_extraction_results_method_check check (extraction_method in ('deterministic', 'provider_specific', 'ai_structured')),
  add constraint booking_extraction_results_status_check check (match_status in ('unmatched', 'attached', 'needs_confirmation', 'rejected')),
  add constraint booking_extraction_results_confidence_check check (overall_confidence >= 0 and overall_confidence <= 1);

create unique index if not exists booking_extraction_results_source_uidx
  on public.booking_extraction_results (user_id, source_type, source_reference)
  where source_reference is not null;

create index if not exists booking_extraction_results_user_idx
  on public.booking_extraction_results (user_id, created_at desc);

create index if not exists booking_extraction_results_trip_idx
  on public.booking_extraction_results (trip_id, match_status, created_at desc);

create index if not exists booking_extraction_results_email_message_idx
  on public.booking_extraction_results (email_message_id);

drop trigger if exists booking_extraction_results_updated_at on public.booking_extraction_results;
create trigger booking_extraction_results_updated_at
before update on public.booking_extraction_results
for each row execute function public.roamly_set_updated_at();

alter table public.booking_extraction_results enable row level security;

drop policy if exists "Roamly users read own booking extraction results" on public.booking_extraction_results;
create policy "Roamly users read own booking extraction results"
on public.booking_extraction_results
for select
using (user_id = auth.uid());
