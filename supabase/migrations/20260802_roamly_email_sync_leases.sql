-- Prevent overlapping mailbox syncs from racing the provider cursor.

alter table public.email_connections
  add column if not exists sync_lease_token text,
  add column if not exists sync_lease_expires_at timestamptz;

create index if not exists email_connections_sync_lease_idx
  on public.email_connections (provider, sync_lease_expires_at);
