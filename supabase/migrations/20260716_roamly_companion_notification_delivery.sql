-- Transactional notifications for Roamly Companion events and repairs.

create table if not exists public.roamly_companion_notification_deliveries (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  booking_id uuid references public.roamly_bookings(id) on delete set null,
  companion_event_id uuid references public.companion_events(id) on delete cascade,
  repair_proposal_id uuid references public.companion_repair_proposals(id) on delete cascade,
  notification_id uuid references public.roamly_notifications(id) on delete set null,

  notification_type text not null,
  priority text not null default 'routine',
  channel text not null default 'email',

  title text not null,
  body text not null,
  action_label text,
  action_url text,

  status text not null default 'queued',
  idempotency_key text not null,

  scheduled_for timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,

  provider_message_id text,
  provider_name text,
  last_error text,
  suppression_reason text,

  is_test boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,

  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_type_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_type_check
  check (
    notification_type in (
      'booking_detected',
      'booking_confirmed',
      'flight_delay',
      'flight_cancelled',
      'booking_changed',
      'repair_proposed',
      'repair_applied',
      'approval_required',
      'daily_briefing',
      'final_day_briefing',
      'check_in_reminder',
      'trip_completed',
      'feedback_request'
    )
  );

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_priority_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_priority_check
  check (priority in ('critical', 'important', 'routine', 'minor'));

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_channel_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_channel_check
  check (channel in ('email', 'push', 'in_app'));

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_status_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_status_check
  check (
    status in (
      'queued',
      'sending',
      'sent',
      'delivered',
      'failed',
      'retrying',
      'suppressed',
      'deduplicated',
      'captured'
    )
  );

create unique index if not exists roamly_companion_notification_idempotency_uidx
  on public.roamly_companion_notification_deliveries (idempotency_key);

create index if not exists roamly_companion_notification_queue_idx
  on public.roamly_companion_notification_deliveries
    (status, next_attempt_at, scheduled_for);

create index if not exists roamly_companion_notification_trip_idx
  on public.roamly_companion_notification_deliveries
    (trip_id, created_at desc);

drop trigger if exists roamly_companion_notification_deliveries_updated_at
  on public.roamly_companion_notification_deliveries;

create trigger roamly_companion_notification_deliveries_updated_at
before update on public.roamly_companion_notification_deliveries
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_companion_notification_deliveries enable row level security;

drop policy if exists "Roamly users read own companion deliveries"
  on public.roamly_companion_notification_deliveries;

create policy "Roamly users read own companion deliveries"
on public.roamly_companion_notification_deliveries
for select
using (user_id = auth.uid());
