create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  account_id text,
  account_name text,
  access_token text,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  scopes text[],
  metadata jsonb not null default '{}'::jsonb,
  is_connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_connections enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'social_connections'
      and policyname = 'social_connections_service_role_all'
  ) then
    create policy social_connections_service_role_all
    on public.social_connections
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
  end if;
end $$;

create index if not exists social_connections_provider_idx
on public.social_connections(provider);
