import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OperationsJob } from "@/lib/roamly/opsControlPlane";

const JOB_COLUMNS = "id,role,initiating_signal,priority,risk,authority_level,status,objective,subsystem,scope_json,allowed_operations,allowed_files,forbidden_operations,dependencies,acceptance_criteria,evidence_requirements,token_budget,financial_budget_usd,max_attempts,retry_count,dedupe_key,cooldown_until,escalation_reason,owner_approval_required,runner_id,created_at,updated_at,started_at,completed_at";
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
