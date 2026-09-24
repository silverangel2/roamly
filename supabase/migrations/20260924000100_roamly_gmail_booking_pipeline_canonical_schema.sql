-- Canonical Gmail booking pipeline schema.
--
-- This is intentionally forward-only. It replaces the obsolete July helper
-- shape that referenced public.trip_bookings with the current canonical
-- public.roamly_bookings wallet. Apply only after the companion precheck.

create table public.travel_email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider text not null,
  provider_message_id text not null,
  sender text,
  subject text,
  received_at timestamptz,
  extracted_booking_facts jsonb not null default '{}'::jsonb,
  parser_confidence numeric not null default 0,
  processing_result text not null default 'ignored',
  filter_reasons text[] not null default '{}'::text[],
  raw_body_retained boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_email_messages_provider_check check (provider in ('gmail', 'outlook')),
  constraint travel_email_messages_result_check check (processing_result in ('ignored', 'filtered', 'relevant', 'extracted', 'error')),
  constraint travel_email_messages_confidence_check check (parser_confidence >= 0 and parser_confidence <= 1),
  constraint travel_email_messages_no_raw_body_check check (raw_body_retained = false)
);

create unique index travel_email_messages_provider_message_uidx
  on public.travel_email_messages (email_connection_id, provider, provider_message_id);

create index travel_email_messages_user_idx
  on public.travel_email_messages (user_id, received_at desc);

create index travel_email_messages_processing_idx
  on public.travel_email_messages (provider, processing_result, received_at desc);

create index travel_email_messages_connection_idx
  on public.travel_email_messages (email_connection_id, received_at desc);

create trigger travel_email_messages_updated_at
before update on public.travel_email_messages
for each row execute function public.roamly_set_updated_at();

alter table public.travel_email_messages enable row level security;

create policy "Roamly users read own travel email messages"
on public.travel_email_messages
for select
to authenticated
using (user_id = auth.uid());

grant select on table public.travel_email_messages to authenticated;
grant all privileges on table public.travel_email_messages to service_role;

create table public.booking_extraction_results (
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
  matched_booking_id uuid references public.roamly_bookings(id) on delete set null,
  match_reasons text[] not null default '{}'::text[],
  email_event_types text[] not null default '{}'::text[],
  auto_apply_allowed boolean not null default false,
  requires_user_approval boolean not null default false,
  applied_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_extraction_results_source_check check (source_type in ('email', 'upload', 'manual', 'affiliate_conversion')),
  constraint booking_extraction_results_method_check check (extraction_method in ('deterministic', 'provider_specific', 'ai_structured')),
  constraint booking_extraction_results_status_check check (match_status in ('unmatched', 'attached', 'needs_confirmation', 'rejected')),
  constraint booking_extraction_results_confidence_check check (overall_confidence >= 0 and overall_confidence <= 1)
);

-- Full unique index so PostgREST's onConflict=user_id,source_type,source_reference
-- can infer it directly. Current extraction always supplies source_reference as
-- email:<provider>:<provider_message_id>.
create unique index booking_extraction_results_source_uidx
  on public.booking_extraction_results (user_id, source_type, source_reference)
;

create unique index booking_extraction_results_idempotency_uidx
  on public.booking_extraction_results (user_id, idempotency_key)
  where idempotency_key is not null;

create index booking_extraction_results_user_idx
  on public.booking_extraction_results (user_id, created_at desc);

create index booking_extraction_results_trip_idx
  on public.booking_extraction_results (trip_id, match_status, created_at desc);

create index booking_extraction_results_email_message_idx
  on public.booking_extraction_results (email_message_id);

create index booking_extraction_results_approval_idx
  on public.booking_extraction_results (user_id, requires_user_approval, match_status, created_at desc);

create trigger booking_extraction_results_updated_at
before update on public.booking_extraction_results
for each row execute function public.roamly_set_updated_at();

alter table public.booking_extraction_results enable row level security;

create policy "Roamly users read own booking extraction results"
on public.booking_extraction_results
for select
to authenticated
using (user_id = auth.uid());

grant select on table public.booking_extraction_results to authenticated;
grant all privileges on table public.booking_extraction_results to service_role;

create table public.booking_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_booking_id uuid references public.roamly_bookings(id) on delete set null,
  status text not null default 'completed',
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  affected_layers text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_reconciliation_runs_status_check check (status in ('completed', 'needs_confirmation', 'failed'))
);

create index booking_reconciliation_runs_trip_idx
  on public.booking_reconciliation_runs (trip_id, created_at desc);

create index booking_reconciliation_runs_user_idx
  on public.booking_reconciliation_runs (user_id, created_at desc);

create index booking_reconciliation_runs_source_booking_idx
  on public.booking_reconciliation_runs (source_booking_id);

create trigger booking_reconciliation_runs_updated_at
before update on public.booking_reconciliation_runs
for each row execute function public.roamly_set_updated_at();

alter table public.booking_reconciliation_runs enable row level security;

create policy "Roamly users read own booking reconciliation runs"
on public.booking_reconciliation_runs
for select
to authenticated
using (user_id = auth.uid());

grant select on table public.booking_reconciliation_runs to authenticated;
grant all privileges on table public.booking_reconciliation_runs to service_role;
