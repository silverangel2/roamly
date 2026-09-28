// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { assertAuthorityUnchanged, budgetAllows, createOperationsJob, dispatchAllowed, duplicateJobKey, isRegisteredRunner, ownerApprovalRequired, type AutonomyLevel, type OperationsJob, type OperationsPriority, type OperationsRisk, type OperationsScheduler } from "./opsControlPlane.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { SPECIALIST_PROFILES, specialistSupportsRunner, specialistSupportsSignal, specialistSupportsSubsystem, type SpecialistId as OrganizationSpecialistId } from "./specialistOrganization.ts";

const AUTHORITY_RANK: Record<AutonomyLevel, number> = { LEVEL_1_OBSERVE: 1, LEVEL_2_DIAGNOSE: 2, LEVEL_3_SAFE_REPAIR: 3, LEVEL_4_OWNER_APPROVAL: 4 };

export const PHASE3_MAX_AUTHORITY: AutonomyLevel = "LEVEL_2_DIAGNOSE";
export const SPECIALIST_REGISTRY = SPECIALIST_PROFILES;
export type SpecialistId = OrganizationSpecialistId;
export type AdrianSignal = {
  signalId: string;
  source: "deterministic_check" | "operational_incident" | "failed_job" | "schedule";
  code: string;
  objective: string;
  subsystem: string;
  specialist: string;
  requestedAuthority: AutonomyLevel;
  priority?: OperationsPriority;
  risk?: OperationsRisk;
  tokenBudget?: number;
  financialBudgetUsd?: number;
  attemptCeiling?: number;
  approvalCategory?: string | null;
  dependencies?: string[];
  dedupeKey?: string;
  cooldownSeconds?: number;
  safeMetadata?: Record<string, string | number | boolean>;
  evidenceReference?: string | null;
  correlationKey?: string | null;
  observedAt?: string;
  cooldownClass?: string;
  expiresAt?: string;
};

export type AdrianDecision = {
  accepted: boolean;
  reason: string;
  specialist: SpecialistId | null;
  authorityCeiling: AutonomyLevel | null;
  ownerApprovalRequired: boolean;
  job: OperationsJob | null;
};

function supportedSpecialist(value: string): value is SpecialistId {
  return Object.hasOwn(SPECIALIST_REGISTRY, value);
}

function validSignal(signal: AdrianSignal) {
  return Boolean(signal.signalId.trim() && signal.code.trim() && signal.objective.trim() && signal.subsystem.trim());
}

export function adrianTriage(signal: AdrianSignal, scheduler: OperationsScheduler, now = Date.now()): AdrianDecision {
  if (!validSignal(signal)) return { accepted: false, reason: "INVALID_SIGNAL", specialist: null, authorityCeiling: null, ownerApprovalRequired: false, job: null };
  if (!supportedSpecialist(signal.specialist)) return { accepted: false, reason: "UNKNOWN_SPECIALIST", specialist: null, authorityCeiling: null, ownerApprovalRequired: false, job: null };
  const policy = SPECIALIST_REGISTRY[signal.specialist];
  if (!specialistSupportsSignal(signal.specialist, { code: signal.code, subsystem: signal.subsystem })) return { accepted: false, reason: "SIGNAL_UNSUPPORTED_BY_SPECIALIST", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: false, job: null };
  if (!specialistSupportsSubsystem(signal.specialist, signal.subsystem)) return { accepted: false, reason: "SUBSYSTEM_UNSUPPORTED_BY_SPECIALIST", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: false, job: null };
  if (AUTHORITY_RANK[signal.requestedAuthority] > AUTHORITY_RANK[policy.maxAuthority] || AUTHORITY_RANK[signal.requestedAuthority] > AUTHORITY_RANK[PHASE3_MAX_AUTHORITY]) {
    return { accepted: false, reason: "AUTHORITY_EXCEEDS_PHASE3_POLICY", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: false, job: null };
  }
  if (!specialistSupportsRunner(signal.specialist, signal.requestedAuthority as "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE", policy.runners[signal.requestedAuthority as "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE"] || null)) {
    return { accepted: false, reason: "SPECIALIST_RUNNER_POLICY_INVALID", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: false, job: null };
  }
  const tokenBudget = signal.tokenBudget ?? policy.tokenBudget;
  const financialBudgetUsd = signal.financialBudgetUsd ?? policy.financialBudgetUsd;
  const maxAttempts = signal.attemptCeiling ?? policy.maxAttempts;
  if (tokenBudget > policy.tokenBudget || financialBudgetUsd > policy.financialBudgetUsd || maxAttempts > policy.maxAttempts) {
    return { accepted: false, reason: "BUDGET_EXCEEDS_SPECIALIST_POLICY", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: false, job: null };
  }
  const approval = ownerApprovalRequired(signal.approvalCategory, signal.requestedAuthority);
  const job = createOperationsJob({
    role: policy.role,
    initiatingSignal: `${signal.source}:${signal.code}`,
    objective: signal.objective,
    subsystem: signal.subsystem,
    priority: signal.priority || "normal",
    risk: signal.risk || "low",
    authorityLevel: signal.requestedAuthority,
    scope: { orchestration: { signalId: signal.signalId, specialist: signal.specialist, source: signal.source, code: signal.code, authorityCeiling: policy.maxAuthority, triage: "accepted" }, signal: { observedAt: signal.observedAt || null, cooldownClass: signal.cooldownClass || null, expiresAt: signal.expiresAt || null, dedupeKey: signal.dedupeKey || null, safeMetadata: signal.safeMetadata || {}, evidenceReference: signal.evidenceReference || null, correlationKey: signal.correlationKey || null }, approvalCategory: signal.approvalCategory || null },
    allowedOperations: ["read_approved_repository_state", "record_deterministic_evidence", "prepare_bounded_diagnosis"],
    forbiddenOperations: ["code_edit", "commit", "push", "deploy", "production_mutation", "customer_data_access", "spending", "credential_access", "arbitrary_command", "provider_configuration_change", "customer_truth_change"],
    dependencies: signal.dependencies || [],
    acceptanceCriteria: ["Required deterministic evidence is recorded.", "No forbidden operation is attempted."],
    evidenceRequirements: ["deterministic_check"],
    tokenBudget,
    financialBudgetUsd,
    maxAttempts,
    ownerApprovalRequired: approval,
    cooldownUntil: new Date(now + Math.max(policy.cooldownSeconds, signal.cooldownSeconds || 0) * 1000).toISOString(),
    runnerId: policy.runners[signal.requestedAuthority as "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE"],
    dedupeKey: signal.dedupeKey || duplicateJobKey({ role: policy.role, subsystem: signal.subsystem, objective: signal.signalId, signal: signal.code })
  });
  if (!scheduler.enqueue(job)) return { accepted: false, reason: "DUPLICATE_OR_COOLDOWN_SUPPRESSED", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: approval, job: null };
  return { accepted: true, reason: approval ? "ACCEPTED_AWAITING_OWNER_APPROVAL" : "ACCEPTED_QUEUED", specialist: signal.specialist, authorityCeiling: policy.maxAuthority, ownerApprovalRequired: approval, job: { ...job, status: approval ? "AWAITING_APPROVAL" : "QUEUED" } };
}

export type LucaPlan = {
  jobId: string;
  objective: string;
  subsystem: string;
  specialist: SpecialistId;
  authorityCeiling: AutonomyLevel;
  dependencies: string[];
  orderedSteps: string[];
  allowedOperations: string[];
  forbiddenOperations: string[];
  evidenceRequirements: OperationsJob["evidenceRequirements"];
  acceptanceCriteria: string[];
  lockRequired: string;
  retryCeiling: number;
  tokenBudget: number;
  financialBudgetUsd: number;
  completionConditions: string[];
  escalationConditions: string[];
  ready: boolean;
  blockedReason: string | null;
};

export function lucaPlan(job: OperationsJob, dependencyStates: Record<string, OperationsJob["status"]>, lockedSubsystems: string[] = []): LucaPlan {
  const specialist = Object.entries(SPECIALIST_REGISTRY).find(([, policy]) => policy.role === job.role && policy.runners[job.authorityLevel as "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE"] === job.runnerId)?.[0] as SpecialistId | undefined;
  if (!specialist) throw new Error("UNSUPPORTED_SPECIALIST_OR_RUNNER");
  if (AUTHORITY_RANK[job.authorityLevel] > AUTHORITY_RANK[PHASE3_MAX_AUTHORITY]) throw new Error("LUCA_AUTHORITY_CEILING_EXCEEDED");
  const missing = job.dependencies.filter((dependency) => dependencyStates[dependency] !== "COMPLETED");
  const lockConflict = lockedSubsystems.includes(job.subsystem);
  const plan: LucaPlan = {
    jobId: job.id,
    objective: job.objective,
    subsystem: job.subsystem,
    specialist,
    authorityCeiling: job.authorityLevel,
    dependencies: [...job.dependencies],
    orderedSteps: ["verify_dependencies", "acquire_subsystem_lock", "run_registered_specialist", "record_deterministic_evidence", "validate_completion"],
    allowedOperations: [...job.allowedOperations],
    forbiddenOperations: [...job.forbiddenOperations],
    evidenceRequirements: [...job.evidenceRequirements],
    acceptanceCriteria: [...job.acceptanceCriteria],
    lockRequired: job.subsystem,
    retryCeiling: job.maxAttempts,
    tokenBudget: job.tokenBudget,
    financialBudgetUsd: job.financialBudgetUsd,
    completionConditions: [...job.evidenceRequirements],
    escalationConditions: ["dependency_missing", "subsystem_lock_conflict", "budget_exhausted", "required_evidence_missing", "owner_approval_required"],
    ready: missing.length === 0 && !lockConflict && job.status === "QUEUED" && !job.ownerApprovalRequired,
    blockedReason: missing.length ? "DEPENDENCY_NOT_COMPLETED" : lockConflict ? "SUBSYSTEM_LOCK_CONFLICT" : job.ownerApprovalRequired ? "OWNER_APPROVAL_REQUIRED" : job.status !== "QUEUED" ? "JOB_NOT_QUEUED" : null
  };
  assertAuthorityUnchanged(job, { ...job, authorityLevel: plan.authorityCeiling });
  if (plan.tokenBudget !== job.tokenBudget || plan.financialBudgetUsd !== job.financialBudgetUsd || plan.evidenceRequirements.join("|") !== job.evidenceRequirements.join("|")) throw new Error("LUCA_PLAN_EXPANDED_POLICY");
  return plan;
}

export function lucaDispatchAllowed(plan: LucaPlan, job: OperationsJob, input: Parameters<typeof dispatchAllowed>[1]) {
  if (!plan.ready || plan.jobId !== job.id || plan.authorityCeiling !== job.authorityLevel || AUTHORITY_RANK[plan.authorityCeiling] > AUTHORITY_RANK[PHASE3_MAX_AUTHORITY] || !isRegisteredRunner(job.runnerId) || !specialistSupportsRunner(plan.specialist, job.authorityLevel as "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE", job.runnerId)) return false;
  if (plan.tokenBudget !== job.tokenBudget || plan.financialBudgetUsd !== job.financialBudgetUsd) return false;
  if (!budgetAllows(job, input.usage || { tokens: 0, financialCostUsd: 0 })) return false;
  return dispatchAllowed(job, { ...input, allowedAuthorityLevels: ["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE"] });
}

export function safeOrchestrationSummary(scope: unknown) {
  const orchestration = (scope as { orchestration?: Record<string, unknown> } | null)?.orchestration;
  if (!orchestration || typeof orchestration !== "object") return null;
  return {
    specialist: typeof orchestration.specialist === "string" ? orchestration.specialist : "Unknown",
    source: typeof orchestration.source === "string" ? orchestration.source : "Unknown",
    code: typeof orchestration.code === "string" ? orchestration.code : "Unknown",
    authorityCeiling: typeof orchestration.authorityCeiling === "string" ? orchestration.authorityCeiling : "Unknown",
    triage: typeof orchestration.triage === "string" ? orchestration.triage : "Unknown"
  };
}

export function safeWorkerSummary(scope: unknown) {
  const worker = (scope as { worker?: Record<string, unknown> } | null)?.worker;
  if (!worker || typeof worker !== "object") return null;
  return {
    provider: typeof worker.provider === "string" ? worker.provider : "Unknown",
    repositoryRevision: typeof worker.repositoryRevision === "string" ? worker.repositoryRevision.slice(0, 80) : "Unknown",
    runnerId: typeof worker.runnerId === "string" ? worker.runnerId : "Unknown",
    network: worker.network === "NONE" ? "NONE" : "Unknown",
    cleanupState: typeof worker.cleanupState === "string" ? worker.cleanupState : "Unknown"
  };
}
