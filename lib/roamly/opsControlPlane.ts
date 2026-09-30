import { randomUUID } from "node:crypto";

export const OPERATIONS_ROLES = [
  "OWNER", "COO", "PLANNER", "EXECUTIVE_SECRETARY", "CFO_FINOPS",
  "GAP_AUDIT_QA", "PROVIDER_INTELLIGENCE", "SECURITY_PRIVACY", "SEO",
  "UX", "CUSTOMER_EXPERIENCE", "GROWTH_MARKETING"
] as const;
export type OperationsRole = typeof OPERATIONS_ROLES[number];

export const AUTONOMY_LEVELS = ["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE", "LEVEL_3_SAFE_REPAIR", "LEVEL_4_OWNER_APPROVAL"] as const;
export type AutonomyLevel = typeof AUTONOMY_LEVELS[number];
export const OPERATIONS_STATES = [
  "DETECTED", "TRIAGED", "PLANNED", "QUEUED", "RUNNING", "VALIDATING",
  "AWAITING_APPROVAL", "APPROVED", "REJECTED", "DEPLOYING", "VERIFYING",
  "COMPLETED", "FAILED", "BLOCKED", "CANCELLED"
] as const;
export type OperationsJobState = typeof OPERATIONS_STATES[number];

export const EVIDENCE_CATEGORIES = [
  "deterministic_check", "test", "typecheck", "build", "changed_file_manifest",
  "commit_sha", "deployment_id", "deployment_sha", "deployment_ready",
  "safe_production_health", "external_config_blocker", "owner_approval"
] as const;
export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];

export const OWNER_APPROVAL_CATEGORIES = [
  "database_migration", "destructive_database_operation", "billing_payment",
  "spending", "new_paid_service", "provider_commercial_agreement",
  "credentials_secrets", "security_sensitive", "major_architecture",
  "customer_financial_truth", "privacy_data_retention", "weaken_validation"
] as const;
export type OwnerApprovalCategory = typeof OWNER_APPROVAL_CATEGORIES[number];

export type OperationsPriority = "critical" | "high" | "normal" | "low";
export type OperationsRisk = "low" | "medium" | "high" | "critical";

/**
 * Revenue impact scoring (owner goal: make money through website traffic,
 * less expenses, more income). Every specialist finding carries one of these:
 * a relative high/medium/low judgment plus a one-line rationale. Rationales
 * must never invent metrics — no fabricated dollar amounts, percentages, or
 * visitor counts — enforced by revenueImpact().
 */
export const REVENUE_IMPACT_LEVELS = ["high", "medium", "low"] as const;
export type RevenueImpactLevel = typeof REVENUE_IMPACT_LEVELS[number];
export type RevenueImpact = { level: RevenueImpactLevel; rationale: string };
export const REVENUE_IMPACT_RANK: Record<RevenueImpactLevel, number> = { high: 3, medium: 2, low: 1 };

const FABRICATED_METRIC_PATTERN = /\$\d[\d,]*(?:\.\d+)?\b|\b\d+(?:\.\d+)?%|\b\d{4,}\s+(?:visitors|users|clicks|trials|bookings|dollars|followers|views)\b/i;

export function revenueImpact(level: RevenueImpactLevel, rationale: string): RevenueImpact {
  if (!REVENUE_IMPACT_LEVELS.includes(level)) throw new Error("REVENUE_IMPACT_LEVEL_INVALID");
  const clean = rationale.trim();
  if (!clean) throw new Error("REVENUE_IMPACT_RATIONALE_REQUIRED");
  if (clean.length > 140) throw new Error("REVENUE_IMPACT_RATIONALE_TOO_LONG");
  if (FABRICATED_METRIC_PATTERN.test(clean)) throw new Error("REVENUE_IMPACT_METRIC_FABRICATION_FORBIDDEN");
  return { level, rationale: clean };
}

export type OperationsJob = {
  id: string;
  role: OperationsRole;
  initiatingSignal: string;
  priority: OperationsPriority;
  risk: OperationsRisk;
  authorityLevel: AutonomyLevel;
  status: OperationsJobState;
  objective: string;
  subsystem: string;
  scope: Record<string, unknown>;
  allowedOperations: string[];
  allowedFiles: string[];
  forbiddenOperations: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  evidenceRequirements: EvidenceCategory[];
  tokenBudget: number;
  financialBudgetUsd: number;
  maxAttempts: number;
  retryCount: number;
  dedupeKey: string;
  cooldownUntil: string | null;
  escalationReason: string | null;
  ownerApprovalRequired: boolean;
  runnerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperationsEvidence = {
  id: string;
  jobId: string;
  category: EvidenceCategory;
  source: string;
  result: "pass" | "fail" | "blocked" | "not_run";
  summary: string;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
};

export type OwnerDecision = {
  id: string;
  jobId: string;
  requestedCategory: OwnerApprovalCategory;
  risk: OperationsRisk;
  decision: "approved" | "rejected" | "deferred";
  evidenceIds: string[];
  ownerNote: string | null;
  decidedAt: string;
};

export const LEGAL_TRANSITIONS: Readonly<Record<OperationsJobState, readonly OperationsJobState[]>> = {
  DETECTED: ["TRIAGED", "CANCELLED"],
  TRIAGED: ["PLANNED", "BLOCKED", "CANCELLED"],
  PLANNED: ["QUEUED", "AWAITING_APPROVAL", "BLOCKED", "CANCELLED"],
  QUEUED: ["RUNNING", "BLOCKED", "CANCELLED"],
  RUNNING: ["VALIDATING", "FAILED", "BLOCKED", "CANCELLED"],
  VALIDATING: ["COMPLETED", "AWAITING_APPROVAL", "DEPLOYING", "FAILED", "BLOCKED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "BLOCKED", "CANCELLED"],
  APPROVED: ["QUEUED", "DEPLOYING", "CANCELLED"],
  REJECTED: ["CANCELLED", "PLANNED"],
  DEPLOYING: ["VERIFYING", "FAILED", "BLOCKED"],
  VERIFYING: ["COMPLETED", "FAILED", "BLOCKED"],
  COMPLETED: [], FAILED: [], BLOCKED: [], CANCELLED: []
};

const SENSITIVE_KEY = /(body|content|cookie|credential|email|gps|latitude|longitude|password|payment|prompt|secret|token|authorization|api[_-]?key|screenshot)/i;
const PRIORITY_WEIGHT: Record<OperationsPriority, number> = { critical: 4, high: 3, normal: 2, low: 1 };

export function ownerApprovalRequired(category?: string | null, authorityLevel?: AutonomyLevel) {
  return authorityLevel === "LEVEL_4_OWNER_APPROVAL" || Boolean(category && OWNER_APPROVAL_CATEGORIES.includes(category as OwnerApprovalCategory));
}

export function duplicateJobKey(input: Pick<OperationsJob, "role" | "subsystem" | "objective"> & { signal?: string }) {
  return [input.role, input.subsystem, input.objective, input.signal || ""].map((value) => value.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

export function createOperationsJob(input: Omit<Partial<OperationsJob>, "id" | "status" | "createdAt" | "updatedAt" | "retryCount"> & Pick<OperationsJob, "role" | "initiatingSignal" | "objective" | "subsystem">): OperationsJob {
  const authorityLevel = input.authorityLevel || "LEVEL_1_OBSERVE";
  const approval = input.ownerApprovalRequired === true || ownerApprovalRequired(input.scope?.approvalCategory as string | undefined, authorityLevel);
  return {
    id: randomUUID(), role: input.role, initiatingSignal: input.initiatingSignal,
    priority: input.priority || "normal", risk: input.risk || "low", authorityLevel,
    status: "DETECTED", objective: input.objective, subsystem: input.subsystem,
    scope: input.scope || {}, allowedOperations: input.allowedOperations || [], allowedFiles: input.allowedFiles || [],
    forbiddenOperations: input.forbiddenOperations || ["production_mutation", "customer_data_access", "arbitrary_command", "spending"],
    dependencies: input.dependencies || [], acceptanceCriteria: input.acceptanceCriteria || [],
    evidenceRequirements: input.evidenceRequirements || ["deterministic_check"], tokenBudget: Math.max(0, input.tokenBudget ?? 0),
    financialBudgetUsd: Math.max(0, input.financialBudgetUsd ?? 0), maxAttempts: Math.max(1, input.maxAttempts ?? 1), retryCount: 0,
    dedupeKey: input.dedupeKey || duplicateJobKey({ role: input.role, subsystem: input.subsystem, objective: input.objective, signal: input.initiatingSignal }),
    cooldownUntil: input.cooldownUntil || null, escalationReason: input.escalationReason || null,
    ownerApprovalRequired: approval, runnerId: input.runnerId || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

export function assertAuthorityUnchanged(original: OperationsJob, proposed: OperationsJob) {
  if (original.authorityLevel !== proposed.authorityLevel) throw new Error("JOB_AUTHORITY_IMMUTABLE");
}

export function evidenceSatisfiesCompletion(job: OperationsJob, evidence: OperationsEvidence[], decision?: OwnerDecision | null) {
  const categories = new Set(evidence.filter((item) => item.result === "pass").map((item) => item.category));
  const required = job.evidenceRequirements.every((category) => categories.has(category));
  const approval = !job.ownerApprovalRequired || Boolean(decision && decision.decision === "approved" && decision.jobId === job.id);
  return required && approval;
}

export function transitionOperationsJob(job: OperationsJob, next: OperationsJobState, evidence: OperationsEvidence[] = [], decision?: OwnerDecision | null) {
  if (!LEGAL_TRANSITIONS[job.status].includes(next)) throw new Error(`ILLEGAL_JOB_TRANSITION:${job.status}->${next}`);
  if (next === "QUEUED" && job.ownerApprovalRequired && (!decision || decision.jobId !== job.id || decision.decision !== "approved")) throw new Error("OWNER_APPROVAL_REQUIRED");
  if (next === "COMPLETED" && !evidenceSatisfiesCompletion(job, evidence, decision)) throw new Error("COMPLETION_EVIDENCE_REQUIRED");
  if (next === "DEPLOYING" && job.authorityLevel !== "LEVEL_3_SAFE_REPAIR") throw new Error("DEPLOYMENT_AUTHORITY_REQUIRED");
  return { ...job, status: next, updatedAt: new Date().toISOString() };
}

export function sanitizeOperationsMetadata(input: Record<string, unknown> | null | undefined) {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input || {}).slice(0, 20)) {
    if (SENSITIVE_KEY.test(key) || key.length > 48) throw new Error("SENSITIVE_EVIDENCE_KEY_REJECTED");
    if (typeof value === "string" && value.length > 240) throw new Error("EVIDENCE_VALUE_TOO_LARGE");
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") output[key] = value;
    else throw new Error("EVIDENCE_VALUE_NOT_SCALAR");
  }
  return output;
}

export function createEvidence(input: Omit<OperationsEvidence, "id" | "createdAt" | "metadata"> & { metadata?: Record<string, unknown> }): OperationsEvidence {
  return { ...input, id: randomUUID(), metadata: sanitizeOperationsMetadata(input.metadata), createdAt: new Date().toISOString() };
}

export function retryAllowed(job: Pick<OperationsJob, "retryCount" | "maxAttempts">) { return job.retryCount + 1 < job.maxAttempts; }
export function retryDelaySeconds(attempt: number) { return Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1))); }

export function budgetAllows(job: Pick<OperationsJob, "tokenBudget" | "financialBudgetUsd">, usage: { tokens: number; financialCostUsd: number }) {
  return usage.tokens >= 0 && usage.financialCostUsd >= 0 && usage.tokens <= job.tokenBudget && usage.financialCostUsd <= job.financialBudgetUsd;
}

export function dispatchAllowed(job: OperationsJob, input: { activeGlobalJobs: number; globalLimit: number; lockedSubsystems: string[]; dependencyStates: Record<string, OperationsJobState>; usage?: { tokens: number; financialCostUsd: number }; now?: number; allowedAuthorityLevels?: AutonomyLevel[] }) {
  const allowedAuthorityLevels = input.allowedAuthorityLevels || ["LEVEL_1_OBSERVE"];
  if (job.status !== "QUEUED" || job.ownerApprovalRequired || !allowedAuthorityLevels.includes(job.authorityLevel) || !job.runnerId || !isRegisteredRunner(job.runnerId)) return false;
  if (input.activeGlobalJobs >= input.globalLimit || input.lockedSubsystems.includes(job.subsystem)) return false;
  if (job.cooldownUntil && Date.parse(job.cooldownUntil) > (input.now || Date.now())) return false;
  if (job.dependencies.some((id) => input.dependencyStates[id] !== "COMPLETED")) return false;
  return !input.usage || budgetAllows(job, input.usage);
}

export type DeterministicRunnerResult = { runnerId: string; ok: boolean; summary: string; metadata: Record<string, string | number | boolean> };
const REGISTERED_RUNNERS = {
  "phase1.policy-self-check": (): DeterministicRunnerResult => ({ runnerId: "phase1.policy-self-check", ok: true, summary: "Operations policy registry is available.", metadata: { mutatesProduction: false } }),
  "phase1.orchestration-smoke": (): DeterministicRunnerResult => ({ runnerId: "phase1.orchestration-smoke", ok: true, summary: "Controlled deterministic orchestration smoke completed.", metadata: { mutatesProduction: false } }),
  "phase2.gap-audit.observe": (): DeterministicRunnerResult => ({ runnerId: "phase2.gap-audit.observe", ok: true, summary: "Allowlisted Gap Audit observation runner completed.", metadata: { mutatesProduction: false, specialist: "GAP_AUDIT_QA", authority: "LEVEL_1_OBSERVE" } }),
  "phase2.gap-audit.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase2.gap-audit.diagnose", ok: true, summary: "Allowlisted Gap Audit diagnosis runner completed.", metadata: { mutatesProduction: false, specialist: "GAP_AUDIT_QA", authority: "LEVEL_2_DIAGNOSE" } }),
  "phase2.gap-audit.safe-repair": (): DeterministicRunnerResult => ({ runnerId: "phase2.gap-audit.safe-repair", ok: true, summary: "Allowlisted Gap Audit bounded safe-repair runner completed.", metadata: { mutatesProduction: false, network: "NONE", specialist: "GAP_AUDIT_QA", authority: "LEVEL_3_SAFE_REPAIR", bounded: true } }),
  "phase8.secretary.safe-repair": (): DeterministicRunnerResult => ({ runnerId: "phase8.secretary.safe-repair", ok: true, summary: "Allowlisted Executive Secretary bounded safe-repair coordination runner completed.", metadata: { mutatesProduction: false, network: "NONE", specialist: "EXECUTIVE_SECRETARY", authority: "LEVEL_3_SAFE_REPAIR", bounded: true } }),
  "phase4.worker-contract-smoke": (): DeterministicRunnerResult => ({ runnerId: "phase4.worker-contract-smoke", ok: true, summary: "Provider-neutral simulated worker contract completed.", metadata: { mutatesProduction: false, network: "NONE", secrets: "NONE" } }),
  "phase5.seo.observe": (): DeterministicRunnerResult => ({ runnerId: "phase5.seo.observe", ok: true, summary: "Allowlisted SEO observation runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.seo.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase5.seo.diagnose", ok: true, summary: "Allowlisted SEO diagnosis runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.ux.observe": (): DeterministicRunnerResult => ({ runnerId: "phase5.ux.observe", ok: true, summary: "Allowlisted UX observation runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.ux.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase5.ux.diagnose", ok: true, summary: "Allowlisted UX diagnosis runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.security.observe": (): DeterministicRunnerResult => ({ runnerId: "phase5.security.observe", ok: true, summary: "Allowlisted security/privacy observation runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.security.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase5.security.diagnose", ok: true, summary: "Allowlisted security/privacy diagnosis runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.provider.observe": (): DeterministicRunnerResult => ({ runnerId: "phase5.provider.observe", ok: true, summary: "Allowlisted provider/travel observation runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.provider.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase5.provider.diagnose", ok: true, summary: "Allowlisted provider/travel diagnosis runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.marketing.observe": (): DeterministicRunnerResult => ({ runnerId: "phase5.marketing.observe", ok: true, summary: "Allowlisted marketing/growth observation runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.marketing.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase5.marketing.diagnose", ok: true, summary: "Allowlisted marketing/growth diagnosis runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.cx.observe": (): DeterministicRunnerResult => ({ runnerId: "phase5.cx.observe", ok: true, summary: "Allowlisted customer experience observation runner completed.", metadata: { mutatesProduction: false, network: "NONE" } }),
  "phase5.cx.diagnose": (): DeterministicRunnerResult => ({ runnerId: "phase5.cx.diagnose", ok: true, summary: "Allowlisted customer experience diagnosis runner completed.", metadata: { mutatesProduction: false, network: "NONE" } })
} as const;

export type RegisteredRunnerId = keyof typeof REGISTERED_RUNNERS;
export function isRegisteredRunner(value: string | null | undefined): value is RegisteredRunnerId { return Boolean(value && Object.hasOwn(REGISTERED_RUNNERS, value)); }
export function runRegisteredRunner(runnerId: RegisteredRunnerId) { return REGISTERED_RUNNERS[runnerId](); }

export class OperationsScheduler {
  private readonly jobs = new Map<string, OperationsJob>();
  private readonly locks = new Map<string, string>();
  enqueue(job: OperationsJob) {
    if ([...this.jobs.values()].some((existing) => existing.dedupeKey === job.dedupeKey && !["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"].includes(existing.status))) return false;
    if (job.status === "DETECTED") {
      const planned = transitionOperationsJob(transitionOperationsJob(transitionOperationsJob(job, "TRIAGED"), "PLANNED"), job.ownerApprovalRequired ? "AWAITING_APPROVAL" : "QUEUED");
      this.jobs.set(job.id, planned);
    } else this.jobs.set(job.id, job);
    return true;
  }
  acquire(jobId: string, subsystem: string) {
    if (this.locks.has(subsystem)) return false;
    this.locks.set(subsystem, jobId); return true;
  }
  release(jobId: string, subsystem: string) { if (this.locks.get(subsystem) === jobId) this.locks.delete(subsystem); }
  orderedJobs() { return [...this.jobs.values()].sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.createdAt.localeCompare(b.createdAt)); }
}
