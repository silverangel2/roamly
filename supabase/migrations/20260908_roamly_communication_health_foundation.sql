-- Durable notification-scheduler health state and bounded communication-claim lookup.
-- This migration intentionally leaves the booking_monitor row and its T0 unchanged.

alter table public.roamly_background_health
  add column if not exists last_successful_at timestamptz;

insert into public.roamly_background_health (system_key)
values ('notification_scheduler')
on conflict (system_key) do nothing;

create index if not exists roamly_communication_ledger_claimed_at_idx
  on public.roamly_communication_ledger (claimed_at)
  where status = 'claimed';

create or replace function public.roamly_record_notification_scheduler_success()
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.roamly_background_health
  set last_successful_at = now()
  where system_key = 'notification_scheduler'
  returning true;
$$;

revoke all on function public.roamly_record_notification_scheduler_success() from public, anon, authenticated;
grant execute on function public.roamly_record_notification_scheduler_success() to service_role;
