-- Concierge suggestion log: which per-person itinerary suggestions travelers
-- actually keep. Junel's usefulness metric for the Concierge bot.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule).
--
-- Design:
-- * concierge_suggestions: one row per suggestion the Concierge emitted.
--   id is the stable suggestion id from the Concierge output
--   (concierge:<trip>:<kind>:day<N>:<itemRef>), unique so logging is
--   idempotent across re-runs.
-- * outcome is NULL until recorded: "kept" | "dropped". A NULL that stays
--   NULL is itself the keep-rate signal (a suggestion nobody reacts to).
-- * The Concierge store adapter (conciergeSuggestions.ts) degrades to
--   { ok:false, disabled:true } when this table is absent; nothing in the
--   generation path depends on it.

create table if not exists public.concierge_suggestions (
  id text primary key,
  trip_id uuid references public.roamly_trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reorder_day', 'swap_pick', 'pace_adjustment', 'pattern_pick')),
  day_number integer,
  item_ref text,
  title text not null,
  reason text not null,
  pattern_key text,
  pattern_trip_count integer,
  applied boolean not null default false,
  outcome text check (outcome in ('kept', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists concierge_suggestions_trip_idx
  on public.concierge_suggestions (trip_id);

alter table public.concierge_suggestions enable row level security;

-- Service role only: the log is internal measurement, never traveler-facing.
drop policy if exists concierge_suggestions_service_role on public.concierge_suggestions;
create policy concierge_suggestions_service_role
  on public.concierge_suggestions
  for all
  to service_role
  using (true)
  with check (true);
