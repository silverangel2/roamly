-- Roamly app-specific profiles for shared Supabase Auth.
-- Safe for shared projects: this only touches public.roamly_profiles.

create extension if not exists pgcrypto;

create table if not exists public.roamly_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  auth_provider text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb,
  unique (user_id)
);

alter table public.roamly_profiles add column if not exists user_id uuid;
alter table public.roamly_profiles add column if not exists avatar_url text;
alter table public.roamly_profiles add column if not exists auth_provider text;
alter table public.roamly_profiles add column if not exists first_seen_at timestamptz default now();
alter table public.roamly_profiles add column if not exists last_seen_at timestamptz default now();
alter table public.roamly_profiles add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.roamly_profiles alter column id set default gen_random_uuid();
alter table public.roamly_profiles alter column email drop not null;
alter table public.roamly_profiles drop constraint if exists roamly_profiles_id_fkey;

update public.roamly_profiles
set user_id = id
where user_id is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roamly_profiles'
      and column_name = 'created_at'
  ) then
    execute 'update public.roamly_profiles set first_seen_at = coalesce(created_at, now()) where first_seen_at is null';
  else
    update public.roamly_profiles set first_seen_at = now() where first_seen_at is null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roamly_profiles'
      and column_name = 'updated_at'
  ) then
    execute 'update public.roamly_profiles set last_seen_at = coalesce(updated_at, first_seen_at, now()) where last_seen_at is null';
  else
    update public.roamly_profiles set last_seen_at = coalesce(first_seen_at, now()) where last_seen_at is null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from public.roamly_profiles
    where user_id is null
  ) then
    alter table public.roamly_profiles alter column user_id set not null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.roamly_profiles'::regclass
      and conname = 'roamly_profiles_user_id_fkey'
  ) then
    alter table public.roamly_profiles
      add constraint roamly_profiles_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.roamly_profiles'::regclass
      and conname = 'roamly_profiles_user_id_key'
  ) then
    alter table public.roamly_profiles
      add constraint roamly_profiles_user_id_key unique (user_id);
  end if;
end $$;

create index if not exists roamly_profiles_user_id_idx on public.roamly_profiles (user_id);
create index if not exists roamly_profiles_auth_provider_idx on public.roamly_profiles (auth_provider);

alter table public.roamly_profiles enable row level security;

drop policy if exists "Roamly profiles are private" on public.roamly_profiles;
create policy "Roamly profiles are private"
on public.roamly_profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users insert own profile" on public.roamly_profiles;
create policy "Roamly users insert own profile"
on public.roamly_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Roamly users update own profile" on public.roamly_profiles;
create policy "Roamly users update own profile"
on public.roamly_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
