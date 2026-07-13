-- Roamly support inbox and social admin readiness.
-- Idempotent and Roamly-prefixed only.

create table if not exists public.roamly_support_messages (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  subject text,
  message text,
  category text,
  trip_id uuid null,
  status text not null default 'new',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.roamly_social_media_assets (
  id uuid primary key default gen_random_uuid(),
  platform text,
  status text not null default 'draft',
  title text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  media_url text,
  destination text,
  topic text,
  scheduled_for timestamptz,
  posted_at timestamptz,
  external_post_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_social_posts (
  id uuid primary key default gen_random_uuid(),
  platform text,
  status text not null default 'draft',
  title text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  media_url text,
  destination text,
  topic text,
  scheduled_for timestamptz,
  posted_at timestamptz,
  external_post_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_social_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  value jsonb not null default '{}'::jsonb,
  platform text,
  status text not null default 'active',
  title text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  media_url text,
  destination text,
  topic text,
  scheduled_for timestamptz,
  posted_at timestamptz,
  external_post_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_social_post_history (
  id uuid primary key default gen_random_uuid(),
  social_post_id uuid references public.roamly_social_posts(id) on delete set null,
  action text,
  platform text,
  status text not null default 'created',
  title text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  media_url text,
  destination text,
  topic text,
  scheduled_for timestamptz,
  posted_at timestamptz,
  external_post_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roamly_support_messages_status_idx on public.roamly_support_messages (status, created_at desc);
create index if not exists roamly_support_messages_email_idx on public.roamly_support_messages (lower(email));
create index if not exists roamly_support_messages_trip_idx on public.roamly_support_messages (trip_id);

create index if not exists roamly_social_media_assets_status_idx on public.roamly_social_media_assets (status, created_at desc);
create index if not exists roamly_social_posts_status_idx on public.roamly_social_posts (status, scheduled_for, created_at desc);
create index if not exists roamly_social_posts_platform_idx on public.roamly_social_posts (platform, status);
create index if not exists roamly_social_settings_key_idx on public.roamly_social_settings (key);
create index if not exists roamly_social_post_history_post_idx on public.roamly_social_post_history (social_post_id, created_at desc);
create index if not exists roamly_social_post_history_status_idx on public.roamly_social_post_history (status, created_at desc);

drop trigger if exists roamly_social_media_assets_updated_at on public.roamly_social_media_assets;
create trigger roamly_social_media_assets_updated_at
before update on public.roamly_social_media_assets
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_social_posts_updated_at on public.roamly_social_posts;
create trigger roamly_social_posts_updated_at
before update on public.roamly_social_posts
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_social_settings_updated_at on public.roamly_social_settings;
create trigger roamly_social_settings_updated_at
before update on public.roamly_social_settings
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_social_post_history_updated_at on public.roamly_social_post_history;
create trigger roamly_social_post_history_updated_at
before update on public.roamly_social_post_history
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_support_messages enable row level security;
alter table public.roamly_social_media_assets enable row level security;
alter table public.roamly_social_posts enable row level security;
alter table public.roamly_social_settings enable row level security;
alter table public.roamly_social_post_history enable row level security;

drop policy if exists "Roamly service role manages support messages" on public.roamly_support_messages;
create policy "Roamly service role manages support messages"
on public.roamly_support_messages
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly service role manages social media assets" on public.roamly_social_media_assets;
create policy "Roamly service role manages social media assets"
on public.roamly_social_media_assets
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly service role manages social posts" on public.roamly_social_posts;
create policy "Roamly service role manages social posts"
on public.roamly_social_posts
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly service role manages social settings" on public.roamly_social_settings;
create policy "Roamly service role manages social settings"
on public.roamly_social_settings
for all
to service_role
using (true)
with check (true);

drop policy if exists "Roamly service role manages social post history" on public.roamly_social_post_history;
create policy "Roamly service role manages social post history"
on public.roamly_social_post_history
for all
to service_role
using (true)
with check (true);
