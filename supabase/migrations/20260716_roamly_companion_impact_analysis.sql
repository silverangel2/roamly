-- Companion itinerary impact analysis.

create table if not exists public.companion_impact_results (
  id uuid primary key default gen_random_uuid(),
  companion_event_id uuid not null references public.companion_events(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  severity text not null,
  affected_items_json jsonb not null default '[]'::jsonb,
  timing_impact_json jsonb not null default '{}'::jsonb,
  cost_impact_json jsonb not null default '{}'::jsonb,
  traveler_action_required boolean not null default false,
  safe_automatic_actions jsonb not null default '[]'::jsonb,
  approval_required_actions jsonb not null default '[]'::jsonb,
  fallback_options jsonb not null default '[]'::jsonb,
  analysis_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.companion_impact_results
  drop constraint if exists companion_impact_results_severity_check,
  add constraint companion_impact_results_severity_check check (severity in ('minor', 'routine', 'important', 'critical'));

create unique index if not exists companion_impact_results_event_uidx
  on public.companion_impact_results (companion_event_id);

create index if not exists companion_impact_results_trip_idx
  on public.companion_impact_results (trip_id, created_at desc);

alter table public.companion_impact_results enable row level security;

drop policy if exists "Roamly users read own companion impact results" on public.companion_impact_results;
create policy "Roamly users read own companion impact results"
on public.companion_impact_results
for select
using (user_id = auth.uid());
