-- Roamly provider-based email logs and notification email status.
-- Idempotent and Roamly-prefixed only.

create table if not exists public.roamly_email_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  trip_id uuid,
  notification_id uuid,
  to_email text not null,
  subject text not null,
  provider text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.roamly_notifications add column if not exists email_sent_at timestamptz;
alter table public.roamly_notifications add column if not exists email_status text;
alter table public.roamly_notifications add column if not exists email_error text;

create index if not exists roamly_email_logs_user_idx on public.roamly_email_logs (user_id);
create index if not exists roamly_email_logs_trip_idx on public.roamly_email_logs (trip_id);
create index if not exists roamly_email_logs_notification_idx on public.roamly_email_logs (notification_id);
create index if not exists roamly_email_logs_status_idx on public.roamly_email_logs (status);
create index if not exists roamly_email_logs_created_idx on public.roamly_email_logs (created_at desc);

alter table public.roamly_email_logs enable row level security;
