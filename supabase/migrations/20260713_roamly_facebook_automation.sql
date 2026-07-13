-- Roamly automated Facebook, SEO, email, and admin activity platform.
-- Idempotent: safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.roamly_social_automation_settings (
  id text primary key default 'facebook',
  automation_enabled boolean not null default false,
  paused boolean not null default true,
  manual_review_required boolean not null default false,
  posts_per_day integer not null default 2,
  reels_per_week integer not null default 3,
  preferred_posting_hours integer[] not null default array[9, 12, 18],
  time_zone text not null default 'America/Moncton',
  minimum_queue_size integer not null default 30,
  maximum_queue_size integer not null default 100,
  maximum_daily_posts integer not null default 3,
  affiliate_post_frequency integer not null default 12,
  promotional_post_frequency integer not null default 15,
  website_link_frequency integer not null default 80,
  statement_post_frequency integer not null default 20,
  automatic_retry_limit integer not null default 3,
  content_categories jsonb not null default '[]'::jsonb,
  category_percentages jsonb not null default '{}'::jsonb,
  media_settings jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_social_automation_settings_counts check (
    posts_per_day between 0 and 12
    and reels_per_week between 0 and 21
    and minimum_queue_size between 0 and 500
    and maximum_queue_size between 1 and 1000
    and maximum_daily_posts between 0 and 24
    and automatic_retry_limit between 0 and 10
  )
);

insert into public.roamly_social_automation_settings (id)
values ('facebook')
on conflict (id) do nothing;

create table if not exists public.roamly_content_generation_batches (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'facebook',
  requested_count integer not null default 0,
  created_count integer not null default 0,
  rejected_count integer not null default 0,
  generation_source text not null default 'fallback',
  status text not null default 'running',
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_content_generation_batches_status check (status in ('running', 'completed', 'failed', 'partial'))
);

create table if not exists public.roamly_social_drafts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.roamly_content_generation_batches(id) on delete set null,
  platform text not null default 'facebook',
  content_type text not null,
  post_format text not null,
  topic text,
  topic_key text,
  concept_key text not null,
  hook text not null,
  hook_hash text not null,
  caption text not null,
  caption_hash text not null,
  on_screen_text text,
  media_direction text,
  suggested_media text,
  selected_media_asset_id uuid null,
  selected_media_url text,
  media_hash text,
  call_to_action text,
  hashtags jsonb not null default '[]'::jsonb,
  hashtag_hash text not null,
  music_or_audio_mood text,
  roamly_link text,
  link_hash text,
  amazon_affiliate_link text,
  affiliate_disclosure text,
  generation_source text not null default 'fallback',
  status text not null default 'draft',
  quality_score integer not null default 0,
  quality_reasons jsonb not null default '[]'::jsonb,
  rejected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_social_drafts_format check (post_format in ('reel', 'image', 'statement', 'link')),
  constraint roamly_social_drafts_status check (status in ('draft', 'queued', 'scheduled', 'published', 'failed', 'rejected', 'archived', 'skipped')),
  constraint roamly_social_drafts_quality check (quality_score between 0 and 100)
);

create table if not exists public.roamly_social_queue (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.roamly_social_drafts(id) on delete cascade,
  platform text not null default 'facebook',
  queue_status text not null default 'scheduled',
  scheduled_for timestamptz not null,
  scheduled_date date,
  idempotency_key text not null,
  publish_key text not null,
  facebook_post_id text,
  facebook_reel_id text,
  facebook_media_id text,
  facebook_url text,
  published_at timestamptz,
  processing_locked_at timestamptz,
  processing_lock_token text,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  attempt_count integer not null default 0,
  retry_after timestamptz,
  last_error text,
  permanent_failure boolean not null default false,
  meta_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_social_queue_status check (queue_status in ('scheduled', 'processing', 'published', 'failed', 'retrying', 'skipped', 'archived')),
  constraint roamly_social_queue_attempts check (attempt_count >= 0)
);

create table if not exists public.roamly_scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.roamly_social_queue(id) on delete cascade,
  draft_id uuid not null references public.roamly_social_drafts(id) on delete cascade,
  platform text not null default 'facebook',
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_scheduled_posts_status check (status in ('scheduled', 'processing', 'published', 'failed', 'retrying', 'skipped', 'archived'))
);

create table if not exists public.roamly_publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.roamly_social_queue(id) on delete cascade,
  draft_id uuid not null references public.roamly_social_drafts(id) on delete cascade,
  platform text not null default 'facebook',
  job_status text not null default 'scheduled',
  idempotency_key text not null,
  scheduled_for timestamptz not null,
  locked_at timestamptz,
  lock_token text,
  started_at timestamptz,
  finished_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_publishing_jobs_status check (job_status in ('scheduled', 'processing', 'published', 'failed', 'retrying', 'skipped', 'archived')),
  constraint roamly_publishing_jobs_attempts check (attempt_count >= 0)
);

create table if not exists public.roamly_publishing_attempts (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.roamly_social_queue(id) on delete set null,
  job_id uuid references public.roamly_publishing_jobs(id) on delete set null,
  draft_id uuid references public.roamly_social_drafts(id) on delete set null,
  platform text not null default 'facebook',
  attempt_number integer not null default 1,
  status text not null,
  temporary_failure boolean not null default false,
  facebook_post_id text,
  facebook_reel_id text,
  facebook_media_id text,
  facebook_url text,
  error_message text,
  meta_response jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint roamly_publishing_attempts_status check (status in ('started', 'published', 'failed', 'retrying', 'skipped'))
);

create table if not exists public.roamly_facebook_media_processing (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.roamly_social_queue(id) on delete cascade,
  draft_id uuid references public.roamly_social_drafts(id) on delete cascade,
  facebook_video_id text,
  facebook_upload_url text,
  processing_status text not null default 'pending',
  checked_at timestamptz,
  published_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_facebook_media_processing_status check (processing_status in ('pending', 'uploading', 'processing', 'ready', 'published', 'failed'))
);

create table if not exists public.roamly_media_library_usage (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid,
  draft_id uuid references public.roamly_social_drafts(id) on delete set null,
  queue_id uuid references public.roamly_social_queue(id) on delete set null,
  platform text not null default 'facebook',
  use_count integer not null default 0,
  last_used_at timestamptz,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_media_library_usage_status check (status in ('active', 'approved', 'rejected', 'archived', 'excluded'))
);

create table if not exists public.roamly_failed_jobs (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.roamly_social_queue(id) on delete set null,
  job_id uuid references public.roamly_publishing_jobs(id) on delete set null,
  draft_id uuid references public.roamly_social_drafts(id) on delete set null,
  platform text not null default 'facebook',
  failure_type text not null default 'temporary',
  error_message text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_failed_jobs_failure_type check (failure_type in ('temporary', 'permanent', 'validation', 'duplicate', 'configuration'))
);

create table if not exists public.roamly_cron_execution_logs (
  id uuid primary key default gen_random_uuid(),
  cron_name text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  due_found integer not null default 0,
  published_count integer not null default 0,
  failed_count integer not null default 0,
  retry_count integer not null default 0,
  generated_count integer not null default 0,
  skipped_reason text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_cron_execution_logs_status check (status in ('running', 'completed', 'failed', 'skipped', 'partial'))
);

create table if not exists public.roamly_content_quality_checks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.roamly_social_drafts(id) on delete cascade,
  batch_id uuid references public.roamly_content_generation_batches(id) on delete set null,
  score integer not null default 0,
  status text not null default 'passed',
  reasons jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_content_quality_checks_status check (status in ('passed', 'rejected', 'warning')),
  constraint roamly_content_quality_checks_score check (score between 0 and 100)
);

create table if not exists public.roamly_seo_drafts (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  topic text not null,
  seo_title text not null,
  meta_description text not null,
  slug text not null,
  h1 text not null,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  quality_score integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_seo_drafts_status check (status in ('draft', 'published', 'failed', 'archived')),
  constraint roamly_seo_drafts_quality check (quality_score between 0 and 100)
);

create table if not exists public.roamly_published_seo_pages (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.roamly_seo_drafts(id) on delete set null,
  slug text not null,
  seo_title text not null,
  meta_description text not null,
  h1 text not null,
  content jsonb not null default '{}'::jsonb,
  canonical_url text,
  og_metadata jsonb not null default '{}'::jsonb,
  json_ld jsonb not null default '{}'::jsonb,
  status text not null default 'published',
  published_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_published_seo_pages_status check (status in ('published', 'archived', 'failed'))
);

create table if not exists public.roamly_email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  name text not null,
  subject text not null,
  preheader text,
  html text,
  text_body text,
  category text not null default 'transactional',
  marketing boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roamly_email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  email_log_id uuid,
  template_key text,
  to_email text not null,
  subject text not null,
  status text not null default 'pending',
  provider text,
  provider_message_id text,
  idempotency_key text,
  error_message text,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_email_delivery_logs_status check (status in ('pending', 'sent', 'failed', 'skipped', 'retrying'))
);

create table if not exists public.roamly_admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  status text not null default 'completed',
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint roamly_admin_activity_logs_status check (status in ('started', 'completed', 'failed', 'skipped'))
);

alter table public.roamly_social_media_assets
  add column if not exists asset_type text,
  add column if not exists approved_for_automation boolean not null default false,
  add column if not exists excluded_from_automation boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists use_count integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists duration_seconds numeric,
  add column if not exists is_vertical boolean not null default false,
  add column if not exists source text,
  add column if not exists rights_note text;

create unique index if not exists roamly_social_drafts_hook_hash_key on public.roamly_social_drafts (hook_hash);
create unique index if not exists roamly_social_drafts_caption_hash_key on public.roamly_social_drafts (caption_hash);
create unique index if not exists roamly_social_drafts_concept_key on public.roamly_social_drafts (concept_key);
create unique index if not exists roamly_social_drafts_hashtag_hash_key on public.roamly_social_drafts (hashtag_hash);
create index if not exists roamly_social_drafts_status_idx on public.roamly_social_drafts (status, created_at desc);
create index if not exists roamly_social_drafts_format_idx on public.roamly_social_drafts (post_format, status);
create index if not exists roamly_social_drafts_batch_idx on public.roamly_social_drafts (batch_id, created_at desc);

create unique index if not exists roamly_social_queue_idempotency_key on public.roamly_social_queue (idempotency_key);
create unique index if not exists roamly_social_queue_publish_key on public.roamly_social_queue (publish_key);
create unique index if not exists roamly_social_queue_draft_unique_active on public.roamly_social_queue (draft_id) where queue_status in ('scheduled', 'processing', 'retrying', 'published');
create unique index if not exists roamly_social_queue_schedule_unique on public.roamly_social_queue (scheduled_for) where queue_status in ('scheduled', 'processing', 'retrying', 'published');
create index if not exists roamly_social_queue_status_schedule_idx on public.roamly_social_queue (queue_status, scheduled_for);
create index if not exists roamly_social_queue_retry_idx on public.roamly_social_queue (retry_after) where queue_status = 'retrying';
create index if not exists roamly_social_queue_facebook_ids_idx on public.roamly_social_queue (facebook_post_id, facebook_reel_id);

create unique index if not exists roamly_scheduled_posts_queue_unique on public.roamly_scheduled_posts (queue_id);
create index if not exists roamly_scheduled_posts_status_idx on public.roamly_scheduled_posts (status, scheduled_for);

create unique index if not exists roamly_publishing_jobs_queue_unique on public.roamly_publishing_jobs (queue_id);
create unique index if not exists roamly_publishing_jobs_idempotency_key on public.roamly_publishing_jobs (idempotency_key);
create index if not exists roamly_publishing_jobs_status_idx on public.roamly_publishing_jobs (job_status, scheduled_for);

create index if not exists roamly_publishing_attempts_queue_idx on public.roamly_publishing_attempts (queue_id, created_at desc);
create index if not exists roamly_facebook_media_processing_queue_idx on public.roamly_facebook_media_processing (queue_id, created_at desc);
create index if not exists roamly_media_library_usage_asset_idx on public.roamly_media_library_usage (media_asset_id, last_used_at desc);
create index if not exists roamly_failed_jobs_status_idx on public.roamly_failed_jobs (failure_type, created_at desc) where resolved_at is null;
create index if not exists roamly_cron_execution_logs_name_idx on public.roamly_cron_execution_logs (cron_name, started_at desc);
create index if not exists roamly_content_quality_checks_draft_idx on public.roamly_content_quality_checks (draft_id, created_at desc);

create unique index if not exists roamly_seo_drafts_slug_key on public.roamly_seo_drafts (slug);
create unique index if not exists roamly_published_seo_pages_slug_key on public.roamly_published_seo_pages (slug);
create index if not exists roamly_published_seo_pages_status_idx on public.roamly_published_seo_pages (status, published_at desc);

create unique index if not exists roamly_email_templates_key_unique on public.roamly_email_templates (template_key);
create unique index if not exists roamly_email_delivery_logs_idempotency_key on public.roamly_email_delivery_logs (idempotency_key) where idempotency_key is not null;
create index if not exists roamly_email_delivery_logs_status_idx on public.roamly_email_delivery_logs (status, created_at desc);
create index if not exists roamly_admin_activity_logs_actor_idx on public.roamly_admin_activity_logs (actor_email, created_at desc);
create index if not exists roamly_admin_activity_logs_action_idx on public.roamly_admin_activity_logs (action, created_at desc);

drop trigger if exists roamly_social_automation_settings_updated_at on public.roamly_social_automation_settings;
create trigger roamly_social_automation_settings_updated_at
before update on public.roamly_social_automation_settings
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_content_generation_batches_updated_at on public.roamly_content_generation_batches;
create trigger roamly_content_generation_batches_updated_at
before update on public.roamly_content_generation_batches
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_social_drafts_updated_at on public.roamly_social_drafts;
create trigger roamly_social_drafts_updated_at
before update on public.roamly_social_drafts
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_social_queue_updated_at on public.roamly_social_queue;
create trigger roamly_social_queue_updated_at
before update on public.roamly_social_queue
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_scheduled_posts_updated_at on public.roamly_scheduled_posts;
create trigger roamly_scheduled_posts_updated_at
before update on public.roamly_scheduled_posts
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_publishing_jobs_updated_at on public.roamly_publishing_jobs;
create trigger roamly_publishing_jobs_updated_at
before update on public.roamly_publishing_jobs
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_facebook_media_processing_updated_at on public.roamly_facebook_media_processing;
create trigger roamly_facebook_media_processing_updated_at
before update on public.roamly_facebook_media_processing
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_media_library_usage_updated_at on public.roamly_media_library_usage;
create trigger roamly_media_library_usage_updated_at
before update on public.roamly_media_library_usage
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_failed_jobs_updated_at on public.roamly_failed_jobs;
create trigger roamly_failed_jobs_updated_at
before update on public.roamly_failed_jobs
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_seo_drafts_updated_at on public.roamly_seo_drafts;
create trigger roamly_seo_drafts_updated_at
before update on public.roamly_seo_drafts
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_published_seo_pages_updated_at on public.roamly_published_seo_pages;
create trigger roamly_published_seo_pages_updated_at
before update on public.roamly_published_seo_pages
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_email_templates_updated_at on public.roamly_email_templates;
create trigger roamly_email_templates_updated_at
before update on public.roamly_email_templates
for each row execute function public.roamly_set_updated_at();

drop trigger if exists roamly_email_delivery_logs_updated_at on public.roamly_email_delivery_logs;
create trigger roamly_email_delivery_logs_updated_at
before update on public.roamly_email_delivery_logs
for each row execute function public.roamly_set_updated_at();

alter table public.roamly_social_automation_settings enable row level security;
alter table public.roamly_content_generation_batches enable row level security;
alter table public.roamly_social_drafts enable row level security;
alter table public.roamly_social_queue enable row level security;
alter table public.roamly_scheduled_posts enable row level security;
alter table public.roamly_publishing_jobs enable row level security;
alter table public.roamly_publishing_attempts enable row level security;
alter table public.roamly_facebook_media_processing enable row level security;
alter table public.roamly_media_library_usage enable row level security;
alter table public.roamly_failed_jobs enable row level security;
alter table public.roamly_cron_execution_logs enable row level security;
alter table public.roamly_content_quality_checks enable row level security;
alter table public.roamly_seo_drafts enable row level security;
alter table public.roamly_published_seo_pages enable row level security;
alter table public.roamly_email_templates enable row level security;
alter table public.roamly_email_delivery_logs enable row level security;
alter table public.roamly_admin_activity_logs enable row level security;

drop policy if exists "Roamly service role manages social automation settings" on public.roamly_social_automation_settings;
create policy "Roamly service role manages social automation settings" on public.roamly_social_automation_settings
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages content batches" on public.roamly_content_generation_batches;
create policy "Roamly service role manages content batches" on public.roamly_content_generation_batches
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages social drafts" on public.roamly_social_drafts;
create policy "Roamly service role manages social drafts" on public.roamly_social_drafts
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages social queue" on public.roamly_social_queue;
create policy "Roamly service role manages social queue" on public.roamly_social_queue
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages scheduled posts" on public.roamly_scheduled_posts;
create policy "Roamly service role manages scheduled posts" on public.roamly_scheduled_posts
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages publishing jobs" on public.roamly_publishing_jobs;
create policy "Roamly service role manages publishing jobs" on public.roamly_publishing_jobs
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages publishing attempts" on public.roamly_publishing_attempts;
create policy "Roamly service role manages publishing attempts" on public.roamly_publishing_attempts
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages facebook media processing" on public.roamly_facebook_media_processing;
create policy "Roamly service role manages facebook media processing" on public.roamly_facebook_media_processing
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages media library usage" on public.roamly_media_library_usage;
create policy "Roamly service role manages media library usage" on public.roamly_media_library_usage
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages failed jobs" on public.roamly_failed_jobs;
create policy "Roamly service role manages failed jobs" on public.roamly_failed_jobs
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages cron execution logs" on public.roamly_cron_execution_logs;
create policy "Roamly service role manages cron execution logs" on public.roamly_cron_execution_logs
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages content quality checks" on public.roamly_content_quality_checks;
create policy "Roamly service role manages content quality checks" on public.roamly_content_quality_checks
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages seo drafts" on public.roamly_seo_drafts;
create policy "Roamly service role manages seo drafts" on public.roamly_seo_drafts
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages published seo pages" on public.roamly_published_seo_pages;
create policy "Roamly service role manages published seo pages" on public.roamly_published_seo_pages
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages email templates" on public.roamly_email_templates;
create policy "Roamly service role manages email templates" on public.roamly_email_templates
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages email delivery logs" on public.roamly_email_delivery_logs;
create policy "Roamly service role manages email delivery logs" on public.roamly_email_delivery_logs
for all to service_role using (true) with check (true);

drop policy if exists "Roamly service role manages admin activity logs" on public.roamly_admin_activity_logs;
create policy "Roamly service role manages admin activity logs" on public.roamly_admin_activity_logs
for all to service_role using (true) with check (true);
