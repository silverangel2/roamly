-- Privacy-focused email connection foundation for Roamly Companion.

create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expiry timestamptz,
  granted_scopes text[] not null default '{}'::text[],
  connection_status text not null default 'connected',
  email_address text,
  last_synced_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_connections
  drop constraint if exists email_connections_provider_check,
  drop constraint if exists email_connections_status_check,
  add constraint email_connections_provider_check check (provider in ('gmail', 'outlook')),
  add constraint email_connections_status_check check (connection_status in ('connected', 'needs_reauth', 'syncing', 'disconnected', 'error'));

create unique index if not exists email_connections_user_provider_uidx
  on public.email_connections (user_id, provider);

create index if not exists email_connections_status_idx
  on public.email_connections (provider, connection_status, last_synced_at);

create table if not exists public.email_watch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider text not null,
  external_subscription_id text,
  expiration_time timestamptz,
  status text not null default 'active',
  last_renewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_watch_subscriptions
  drop constraint if exists email_watch_subscriptions_provider_check,
  drop constraint if exists email_watch_subscriptions_status_check,
  add constraint email_watch_subscriptions_provider_check check (provider in ('gmail', 'outlook')),
  add constraint email_watch_subscriptions_status_check check (status in ('active', 'renewal_due', 'expired', 'stopped', 'error'));

create unique index if not exists email_watch_subscriptions_connection_uidx
  on public.email_watch_subscriptions (email_connection_id, provider);

create index if not exists email_watch_subscriptions_expiration_idx
  on public.email_watch_subscriptions (provider, expiration_time);

create table if not exists public.email_sync_cursors (
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider text not null,
  history_id_or_delta_token text,
  last_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email_connection_id, provider)
);

alter table public.email_sync_cursors
  drop constraint if exists email_sync_cursors_provider_check,
  add constraint email_sync_cursors_provider_check check (provider in ('gmail', 'outlook'));

drop trigger if exists email_connections_updated_at on public.email_connections;
create trigger email_connections_updated_at
before update on public.email_connections
for each row execute function public.roamly_set_updated_at();

drop trigger if exists email_watch_subscriptions_updated_at on public.email_watch_subscriptions;
create trigger email_watch_subscriptions_updated_at
before update on public.email_watch_subscriptions
for each row execute function public.roamly_set_updated_at();

drop trigger if exists email_sync_cursors_updated_at on public.email_sync_cursors;
create trigger email_sync_cursors_updated_at
before update on public.email_sync_cursors
for each row execute function public.roamly_set_updated_at();

alter table public.email_connections enable row level security;
alter table public.email_watch_subscriptions enable row level security;
alter table public.email_sync_cursors enable row level security;

drop policy if exists "Roamly users read own email connections" on public.email_connections;
create policy "Roamly users read own email connections"
on public.email_connections
for select
using (user_id = auth.uid());

drop policy if exists "Roamly users manage own email connections" on public.email_connections;
create policy "Roamly users manage own email connections"
on public.email_connections
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users read own email watches" on public.email_watch_subscriptions;
create policy "Roamly users read own email watches"
on public.email_watch_subscriptions
for select
using (
  exists (
    select 1
    from public.email_connections
    where email_connections.id = email_watch_subscriptions.email_connection_id
      and email_connections.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users read own email cursors" on public.email_sync_cursors;
create policy "Roamly users read own email cursors"
on public.email_sync_cursors
for select
using (
  exists (
    select 1
    from public.email_connections
    where email_connections.id = email_sync_cursors.email_connection_id
      and email_connections.user_id = auth.uid()
  )
);
