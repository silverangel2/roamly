-- Privacy-first travel email filtering for Roamly Companion.
-- Stores only minimal message metadata and structured extracted facts.

create table if not exists public.travel_email_messages (
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
  updated_at timestamptz not null default now()
);

alter table public.travel_email_messages
  drop constraint if exists travel_email_messages_provider_check,
  drop constraint if exists travel_email_messages_result_check,
  drop constraint if exists travel_email_messages_confidence_check,
  drop constraint if exists travel_email_messages_no_raw_body_check,
  add constraint travel_email_messages_provider_check check (provider in ('gmail', 'outlook')),
  add constraint travel_email_messages_result_check check (processing_result in ('ignored', 'filtered', 'relevant', 'extracted', 'error')),
  add constraint travel_email_messages_confidence_check check (parser_confidence >= 0 and parser_confidence <= 1),
  add constraint travel_email_messages_no_raw_body_check check (raw_body_retained = false);

create unique index if not exists travel_email_messages_provider_message_uidx
  on public.travel_email_messages (email_connection_id, provider, provider_message_id);

create index if not exists travel_email_messages_user_idx
  on public.travel_email_messages (user_id, received_at desc);

create index if not exists travel_email_messages_processing_idx
  on public.travel_email_messages (provider, processing_result, received_at desc);

create index if not exists travel_email_messages_connection_idx
  on public.travel_email_messages (email_connection_id, received_at desc);

drop trigger if exists travel_email_messages_updated_at on public.travel_email_messages;
create trigger travel_email_messages_updated_at
before update on public.travel_email_messages
for each row execute function public.roamly_set_updated_at();

alter table public.travel_email_messages enable row level security;

drop policy if exists "Roamly users read own travel email messages" on public.travel_email_messages;
create policy "Roamly users read own travel email messages"
on public.travel_email_messages
for select
using (user_id = auth.uid());
