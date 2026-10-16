-- Roamly plan comments: traveler notes left on their own trip/itinerary.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule).
--
-- Design notes (Junel, 2026-10-16 — "yeah add it, it's a gap"):
-- * plan_comments: traveler notes on their own plan. v1 is plan-level
--   (scope = 'itinerary'); 'day' / 'item' scopes are reserved for a later
--   round (ref carries the optional day number / item id).
-- * Owner-only by construction: every policy keys on user_id = auth.uid(),
--   and inserts additionally require the trip to belong to the caller.
--   Comments never leave the traveler's own account — they are NOT a
--   pattern source and are never aggregated in identifiable form.
-- * The Concierge's Comment Reader reads these through the app's own
--   server path (RLS-enforced owner read); the service_role policy exists
--   for admin/support diagnostics, consistent with the other Roamly tables.
-- * Fail-soft by design: until this migration is applied, the trip page
--   hides the comment box and the API returns a clean unavailable
--   response instead of breaking the itinerary page.

create extension if not exists pgcrypto;

create table if not exists public.plan_comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  scope text not null default 'itinerary'
    check (scope in ('itinerary', 'day', 'item')),
  ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_comments_body_check check (char_length(body) between 1 and 2000)
);

create index if not exists plan_comments_trip_idx
  on public.plan_comments (trip_id, created_at asc);
create index if not exists plan_comments_user_idx
  on public.plan_comments (user_id, created_at desc);

drop trigger if exists plan_comments_updated_at on public.plan_comments;
create trigger plan_comments_updated_at
before update on public.plan_comments
for each row execute function public.roamly_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner-only, always
-- ---------------------------------------------------------------------------
alter table public.plan_comments enable row level security;

drop policy if exists "Roamly users read own plan comments" on public.plan_comments;
create policy "Roamly users read own plan comments"
on public.plan_comments for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly users create own plan comments" on public.plan_comments;
create policy "Roamly users create own plan comments"
on public.plan_comments for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.roamly_trips t
    where t.id = plan_comments.trip_id and t.user_id = auth.uid()
  )
);

drop policy if exists "Roamly users update own plan comments" on public.plan_comments;
create policy "Roamly users update own plan comments"
on public.plan_comments for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Roamly users delete own plan comments" on public.plan_comments;
create policy "Roamly users delete own plan comments"
on public.plan_comments for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "Roamly service role manages plan comments" on public.plan_comments;
create policy "Roamly service role manages plan comments"
on public.plan_comments for all to service_role
using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Service-role grants (mirrors the itinerary-library grant style)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table public.plan_comments to service_role;
