-- Roamly Companion itinerary repair proposals and actions.

create table if not exists public.companion_repair_proposals (
  id uuid primary key default gen_random_uuid(),
  companion_event_id uuid not null references public.companion_events(id) on delete cascade,
  impact_result_id uuid not null references public.companion_impact_results(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_version integer not null default 1,
  summary text not null,
  affected_layers text[] not null default '{}'::text[],
  proposed_changes_json jsonb not null default '[]'::jsonb,
  cost_change numeric,
  currency text,
  requires_approval boolean not null default false,
  status text not null default 'proposed',
  reviewed_at timestamptz,
  applied_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companion_actions (
  id uuid primary key default gen_random_uuid(),
  repair_proposal_id uuid not null references public.companion_repair_proposals(id) on delete cascade,
  trip_id uuid not null references public.roamly_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,
  action_status text not null default 'pending',
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  idempotency_key text not null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.companion_repair_proposals
  drop constraint if exists companion_repair_proposals_status_check,
  add constraint companion_repair_proposals_status_check
    check (status in (
      'proposed',
      'awaiting_approval',
      'approved',
      'applying',
      'applied',
      'partially_applied',
      'rejected',
      'failed'
    ));

alter table public.companion_actions
  drop constraint if exists companion_actions_status_check,
  add constraint companion_actions_status_check
    check (action_status in (
      'pending',
      'awaiting_approval',
      'approved',
      'applying',
      'completed',
      'skipped',
      'rejected',
      'failed'
    ));

create unique index if not exists companion_repair_proposals_event_uidx
  on public.companion_repair_proposals (companion_event_id);

create unique index if not exists companion_actions_idempotency_uidx
  on public.companion_actions (idempotency_key);

create index if not exists companion_repair_proposals_trip_status_idx
  on public.companion_repair_proposals (trip_id, status, created_at desc);

create index if not exists companion_actions_proposal_idx
  on public.companion_actions (repair_proposal_id, created_at);

drop trigger if exists companion_repair_proposals_updated_at
  on public.companion_repair_proposals;

create trigger companion_repair_proposals_updated_at
before update on public.companion_repair_proposals
for each row execute function public.roamly_set_updated_at();

alter table public.companion_repair_proposals enable row level security;
alter table public.companion_actions enable row level security;

drop policy if exists "Roamly users read own companion repair proposals"
  on public.companion_repair_proposals;

create policy "Roamly users read own companion repair proposals"
on public.companion_repair_proposals
for select
using (user_id = auth.uid());

drop policy if exists "Roamly users read own companion actions"
  on public.companion_actions;

create policy "Roamly users read own companion actions"
on public.companion_actions
for select
using (user_id = auth.uid());
