-- Roamly Phase 8C-2 durable executive report artifacts.
-- Internal aggregation history only; not a source of customer, travel, booking,
-- provider, revenue, cost, or token truth. Review and apply manually.

create table if not exists public.roamly_ops_executive_reports (
  id uuid primary key default gen_random_uuid(),
  report_identity text not null,
  report_type text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  generation_status text not null default 'GENERATED',
  payload_json jsonb not null default '{}'::jsonb,
  evidence_references jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null,
  schema_version text not null default 'phase8c2.v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_identity),
  unique (report_type, period_start),
  check (report_type in ('weekly','monthly','quarterly','year_end')),
  check (generation_status in ('GENERATING','GENERATED','FAILED')),
  check (period_end > period_start),
  check (jsonb_typeof(payload_json) = 'object'),
  check (jsonb_typeof(evidence_references) = 'array')
);

create index if not exists roamly_ops_executive_reports_period_idx
  on public.roamly_ops_executive_reports (report_type, period_start desc);
create index if not exists roamly_ops_executive_reports_status_idx
  on public.roamly_ops_executive_reports (generation_status, updated_at desc);

drop trigger if exists roamly_ops_executive_reports_updated_at on public.roamly_ops_executive_reports;
create trigger roamly_ops_executive_reports_updated_at
  before update on public.roamly_ops_executive_reports
  for each row execute function public.roamly_ops_set_updated_at();

alter table public.roamly_ops_executive_reports enable row level security;
revoke all on public.roamly_ops_executive_reports from public, anon, authenticated;
grant all on public.roamly_ops_executive_reports to service_role;
