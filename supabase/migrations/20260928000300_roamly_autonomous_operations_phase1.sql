-- Roamly Phase 1 Autonomous Operations control-plane ledger.
-- Internal-only infrastructure. Review and apply manually; do not run from this workspace.
-- These tables are not a source of customer, booking, itinerary, or travel truth.

create extension if not exists pgcrypto;

create table if not exists public.roamly_ops_jobs (
  id uuid primary key default gen_random_uuid(), role text not null, initiating_signal text not null,
  priority text not null default 'normal', risk text not null default 'low', authority_level text not null default 'LEVEL_1_OBSERVE',
  status text not null default 'DETECTED', objective text not null, subsystem text not null,
  scope_json jsonb not null default '{}'::jsonb, allowed_operations jsonb not null default '[]'::jsonb,
  allowed_files jsonb not null default '[]'::jsonb, forbidden_operations jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb, acceptance_criteria jsonb not null default '[]'::jsonb,
  evidence_requirements jsonb not null default '["deterministic_check"]'::jsonb,
  token_budget bigint not null default 0, financial_budget_usd numeric(12,4) not null default 0,
  max_attempts integer not null default 1, retry_count integer not null default 0, dedupe_key text not null,
  cooldown_until timestamptz, escalation_reason text, owner_approval_required boolean not null default false,
  runner_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  started_at timestamptz, completed_at timestamptz,
  check (priority in ('critical','high','normal','low')), check (risk in ('low','medium','high','critical')),
  check (authority_level in ('LEVEL_1_OBSERVE','LEVEL_2_DIAGNOSE','LEVEL_3_SAFE_REPAIR','LEVEL_4_OWNER_APPROVAL')),
  check (status in ('DETECTED','TRIAGED','PLANNED','QUEUED','RUNNING','VALIDATING','AWAITING_APPROVAL','APPROVED','REJECTED','DEPLOYING','VERIFYING','COMPLETED','FAILED','BLOCKED','CANCELLED')),
  check (token_budget >= 0), check (financial_budget_usd >= 0), check (max_attempts between 1 and 20), check (retry_count >= 0 and retry_count <= max_attempts)
);
create unique index if not exists roamly_ops_jobs_dedupe_idx on public.roamly_ops_jobs (dedupe_key)
  where status not in ('COMPLETED','FAILED','BLOCKED','CANCELLED');
create index if not exists roamly_ops_jobs_dedupe_history_idx on public.roamly_ops_jobs (dedupe_key, created_at desc);
create index if not exists roamly_ops_jobs_queue_idx on public.roamly_ops_jobs (status, priority, created_at);
create index if not exists roamly_ops_jobs_subsystem_idx on public.roamly_ops_jobs (subsystem, status, created_at desc);

create table if not exists public.roamly_ops_attempts (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.roamly_ops_jobs(id) on delete cascade,
  attempt_number integer not null, worker_role text not null, runner_id text, model_provider text, model_name text,
  status text not null default 'started', token_count bigint not null default 0, financial_cost_usd numeric(12,4) not null default 0,
  error_class text, sanitized_summary text, started_at timestamptz not null default now(), completed_at timestamptz,
  unique (job_id, attempt_number), check (status in ('started','passed','failed','blocked','cancelled')),
  check (token_count >= 0), check (financial_cost_usd >= 0)
);

create table if not exists public.roamly_ops_evidence (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.roamly_ops_jobs(id) on delete cascade,
  attempt_id uuid references public.roamly_ops_attempts(id) on delete set null, category text not null, source text not null,
  result text not null, summary text not null, safe_metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check (category in ('deterministic_check','test','typecheck','build','changed_file_manifest','commit_sha','deployment_id','deployment_sha','deployment_ready','safe_production_health','external_config_blocker','owner_approval')),
  check (result in ('pass','fail','blocked','not_run'))
);
create index if not exists roamly_ops_evidence_job_idx on public.roamly_ops_evidence (job_id, created_at desc);

create table if not exists public.roamly_ops_locks (
  subsystem text primary key, job_id uuid not null references public.roamly_ops_jobs(id) on delete cascade,
  scope_hash text not null, acquired_at timestamptz not null default now(), lease_expires_at timestamptz not null, reason text not null
);
create index if not exists roamly_ops_locks_expiry_idx on public.roamly_ops_locks (lease_expires_at);

create table if not exists public.roamly_ops_owner_decisions (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.roamly_ops_jobs(id) on delete cascade,
  requested_category text not null, risk text not null, decision text not null, evidence_ids jsonb not null default '[]'::jsonb,
  owner_note text, decided_at timestamptz not null default now(), check (risk in ('low','medium','high','critical')),
  check (decision in ('approved','rejected','deferred')),
  check (requested_category in ('database_migration','destructive_database_operation','billing_payment','spending','new_paid_service','provider_commercial_agreement','credentials_secrets','security_sensitive','major_architecture','customer_financial_truth','privacy_data_retention','weaken_validation'))
);
create index if not exists roamly_ops_owner_decisions_job_idx on public.roamly_ops_owner_decisions (job_id, decided_at desc);

create or replace function public.roamly_ops_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists roamly_ops_jobs_updated_at on public.roamly_ops_jobs;
create trigger roamly_ops_jobs_updated_at before update on public.roamly_ops_jobs for each row execute function public.roamly_ops_set_updated_at();

alter table public.roamly_ops_jobs enable row level security;
alter table public.roamly_ops_attempts enable row level security;
alter table public.roamly_ops_evidence enable row level security;
alter table public.roamly_ops_locks enable row level security;
alter table public.roamly_ops_owner_decisions enable row level security;
revoke all on public.roamly_ops_jobs, public.roamly_ops_attempts, public.roamly_ops_evidence, public.roamly_ops_locks, public.roamly_ops_owner_decisions from public, anon, authenticated;
grant all on public.roamly_ops_jobs, public.roamly_ops_attempts, public.roamly_ops_evidence, public.roamly_ops_locks, public.roamly_ops_owner_decisions to service_role;
