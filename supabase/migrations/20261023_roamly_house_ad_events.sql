-- House Ads Engine (Phase 1): one row per counted ad event.
-- Written only by the server (service role) through /api/ads/event and
-- /api/ads/click/<creativeId>. NOT APPLIED by the build lane — Junel or the
-- deploy lane applies this migration before the feature ships.
create table if not exists public.house_ad_events (
 id uuid primary key default gen_random_uuid(),
 site text not null check (site in ('reviewintel','roamly')),
 creative_id text not null check (length(creative_id) between 1 and 80),
 event_type text not null check (event_type in ('impression','click')),
 page_path text check (page_path is null or length(page_path) <= 300),
 created_at timestamptz not null default now()
);
create index if not exists house_ad_events_site_creative_created on public.house_ad_events(site, creative_id, created_at desc);
alter table public.house_ad_events enable row level security;
revoke all on public.house_ad_events from public, anon, authenticated;
grant select, insert on public.house_ad_events to service_role;
-- RLS has no public policies. Only the server service role writes and reads events.
