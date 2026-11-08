-- Roamly Keeper fault memory (Ruflo Lift 2, 2026-11-08).
-- Internal-only infrastructure. Review and apply manually; do not run from this workspace.
-- One row per fault pattern for the Roamly Keeper: deterministic pattern_key
-- (lane x cause_class x signature_class, closed vocabularies in
-- lib/roamly/keeperFaultMemory.ts), occurrence/recurrence counters, and the
-- fix + outcome record. Written and read ONLY by the keeper (service_role),
-- beside the existing ops ledger, which stays the raw per-run audit log.
--
-- ID-TYPE NOTE (deliberate, see investigation ruflo-lift2 §5.1): the phase-1
-- migration declares roamly_ops_jobs.id as uuid, but the keeper code enqueues
-- text ids (`keeper-<runnerId>`, logKeeperRun in lib/roamly/roamlyKeeper.ts)
-- and production migration history is admittedly manual/incomplete. This
-- table therefore keeps its own uuid primary key (nothing in code supplies
-- it) and declares last_job_id as TEXT to match the ids the code actually
-- writes. No foreign key to roamly_ops_jobs is declared, for the same reason.
-- PRE-SHIP: verify the production ops ledger's real shape (do keeper rows
-- actually land in roamly_ops_jobs?) before relying on any cross-table join.

create extension if not exists pgcrypto;

create table if not exists public.roamly_keeper_fault_memory (
  id uuid primary key default gen_random_uuid(),
  pattern_key text not null unique,          -- deterministic fingerprint: <lane>:<cause_class>:<signature_class>
  lane text not null,                        -- KeeperLane vocabulary (closed, enforced in code)
  cause_class text not null,                 -- escalation + check cause classes (closed, enforced in code)
  signature jsonb not null default '{}'::jsonb,  -- SAFE primitives only: signatureClass, errorClass,
                                                 -- shaPrefix, countBucket, status.
                                                 -- NEVER: emails, names, trip ids, raw error text.
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 0,
  recurrence_count integer not null default 0,   -- times it returned after being resolved
  consecutive_failures integer not null default 0,
  status text not null default 'open'
    check (status in ('open','repairing','resolved','escalated','retired')),
  fix_kind text,                             -- 'keeper_redrive' | 'human_action' | 'deploy' | 'config_change' | null
  fix_summary text,                          -- <=500 chars, template text (what was done)
  fix_outcome text
    check (fix_outcome in ('verified_fixed','failed','partial','cleared_unattributed','unknown')),
  last_job_id text,                          -- keeper run job id (TEXT — code writes `keeper-<runnerId>`)
  last_evidence jsonb not null default '{}'::jsonb,  -- flattened SAFE evidence of the latest occurrence
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Point-lookup path: pattern_key is covered by its UNIQUE constraint; this
-- index serves the keeper's per-lane recall/maintenance reads.
create index if not exists roamly_keeper_fault_memory_lane_idx
  on public.roamly_keeper_fault_memory (lane, cause_class);

-- Retirement path: resolved rows retire 180 days after resolved_at
-- (retireResolvedKeeperFaultMemory in lib/roamly/keeperFaultMemory.ts).
create index if not exists roamly_keeper_fault_memory_retirement_idx
  on public.roamly_keeper_fault_memory (status, resolved_at);

drop trigger if exists roamly_keeper_fault_memory_updated_at on public.roamly_keeper_fault_memory;
create trigger roamly_keeper_fault_memory_updated_at before update on public.roamly_keeper_fault_memory
  for each row execute function public.roamly_ops_set_updated_at();

alter table public.roamly_keeper_fault_memory enable row level security;
revoke all on public.roamly_keeper_fault_memory from public, anon, authenticated;
grant all on public.roamly_keeper_fault_memory to service_role;
