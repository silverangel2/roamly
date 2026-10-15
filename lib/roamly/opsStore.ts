import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OperationsJob } from "@/lib/roamly/opsControlPlane";
import { executiveReportPersistenceRow, type ExecutiveReportArtifact } from "@/lib/roamly/executiveSecretary";

const JOB_COLUMNS = "id,role,initiating_signal,priority,risk,authority_level,status,objective,subsystem,scope_json,allowed_operations,allowed_files,forbidden_operations,dependencies,acceptance_criteria,evidence_requirements,token_budget,financial_budget_usd,max_attempts,retry_count,dedupe_key,cooldown_until,escalation_reason,owner_approval_required,runner_id,created_at,updated_at,started_at,completed_at";
const EXECUTIVE_REPORT_COLUMNS = "id,report_identity,report_type,period_start,period_end,generation_status,payload_json,evidence_references,generated_at,schema_version,created_at,updated_at";
function admin(supabase?: SupabaseClient | null) { return createSupabaseAdminClient() || supabase || null; }

export async function listOperationsJobs(supabase?: SupabaseClient | null, limit = 50) {
  const client = admin(supabase);
  if (!client) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", jobs: [] };
  const result = await client.from("roamly_ops_jobs").select(JOB_COLUMNS).order("created_at", { ascending: false }).limit(Math.min(100, Math.max(1, limit)));
  if (result.error) return { ok: false as const, error: result.error.message, jobs: [] };
  return { ok: true as const, jobs: result.data || [] };
}

export async function getOperationsJob(supabase: SupabaseClient, id: string) {
  const [job, attempts, evidence, decisions] = await Promise.all([
    supabase.from("roamly_ops_jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("roamly_ops_attempts").select("id,job_id,attempt_number,worker_role,runner_id,model_provider,model_name,status,token_count,financial_cost_usd,error_class,sanitized_summary,started_at,completed_at").eq("job_id", id).order("attempt_number", { ascending: true }),
    supabase.from("roamly_ops_evidence").select("id,job_id,attempt_id,category,source,result,summary,safe_metadata,created_at").eq("job_id", id).order("created_at", { ascending: false }),
    supabase.from("roamly_ops_owner_decisions").select("id,job_id,requested_category,risk,decision,evidence_ids,owner_note,decided_at").eq("job_id", id).order("decided_at", { ascending: false })
  ]);
  if (job.error) return { ok: false as const, error: job.error.message, detail: null };
  if (!job.data) return { ok: false as const, error: "JOB_NOT_FOUND", detail: null };
  return { ok: true as const, detail: { job: job.data, attempts: attempts.data || [], evidence: evidence.data || [], decisions: decisions.data || [] } };
}

export async function enqueueOperationsJob(job: OperationsJob, supabase?: SupabaseClient | null) {
  const client = admin(supabase);
  if (!client) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", duplicate: false };
  const result = await client.from("roamly_ops_jobs").insert({
    id: job.id,
    role: job.role,
    initiating_signal: job.initiatingSignal,
    priority: job.priority,
    risk: job.risk,
    authority_level: job.authorityLevel,
    status: job.status,
    objective: job.objective,
    subsystem: job.subsystem,
    scope_json: job.scope,
    allowed_operations: job.allowedOperations,
    allowed_files: job.allowedFiles,
    forbidden_operations: job.forbiddenOperations,
    dependencies: job.dependencies,
    acceptance_criteria: job.acceptanceCriteria,
    evidence_requirements: job.evidenceRequirements,
    token_budget: job.tokenBudget,
    financial_budget_usd: job.financialBudgetUsd,
    max_attempts: job.maxAttempts,
    retry_count: job.retryCount,
    dedupe_key: job.dedupeKey,
    cooldown_until: job.cooldownUntil,
    escalation_reason: job.escalationReason,
    owner_approval_required: job.ownerApprovalRequired,
    runner_id: job.runnerId
  });
  if (result.error) {
    if (result.error.code === "23505") return { ok: false as const, error: "DUPLICATE_OR_COOLDOWN_SUPPRESSED", duplicate: true };
    return { ok: false as const, error: "OPERATIONS_JOB_INSERT_FAILED", duplicate: false };
  }
  return { ok: true as const, duplicate: false, jobId: job.id };
}

export async function listExecutiveReports(supabase?: SupabaseClient | null, limit = 20) {
  const client = admin(supabase);
  if (!client) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", reports: [] };
  const result = await client.from("roamly_ops_executive_reports").select(EXECUTIVE_REPORT_COLUMNS).order("period_start", { ascending: false }).limit(Math.min(100, Math.max(1, limit)));
  if (result.error) return { ok: false as const, error: "EXECUTIVE_REPORT_SCHEMA_UNAVAILABLE", reports: [] };
  return { ok: true as const, reports: result.data || [] };
}

export async function persistExecutiveReport(report: ExecutiveReportArtifact, supabase?: SupabaseClient | null) {
  const client = admin(supabase);
  if (!client) return { ok: false as const, reused: false, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const inserted = await client.from("roamly_ops_executive_reports").insert(executiveReportPersistenceRow(report)).select(EXECUTIVE_REPORT_COLUMNS).maybeSingle();
  if (!inserted.error) return { ok: true as const, reused: false, report: inserted.data };
  if (inserted.error.code !== "23505") return { ok: false as const, reused: false, error: inserted.error.code === "42P01" || inserted.error.code === "PGRST205" ? "EXECUTIVE_REPORT_SCHEMA_UNAVAILABLE" : "EXECUTIVE_REPORT_INSERT_FAILED" };
  const existing = await client.from("roamly_ops_executive_reports").select(EXECUTIVE_REPORT_COLUMNS).eq("report_identity", report.reportId).maybeSingle();
  if (existing.error || !existing.data) return { ok: false as const, reused: false, error: "EXECUTIVE_REPORT_IDEMPOTENCY_LOOKUP_FAILED" };
  return { ok: true as const, reused: true, report: existing.data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations worker persistence helpers (appended 2026-10-15 for the ops
// worker cron). Existing exports above are untouched.
// ─────────────────────────────────────────────────────────────────────────────
import type { OperationsEvidence } from "@/lib/roamly/opsControlPlane";

export type OperationsJobRow = Record<string, unknown>;

export function rowToOperationsJob(row: OperationsJobRow): OperationsJob {
  const asString = (value: unknown): string => String(value ?? "");
  return {
    id: asString(row.id),
    role: row.role as OperationsJob["role"],
    initiatingSignal: asString(row.initiating_signal),
    priority: row.priority as OperationsJob["priority"],
    risk: row.risk as OperationsJob["risk"],
    authorityLevel: row.authority_level as OperationsJob["authorityLevel"],
    status: row.status as OperationsJob["status"],
    objective: asString(row.objective),
    subsystem: asString(row.subsystem),
    scope: (row.scope_json || {}) as Record<string, unknown>,
    allowedOperations: (row.allowed_operations || []) as string[],
    allowedFiles: (row.allowed_files || []) as string[],
    forbiddenOperations: (row.forbidden_operations || []) as string[],
    dependencies: (row.dependencies || []) as string[],
    acceptanceCriteria: (row.acceptance_criteria || []) as string[],
    evidenceRequirements: (row.evidence_requirements || []) as OperationsEvidence["category"][],
    tokenBudget: Number(row.token_budget || 0),
    financialBudgetUsd: Number(row.financial_budget_usd || 0),
    maxAttempts: Number(row.max_attempts ?? 1),
    retryCount: Number(row.retry_count ?? 0),
    dedupeKey: asString(row.dedupe_key),
    cooldownUntil: (row.cooldown_until as string | null) ?? null,
    escalationReason: (row.escalation_reason as string | null) ?? null,
    ownerApprovalRequired: Boolean(row.owner_approval_required),
    runnerId: (row.runner_id as string | null) ?? null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

export type OperationsJobStatusPatch = {
  status?: string;
  started_at?: string | null;
  completed_at?: string | null;
  retry_count?: number;
  escalation_reason?: string | null;
};

/** Conditional claim/transition write: only updates when the row is still in expectedStatus. */
export async function updateOperationsJobStatus(id: string, expectedStatus: string, patch: OperationsJobStatusPatch): Promise<boolean> {
  const client = admin();
  if (!client) return false;
  const result = await client.from("roamly_ops_jobs").update(patch).eq("id", id).eq("status", expectedStatus).select("id");
  return !result.error && (result.data?.length || 0) > 0;
}

export async function insertOperationsAttempt(input: {
  jobId: string;
  attemptNumber: number;
  workerRole: string;
  runnerId: string | null;
  status: string;
  sanitizedSummary?: string | null;
  errorClass?: string | null;
}): Promise<string | null> {
  const client = admin();
  if (!client) return null;
  const result = await client
    .from("roamly_ops_attempts")
    .insert({
      job_id: input.jobId,
      attempt_number: input.attemptNumber,
      worker_role: input.workerRole,
      runner_id: input.runnerId,
      model_provider: "deterministic",
      model_name: null,
      status: input.status,
      token_count: 0,
      financial_cost_usd: 0,
      error_class: input.errorClass || null,
      sanitized_summary: input.sanitizedSummary || null,
      started_at: new Date().toISOString()
    })
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) return null;
  return String((result.data as { id: unknown }).id);
}

export async function updateOperationsAttempt(
  id: string,
  patch: { status?: string; sanitized_summary?: string | null; error_class?: string | null; completed_at?: string | null }
): Promise<boolean> {
  const client = admin();
  if (!client) return false;
  const result = await client.from("roamly_ops_attempts").update(patch).eq("id", id).select("id");
  return !result.error && (result.data?.length || 0) > 0;
}

export async function insertOperationsEvidence(evidence: OperationsEvidence, attemptId: string | null): Promise<string | null> {
  const client = admin();
  if (!client) return null;
  const result = await client
    .from("roamly_ops_evidence")
    .insert({
      id: evidence.id,
      job_id: evidence.jobId,
      attempt_id: attemptId,
      category: evidence.category,
      source: evidence.source,
      result: evidence.result,
      summary: evidence.summary,
      safe_metadata: evidence.metadata
    })
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) return null;
  return String((result.data as { id: unknown }).id);
}

export type OperationsLockRow = { subsystem: string; job_id: string; lease_expires_at: string };

export async function listOperationsLocks(): Promise<OperationsLockRow[]> {
  const client = admin();
  if (!client) return [];
  const result = await client.from("roamly_ops_locks").select("subsystem, job_id, lease_expires_at");
  if (result.error) return [];
  return (result.data || []) as OperationsLockRow[];
}

export async function deleteExpiredOperationsLocks(nowIso: string): Promise<number> {
  const client = admin();
  if (!client) return 0;
  const result = await client.from("roamly_ops_locks").delete().lt("lease_expires_at", nowIso).select("subsystem");
  if (result.error) return 0;
  return result.data?.length || 0;
}

/** True when the lock row was inserted; false when another worker holds the subsystem (unique violation). */
export async function acquireOperationsLock(subsystem: string, jobId: string, leaseMinutes: number): Promise<boolean> {
  const client = admin();
  if (!client) return false;
  const now = Date.now();
  const result = await client
    .from("roamly_ops_locks")
    .insert({
      subsystem,
      job_id: jobId,
      scope_hash: jobId,
      acquired_at: new Date(now).toISOString(),
      lease_expires_at: new Date(now + leaseMinutes * 60_000).toISOString(),
      reason: "ops_worker"
    })
    .select("subsystem");
  if (result.error) return false;
  return (result.data?.length || 0) > 0;
}

export async function releaseOperationsLock(subsystem: string, jobId: string): Promise<boolean> {
  const client = admin();
  if (!client) return false;
  const result = await client.from("roamly_ops_locks").delete().eq("subsystem", subsystem).eq("job_id", jobId).select("subsystem");
  return !result.error;
}

/** Recent deployment_ready evidence rows — used by the auto-deploy daily cap. */
export async function listRecentDeployEvidence(sinceIso: string): Promise<Array<{ id: string; created_at: string }>> {
  const client = admin();
  if (!client) return [];
  const result = await client
    .from("roamly_ops_evidence")
    .select("id, created_at")
    .eq("category", "deployment_ready")
    .gte("created_at", sinceIso);
  if (result.error) return [];
  return (result.data || []) as Array<{ id: string; created_at: string }>;
}
