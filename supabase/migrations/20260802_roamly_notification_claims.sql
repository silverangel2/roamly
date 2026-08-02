-- Production hardening for overlapping companion notification delivery workers.
-- Corrects the earlier version of this migration, which changed
-- public.roamly_trip_companion_events instead of the delivery queue table.

create extension if not exists pgcrypto;

alter table public.roamly_companion_notification_deliveries
  add column if not exists processing_lock_token text,
  add column if not exists processing_locked_by text,
  add column if not exists processing_locked_at timestamptz,
  add column if not exists processing_lease_expires_at timestamptz,
  add column if not exists processing_finished_at timestamptz;

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_status_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_status_check
  check (
    status in (
      'queued',
      'processing',
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

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_attempts_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_attempts_check
  check (attempt_count >= 0 and max_attempts >= 0);

alter table public.roamly_companion_notification_deliveries
  drop constraint if exists roamly_companion_notification_processing_lock_check;

alter table public.roamly_companion_notification_deliveries
  add constraint roamly_companion_notification_processing_lock_check
  check (
    (
      processing_lock_token is null
      and processing_locked_by is null
      and processing_locked_at is null
      and processing_lease_expires_at is null
    )
    or (
      processing_lock_token is not null
      and processing_locked_at is not null
      and processing_lease_expires_at is not null
      and status in ('processing', 'sending')
    )
  );

create index if not exists roamly_companion_notification_due_claim_idx
  on public.roamly_companion_notification_deliveries
    (scheduled_for, next_attempt_at, created_at)
  where status in ('queued', 'retrying')
    and processing_lock_token is null;

create index if not exists roamly_companion_notification_processing_lease_idx
  on public.roamly_companion_notification_deliveries
    (processing_lease_expires_at)
  where processing_lock_token is not null;

drop trigger if exists roamly_companion_notification_deliveries_updated_at
  on public.roamly_companion_notification_deliveries;

create trigger roamly_companion_notification_deliveries_updated_at
before update on public.roamly_companion_notification_deliveries
for each row execute function public.roamly_set_updated_at();

create or replace function public.roamly_claim_companion_notification_deliveries(
  p_worker_id text,
  p_batch_size integer default 20,
  p_lease_seconds integer default 900
)
returns setof public.roamly_companion_notification_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with eligible as (
    select d.id
    from public.roamly_companion_notification_deliveries d
    where d.attempt_count < d.max_attempts
      and (
        (
          d.status in ('queued', 'retrying')
          and d.processing_lock_token is null
          and d.scheduled_for <= now()
          and d.next_attempt_at <= now()
        )
        or (
          d.status in ('processing', 'sending')
          and (
            (
              d.processing_lock_token is not null
              and coalesce(d.processing_lease_expires_at, '-infinity'::timestamptz) <= now()
            )
            or (
              d.processing_lock_token is null
              and d.updated_at <= now() - interval '15 minutes'
            )
          )
        )
      )
    order by
      case d.priority
        when 'critical' then 0
        when 'important' then 1
        when 'routine' then 2
        else 3
      end,
      coalesce(d.next_attempt_at, d.scheduled_for, d.created_at),
      d.created_at
    limit greatest(1, least(coalesce(p_batch_size, 20), 100))
    for update skip locked
  )
  update public.roamly_companion_notification_deliveries d
  set
    status = 'processing',
    processing_lock_token = gen_random_uuid()::text,
    processing_locked_by = nullif(trim(coalesce(p_worker_id, '')), ''),
    processing_locked_at = now(),
    processing_lease_expires_at = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 900))),
    processing_finished_at = null,
    attempt_count = d.attempt_count + 1,
    last_error = null
  from eligible
  where d.id = eligible.id
  returning d.*;
end;
$$;

create or replace function public.roamly_complete_companion_notification_delivery(
  p_delivery_id uuid,
  p_processing_lock_token text,
  p_delivery_status text default 'sent',
  p_provider_name text default null,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  completed boolean;
begin
  update public.roamly_companion_notification_deliveries
  set
    status = case
      when p_delivery_status in ('sent', 'delivered', 'captured') then p_delivery_status
      else 'sent'
    end,
    provider_name = coalesce(p_provider_name, provider_name),
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    sent_at = coalesce(sent_at, now()),
    delivered_at = case
      when p_delivery_status = 'delivered' then coalesce(delivered_at, now())
      else delivered_at
    end,
    last_error = null,
    processing_lock_token = null,
    processing_locked_by = null,
    processing_locked_at = null,
    processing_lease_expires_at = null,
    processing_finished_at = now()
  where id = p_delivery_id
    and processing_lock_token = p_processing_lock_token
    and status in ('processing', 'sending')
  returning true into completed;

  return coalesce(completed, false);
end;
$$;

create or replace function public.roamly_release_companion_notification_delivery(
  p_delivery_id uuid,
  p_processing_lock_token text,
  p_next_status text default 'retrying',
  p_next_attempt_at timestamptz default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  released boolean;
begin
  update public.roamly_companion_notification_deliveries
  set
    status = case
      when p_next_status in ('queued', 'retrying', 'failed', 'suppressed') then p_next_status
      else 'retrying'
    end,
    next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
    failed_at = case
      when p_next_status = 'failed' then coalesce(failed_at, now())
      else failed_at
    end,
    suppression_reason = case
      when p_next_status = 'suppressed' then coalesce(p_error, suppression_reason)
      else suppression_reason
    end,
    last_error = coalesce(p_error, last_error),
    processing_lock_token = null,
    processing_locked_by = null,
    processing_locked_at = null,
    processing_lease_expires_at = null,
    processing_finished_at = now()
  where id = p_delivery_id
    and processing_lock_token = p_processing_lock_token
    and status in ('processing', 'sending')
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.roamly_claim_companion_notification_deliveries(text, integer, integer) from public, authenticated;
revoke all on function public.roamly_complete_companion_notification_delivery(uuid, text, text, text, text) from public, authenticated;
revoke all on function public.roamly_release_companion_notification_delivery(uuid, text, text, timestamptz, text) from public, authenticated;

grant execute on function public.roamly_claim_companion_notification_deliveries(text, integer, integer) to service_role;
grant execute on function public.roamly_complete_companion_notification_delivery(uuid, text, text, text, text) to service_role;
grant execute on function public.roamly_release_companion_notification_delivery(uuid, text, text, timestamptz, text) to service_role;
