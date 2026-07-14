-- Roamly itinerary completion email delivery persistence.
-- Idempotent: safe to run more than once in the Roamly Supabase project.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.roamly_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.roamly_email_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  trip_id uuid,
  notification_id uuid,
  to_email text,
  subject text,
  provider text,
  status text not null default 'pending',
  provider_message_id text,
  idempotency_key text,
  template text,
  attempt_count integer not null default 1,
  error text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.roamly_email_logs
  add column if not exists user_id uuid,
  add column if not exists trip_id uuid,
  add column if not exists notification_id uuid,
  add column if not exists to_email text,
  add column if not exists subject text,
  add column if not exists provider text,
  add column if not exists status text not null default 'pending',
  add column if not exists provider_message_id text,
  add column if not exists idempotency_key text,
  add column if not exists template text,
  add column if not exists attempt_count integer not null default 1,
  add column if not exists error text,
  add column if not exists last_error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists sent_at timestamptz;

alter table public.roamly_email_logs
  alter column status set default 'pending',
  alter column attempt_count set default 1,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.roamly_email_logs
  drop constraint if exists roamly_email_logs_status_check,
  drop constraint if exists roamly_email_logs_to_email_not_empty,
  drop constraint if exists roamly_email_logs_subject_not_empty,
  drop constraint if exists roamly_email_logs_attempt_count_check;

alter table public.roamly_email_logs
  add constraint roamly_email_logs_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped', 'captured')),
  add constraint roamly_email_logs_to_email_not_empty
    check (to_email is null or length(btrim(to_email)) > 0),
  add constraint roamly_email_logs_subject_not_empty
    check (subject is null or length(btrim(subject)) > 0),
  add constraint roamly_email_logs_attempt_count_check
    check (attempt_count >= 0);

do $$
begin
  if to_regclass('auth.users') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'roamly_email_logs_user_id_fkey'
        and conrelid = 'public.roamly_email_logs'::regclass
    )
  then
    alter table public.roamly_email_logs
      add constraint roamly_email_logs_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;

  if to_regclass('public.roamly_trips') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'roamly_email_logs_trip_id_fkey'
        and conrelid = 'public.roamly_email_logs'::regclass
    )
  then
    alter table public.roamly_email_logs
      add constraint roamly_email_logs_trip_id_fkey
      foreign key (trip_id) references public.roamly_trips(id) on delete set null;
  end if;

  if to_regclass('public.roamly_notifications') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'roamly_email_logs_notification_id_fkey'
        and conrelid = 'public.roamly_email_logs'::regclass
    )
  then
    alter table public.roamly_email_logs
      add constraint roamly_email_logs_notification_id_fkey
      foreign key (notification_id) references public.roamly_notifications(id) on delete set null;
  end if;
end;
$$;

create index if not exists roamly_email_logs_user_idx on public.roamly_email_logs (user_id);
create index if not exists roamly_email_logs_trip_idx on public.roamly_email_logs (trip_id);
create index if not exists roamly_email_logs_notification_idx on public.roamly_email_logs (notification_id);
create index if not exists roamly_email_logs_status_idx on public.roamly_email_logs (status);
create index if not exists roamly_email_logs_provider_idx on public.roamly_email_logs (provider);
create index if not exists roamly_email_logs_template_idx on public.roamly_email_logs (template);
create index if not exists roamly_email_logs_created_idx on public.roamly_email_logs (created_at desc);
create index if not exists roamly_email_logs_sent_idx on public.roamly_email_logs (sent_at desc) where sent_at is not null;
create index if not exists roamly_email_logs_idempotency_idx on public.roamly_email_logs (idempotency_key) where idempotency_key is not null;
create index if not exists roamly_email_logs_metadata_idempotency_idx
  on public.roamly_email_logs ((metadata->>'idempotencyKey'))
  where metadata ? 'idempotencyKey';

drop trigger if exists roamly_email_logs_updated_at on public.roamly_email_logs;
create trigger roamly_email_logs_updated_at
before update on public.roamly_email_logs
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_email_logs enable row level security;

drop policy if exists "Roamly users read own email logs" on public.roamly_email_logs;
create policy "Roamly users read own email logs"
on public.roamly_email_logs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages email logs" on public.roamly_email_logs;
create policy "Roamly service role manages email logs"
on public.roamly_email_logs
for all
to service_role
using (true)
with check (true);

alter table public.roamly_trips
  add column if not exists completion_email_status text,
  add column if not exists completion_email_sent_at timestamptz,
  add column if not exists completion_email_provider_id text,
  add column if not exists completion_email_attempt_count integer not null default 0,
  add column if not exists completion_email_last_error text,
  add column if not exists completion_email_next_retry_at timestamptz,
  add column if not exists completion_email_idempotency_key text,
  add column if not exists completion_email_recipient_source text,
  add column if not exists completion_email_link text,
  add column if not exists completion_email_permanent_failure boolean not null default false,
  add column if not exists completion_email_last_attempt_at timestamptz;

alter table public.roamly_trips
  drop constraint if exists roamly_trips_completion_email_status_check,
  drop constraint if exists roamly_trips_completion_email_attempt_count_check,
  drop constraint if exists roamly_trips_completion_email_recipient_source_check,
  drop constraint if exists roamly_trips_completion_email_link_check;

alter table public.roamly_trips
  add constraint roamly_trips_completion_email_status_check
    check (
      completion_email_status is null
      or completion_email_status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'captured')
    ),
  add constraint roamly_trips_completion_email_attempt_count_check
    check (completion_email_attempt_count >= 0),
  add constraint roamly_trips_completion_email_recipient_source_check
    check (
      completion_email_recipient_source is null
      or completion_email_recipient_source in ('auth', 'profile')
    ),
  add constraint roamly_trips_completion_email_link_check
    check (
      completion_email_link is null
      or completion_email_link ~* '^https?://'
    );

update public.roamly_trips
set
  completion_email_status = coalesce(
    completion_email_status,
    nullif(metadata #>> '{generationEmail,completion_email_status}', ''),
    nullif(metadata #>> '{generationEmail,delivery_status}', '')
  ),
  completion_email_sent_at = coalesce(
    completion_email_sent_at,
    case
      when nullif(metadata #>> '{generationEmail,completion_email_sent_at}', '') ~ '^\d{4}-\d{2}-\d{2}[T ]'
      then (metadata #>> '{generationEmail,completion_email_sent_at}')::timestamptz
      else null
    end
  ),
  completion_email_provider_id = coalesce(
    completion_email_provider_id,
    nullif(metadata #>> '{generationEmail,completion_email_provider_id}', ''),
    nullif(metadata #>> '{generationEmail,completion_email_provider_message_id}', ''),
    nullif(metadata #>> '{generationEmail,email_provider_message_id}', '')
  ),
  completion_email_attempt_count = greatest(
    coalesce(completion_email_attempt_count, 0),
    case
      when nullif(metadata #>> '{generationEmail,completion_email_attempt_count}', '') ~ '^\d+$'
      then (metadata #>> '{generationEmail,completion_email_attempt_count}')::integer
      else 0
    end
  ),
  completion_email_last_error = coalesce(
    completion_email_last_error,
    nullif(metadata #>> '{generationEmail,completion_email_last_error}', ''),
    nullif(metadata #>> '{generationEmail,last_email_error}', '')
  ),
  completion_email_next_retry_at = coalesce(
    completion_email_next_retry_at,
    case
      when nullif(metadata #>> '{generationEmail,completion_email_next_retry_at}', '') ~ '^\d{4}-\d{2}-\d{2}[T ]'
      then (metadata #>> '{generationEmail,completion_email_next_retry_at}')::timestamptz
      else null
    end
  ),
  completion_email_idempotency_key = coalesce(
    completion_email_idempotency_key,
    nullif(metadata #>> '{generationEmail,completion_email_idempotency_key}', '')
  ),
  completion_email_recipient_source = coalesce(
    completion_email_recipient_source,
    nullif(metadata #>> '{generationEmail,completion_email_recipient_source}', '')
  ),
  completion_email_link = coalesce(
    completion_email_link,
    nullif(metadata #>> '{generationEmail,completion_email_link}', '')
  ),
  completion_email_permanent_failure = completion_email_permanent_failure or coalesce(
    case
      when nullif(metadata #>> '{generationEmail,completion_email_permanent_failure}', '') in ('true', 'false')
      then (metadata #>> '{generationEmail,completion_email_permanent_failure}')::boolean
      else false
    end,
    false
  ),
  completion_email_last_attempt_at = coalesce(
    completion_email_last_attempt_at,
    case
      when nullif(metadata #>> '{generationEmail,last_email_attempt_at}', '') ~ '^\d{4}-\d{2}-\d{2}[T ]'
      then (metadata #>> '{generationEmail,last_email_attempt_at}')::timestamptz
      else null
    end
  )
where metadata ? 'generationEmail';

create index if not exists roamly_trips_completion_email_status_idx
  on public.roamly_trips (completion_email_status);
create index if not exists roamly_trips_completion_email_sent_idx
  on public.roamly_trips (completion_email_sent_at desc)
  where completion_email_sent_at is not null;
create index if not exists roamly_trips_completion_email_retry_idx
  on public.roamly_trips (completion_email_next_retry_at)
  where completion_email_next_retry_at is not null;
create unique index if not exists roamly_trips_completion_email_idempotency_uidx
  on public.roamly_trips (completion_email_idempotency_key)
  where completion_email_idempotency_key is not null;
