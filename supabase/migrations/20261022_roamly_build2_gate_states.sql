-- Roamly production wiring, Phase 6 (M1): per-(user, device) entry-gate
-- state for Build 2 (DESIGN-PRODUCTION.md §2.4 + §6 M1, contradiction
-- C3: a dedicated table — roamly_companion_preferences is a settings
-- bag, not per-device evidence).
--
-- FILES ONLY migration: handed to the owner for manual apply in
-- Supabase. Never applied by agents (house rule). NOT executed by the
-- Phase 6 build.
--
-- One row per (user, device): the SERVER's gate record. The client
-- gate machine (lib/roamly/gateMachine.ts) owns presentation; this row
-- is the attestation the generate route enforces against
-- (lib/roamly/gateService.ts). flow_allowed is server-computed —
-- a caller's assertion never writes it directly, and the CHECK below
-- mirrors the Phase 1 DTO law in the database itself: a green row
-- must carry a detected install AND granted alerts (owner ruling
-- 2026-10-21 19:14 ADT: "Alerts required too — no alerts, no
-- proceed.").
--
-- Gmail columns ride the same row (design §2.4): the connection ref
-- points at the existing email_connections row (the source of truth —
-- deliberately NO foreign key, so this table never cascades from or
-- blocks a connection delete; the ref is application-level, in the
-- M7 no-FK pattern). gmail_consent_scope records the Build 2 consent
-- label ('booking-confirmations-only-in-gmail') when an armed
-- connection is first observed — consent is recorded BEFORE the
-- first Gmail read in the Build 2 lane.
--
-- user_id carries no FK to auth.users (M7 precedent): gate rows are
-- server-managed evidence, and nothing here may cascade from an
-- account operation. All reads/writes go through API routes using
-- the service role after the caller's identity is established
-- (Supabase session, or the handoff phone-session binding).

create extension if not exists pgcrypto;

create table if not exists public.roamly_gate_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  device_id text not null,
  platform text not null default 'other'
    check (platform in ('ios', 'android', 'other')),
  install_state text not null default 'NOT_INSTALLED'
    check (install_state in (
      'NOT_INSTALLED', 'PROMPT', 'GUIDED', 'MINIMIZED',
      'INSTALLED_DETECTED', 'NOTIFY_ASK', 'NOTIFY_DENIED',
      'GUIDED_ENABLE', 'READY'
    )),
  install_detected_at timestamptz,
  alerts_permission text
    check (alerts_permission is null or alerts_permission in ('granted', 'denied', 'default')),
  alerts_checked_at timestamptz,
  gmail_state text not null default 'NOT_CONNECTED'
    check (gmail_state in (
      'NOT_CONNECTED', 'ASK', 'OAUTH_PENDING', 'CONNECTED',
      'RECONCILIATION_ARMED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'REVOKED'
    )),
  gmail_connection_id uuid,
  gmail_consent_scope text,
  flow_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roamly_gate_states_user_device_unique unique (user_id, device_id),
  constraint roamly_gate_states_device_check check (char_length(device_id) between 1 and 200),
  -- The READY law, enforced by the database as well as the DTO parser:
  -- green requires the detected install and the granted alerts.
  constraint roamly_gate_states_ready_law_check check (
    flow_allowed = false
    or (install_state = 'READY' and install_detected_at is not null and alerts_permission = 'granted')
  ),
  -- An armed Gmail lane requires the recorded consent scope.
  constraint roamly_gate_states_armed_consent_check check (
    gmail_state <> 'RECONCILIATION_ARMED' or gmail_consent_scope is not null
  )
);

create index if not exists roamly_gate_states_user_idx
  on public.roamly_gate_states (user_id);

drop trigger if exists roamly_gate_states_updated_at on public.roamly_gate_states;
create trigger roamly_gate_states_updated_at
before update on public.roamly_gate_states
for each row execute function public.roamly_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS + Data API grants (DATA-INFRA §8: explicit grants in-file).
-- Gate records are server-managed evidence: only the service role
-- reads or writes them. Travelers never query this table directly;
-- the gate API routes authenticate the caller (session or handoff
-- binding) and then use the service role.
-- ---------------------------------------------------------------------
alter table public.roamly_gate_states enable row level security;

drop policy if exists "Roamly service role manages gate states" on public.roamly_gate_states;
create policy "Roamly service role manages gate states"
  on public.roamly_gate_states for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on table public.roamly_gate_states to service_role;
