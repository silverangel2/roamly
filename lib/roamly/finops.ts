import type { OperationsJob, OperationsRisk, OwnerDecision } from "./opsControlPlane";

export const FINOPS_ROLE = "CFO_FINOPS" as const;
export const TOKEN_ROI_MANAGER = "TOKEN_ROI_MANAGER" as const;

export const PROVIDER_CLASSES = [
  "deterministic",
  "simulated-local",
  "openai",
  "codex",
  "grok",
  "approved_model"
] as const;
export type ProviderClass = typeof PROVIDER_CLASSES[number];

export const EXECUTION_CLASSES = ["deterministic", "worker", "model"] as const;
export type ExecutionClass = typeof EXECUTION_CLASSES[number];
export const BUSINESS_PURPOSES = [
  "reliability",
  "security_privacy",
  "seo",
  "ux",
  "provider_intelligence",
  "marketing_growth",
  "customer_experience",
  "operations_control_plane"
] as const;
export type BusinessPurpose = typeof BUSINESS_PURPOSES[number];

export type KnownOrUnknown = number | null;

export type TokenCostAccounting = {
  recordId: string;
  jobId: string;
  attemptId: string;
  specialist: string;
  subsystem: string;
  provider: ProviderClass;
  modelOrWorkerClass: string;
  executionClass: ExecutionClass;
  inputTokens: KnownOrUnknown;
  outputTokens: KnownOrUnknown;
  cachedTokens: KnownOrUnknown;
  financialCostUsd: KnownOrUnknown;
  durationMs: KnownOrUnknown;
  retryCount: number;
  outcome: "completed" | "failed" | "blocked" | "cancelled" | "unknown";
  evidenceQuality: "acceptable" | "insufficient" | "unknown";
  businessPurpose: BusinessPurpose;
  authoritativeCost: boolean;
  createdAt: string;
};

export type FinOpsBudgetPolicy = {
  jobTokenCeiling: number;
  specialistTokenCeiling: number;
  providerTokenCeiling: number;
  dailyTokenCeiling: number;
  weeklyTokenCeiling: number;
  monthlyTokenCeiling: number;
  retryCeiling: number;
  financialCeilingUsd: number;
  ownerApprovalRequired: boolean;
};

export type EconomicDecision =
  | "ALLOW"
  | "ALLOW_WITH_LOWER_CEILING"
  | "USE_DETERMINISTIC_RUNNER"
  | "REUSE_EXISTING_EVIDENCE"
  | "DEFER"
  | "REQUIRES_OWNER_APPROVAL"
  | "BLOCK_BUDGET_EXCEEDED";

export type EconomicEvaluation = {
  decision: EconomicDecision;
  reason: string;
  approvedProvider: ProviderClass | null;
  tokenCeiling: number;
  financialCeilingUsd: number;
  ownerApprovalRequired: boolean;
};

export type BusinessValueStatus = "CONFIRMED_REVENUE" | "ATTRIBUTED_REVENUE" | "ESTIMATED_VALUE" | "COST_AVOIDED" | "UNKNOWN";

export type BusinessValueAttribution = {
  status: BusinessValueStatus;
  amountUsd: number | null;
  evidenceReference: string | null;
  causation: "direct" | "attributed" | "estimated" | "avoided" | "unknown";
  confidence: "authoritative" | "supported" | "hypothesis" | "unknown";
};

export type RoiResult = {
  status: "KNOWN" | "UNKNOWN";
  costUsd: number | null;
  valueUsd: number | null;
  netValueUsd: number | null;
  ratio: number | null;
  reason: string;
};

export type FinOpsFinding = {
  code: "DUPLICATE_EXECUTION" | "RETRY_BURN" | "CONTEXT_BURN" | "STRONG_MODEL_WITHOUT_JUSTIFICATION" | "DETERMINISTIC_RUNNER_AVAILABLE" | "LOW_VALUE_EVIDENCE" | "UNRESOLVED_REPEAT";
  severity: OperationsRisk;
  evidence: string[];
  recommendation: string;
};

const MAX_CEILING = 1_000_000_000;

function nonNegativeKnown(value: unknown, field: string): KnownOrUnknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`FINOPS_INVALID_${field.toUpperCase()}`);
  return value;
}

function ceiling(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_CEILING) throw new Error(`FINOPS_INVALID_${field.toUpperCase()}`);
  return value;
}

function provider(value: string): ProviderClass {
  if (!PROVIDER_CLASSES.includes(value as ProviderClass)) throw new Error("FINOPS_PROVIDER_NOT_REGISTERED");
  return value as ProviderClass;
}

export function createTokenCostAccounting(input: Omit<TokenCostAccounting, "recordId" | "createdAt" | "inputTokens" | "outputTokens" | "cachedTokens" | "financialCostUsd" | "durationMs"> & Partial<Pick<TokenCostAccounting, "inputTokens" | "outputTokens" | "cachedTokens" | "financialCostUsd" | "durationMs">>): TokenCostAccounting {
  if (!input.jobId.trim() || !input.attemptId.trim() || !input.specialist.trim() || !input.subsystem.trim()) throw new Error("FINOPS_IDENTITY_REQUIRED");
  if (!input.modelOrWorkerClass.trim()) throw new Error("FINOPS_WORKER_CLASS_REQUIRED");
  if (!Number.isInteger(input.retryCount) || input.retryCount < 0) throw new Error("FINOPS_INVALID_RETRY_COUNT");
  const selectedProvider = provider(input.provider);
  return {
    ...input,
    provider: selectedProvider,
    recordId: crypto.randomUUID(),
    inputTokens: nonNegativeKnown(input.inputTokens, "input_tokens"),
    outputTokens: nonNegativeKnown(input.outputTokens, "output_tokens"),
    cachedTokens: nonNegativeKnown(input.cachedTokens, "cached_tokens"),
    financialCostUsd: nonNegativeKnown(input.financialCostUsd, "financial_cost_usd"),
    durationMs: nonNegativeKnown(input.durationMs, "duration_ms"),
    createdAt: new Date().toISOString()
  };
}

export function totalKnownTokens(record: Pick<TokenCostAccounting, "inputTokens" | "outputTokens" | "cachedTokens">): number | null {
  if (record.inputTokens === null || record.outputTokens === null || record.cachedTokens === null) return null;
  return record.inputTokens + record.outputTokens;
}

export function evaluateBudget(policy: FinOpsBudgetPolicy, usage: { tokens: number | null; financialCostUsd: number | null; retryCount: number }, executionClass: ExecutionClass, providerClass: ProviderClass): EconomicEvaluation {
  for (const field of ["jobTokenCeiling", "specialistTokenCeiling", "providerTokenCeiling", "dailyTokenCeiling", "weeklyTokenCeiling", "monthlyTokenCeiling", "financialCeilingUsd", "retryCeiling"] as const) ceiling(policy[field], field);
  if (usage.retryCount > policy.retryCeiling) return { decision: "BLOCK_BUDGET_EXCEEDED", reason: "RETRY_CEILING_EXCEEDED", approvedProvider: null, tokenCeiling: policy.jobTokenCeiling, financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: false };
  if (usage.tokens !== null && usage.tokens > Math.min(policy.jobTokenCeiling, policy.specialistTokenCeiling, policy.providerTokenCeiling, policy.dailyTokenCeiling, policy.weeklyTokenCeiling, policy.monthlyTokenCeiling)) return { decision: "BLOCK_BUDGET_EXCEEDED", reason: "TOKEN_CEILING_EXCEEDED", approvedProvider: null, tokenCeiling: policy.jobTokenCeiling, financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: false };
  if (usage.financialCostUsd !== null && usage.financialCostUsd > policy.financialCeilingUsd) return { decision: "BLOCK_BUDGET_EXCEEDED", reason: "FINANCIAL_CEILING_EXCEEDED", approvedProvider: null, tokenCeiling: policy.jobTokenCeiling, financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: false };
  if (executionClass !== "deterministic" && policy.financialCeilingUsd === 0) return { decision: "BLOCK_BUDGET_EXCEEDED", reason: "PAID_EXECUTION_NOT_PERMITTED_BY_ZERO_FINANCIAL_CEILING", approvedProvider: null, tokenCeiling: policy.jobTokenCeiling, financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: false };
  if (executionClass !== "deterministic" && (usage.tokens === null || usage.financialCostUsd === null)) return { decision: "REQUIRES_OWNER_APPROVAL", reason: "AUTHORITATIVE_USAGE_OR_COST_REQUIRED", approvedProvider: providerClass, tokenCeiling: policy.jobTokenCeiling, financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: true };
  if (policy.ownerApprovalRequired) return { decision: "REQUIRES_OWNER_APPROVAL", reason: "POLICY_REQUIRES_OWNER_APPROVAL", approvedProvider: providerClass, tokenCeiling: policy.jobTokenCeiling, financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: true };
  const tokenLimit = Math.min(policy.jobTokenCeiling, policy.specialistTokenCeiling, policy.providerTokenCeiling, policy.dailyTokenCeiling, policy.weeklyTokenCeiling, policy.monthlyTokenCeiling);
  const nearLimit = usage.tokens !== null && tokenLimit > 0 && usage.tokens >= tokenLimit * 0.8;
  return { decision: nearLimit ? "ALLOW_WITH_LOWER_CEILING" : "ALLOW", reason: nearLimit ? "TOKEN_CEILING_NEAR_LIMIT" : "WITHIN_APPROVED_CEILINGS", approvedProvider: providerClass, tokenCeiling: Math.min(policy.jobTokenCeiling, tokenLimit), financialCeilingUsd: policy.financialCeilingUsd, ownerApprovalRequired: false };
}

export function recommendEconomicPolicy(input: { deterministicSufficient: boolean; reusableEvidence: boolean; requestedProvider: ProviderClass; executionClass: ExecutionClass; policy: FinOpsBudgetPolicy; usage: { tokens: number | null; financialCostUsd: number | null; retryCount: number }; ownerDecision?: OwnerDecision | null }): EconomicEvaluation {
  if (input.reusableEvidence) return { decision: "REUSE_EXISTING_EVIDENCE", reason: "AUTHORITATIVE_REUSABLE_EVIDENCE_EXISTS", approvedProvider: null, tokenCeiling: input.policy.jobTokenCeiling, financialCeilingUsd: input.policy.financialCeilingUsd, ownerApprovalRequired: false };
  if (input.deterministicSufficient) return { decision: "USE_DETERMINISTIC_RUNNER", reason: "DETERMINISTIC_EXECUTION_IS_SUFFICIENT", approvedProvider: "deterministic", tokenCeiling: input.policy.jobTokenCeiling, financialCeilingUsd: 0, ownerApprovalRequired: false };
  const budget = evaluateBudget(input.policy, input.usage, input.executionClass, input.requestedProvider);
  if (budget.ownerApprovalRequired && input.ownerDecision?.decision === "approved" && input.ownerDecision.jobId && ["spending", "new_paid_service"].includes(input.ownerDecision.requestedCategory)) return { ...budget, decision: "ALLOW", reason: "DURABLE_OWNER_APPROVAL_PRESENT", ownerApprovalRequired: false };
  return budget;
}

export function createBusinessValueAttribution(input: BusinessValueAttribution): BusinessValueAttribution {
  if (input.amountUsd !== null && (!Number.isFinite(input.amountUsd) || input.amountUsd < 0)) throw new Error("FINOPS_INVALID_VALUE");
  if (input.status === "UNKNOWN" && input.amountUsd !== null) throw new Error("FINOPS_UNKNOWN_VALUE_MUST_REMAIN_UNKNOWN");
  if (input.status !== "UNKNOWN" && input.amountUsd === null) throw new Error("FINOPS_VALUE_AMOUNT_REQUIRED");
  if (input.status === "CONFIRMED_REVENUE" && (input.confidence !== "authoritative" || input.causation !== "direct" || !input.evidenceReference)) throw new Error("FINOPS_CONFIRMED_REVENUE_REQUIRES_AUTHORITATIVE_EVIDENCE");
  return { ...input };
}

export function calculateRoi(costUsd: number | null, value: BusinessValueAttribution): RoiResult {
  if (costUsd === null || value.amountUsd === null || value.status === "UNKNOWN") return { status: "UNKNOWN", costUsd, valueUsd: value.amountUsd, netValueUsd: null, ratio: null, reason: "AUTHORITATIVE_COST_AND_VALUE_REQUIRED" };
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("FINOPS_INVALID_COST");
  if (costUsd === 0) return { status: "KNOWN", costUsd, valueUsd: value.amountUsd, netValueUsd: value.amountUsd, ratio: null, reason: "ZERO_COST_RATIO_UNDEFINED" };
  return { status: "KNOWN", costUsd, valueUsd: value.amountUsd, netValueUsd: value.amountUsd - costUsd, ratio: value.amountUsd / costUsd, reason: "AUTHORITATIVE_INPUTS_PRESENT" };
}

export function detectTokenBurn(records: readonly TokenCostAccounting[], options: { deterministicRunnerAvailable: boolean; acceptableEvidenceJobIds?: readonly string[] } = { deterministicRunnerAvailable: false }): FinOpsFinding[] {
  const findings: FinOpsFinding[] = [];
  const acceptable = new Set(options.acceptableEvidenceJobIds || []);
  const byFingerprint = new Map<string, TokenCostAccounting[]>();
  for (const record of records) {
    const key = `${record.jobId}|${record.specialist}|${record.subsystem}|${record.businessPurpose}`;
    byFingerprint.set(key, [...(byFingerprint.get(key) || []), record]);
  }
  for (const [key, group] of byFingerprint) {
    if (group.length > 1) findings.push({ code: "DUPLICATE_EXECUTION", severity: "medium", evidence: group.map((item) => item.recordId), recommendation: `Reuse or deduplicate equivalent execution for ${key}.` });
    if (group.some((item) => item.retryCount > 0)) findings.push({ code: "RETRY_BURN", severity: "low", evidence: group.filter((item) => item.retryCount > 0).map((item) => item.recordId), recommendation: "Review bounded retries and stop repeated equivalent failures." });
    if (group.some((item) => item.evidenceQuality !== "acceptable")) findings.push({ code: "LOW_VALUE_EVIDENCE", severity: "medium", evidence: group.filter((item) => item.evidenceQuality !== "acceptable").map((item) => item.recordId), recommendation: "Do not spend additional budget without an evidence-quality decision." });
  }
  if (options.deterministicRunnerAvailable && records.some((item) => item.executionClass === "model")) findings.push({ code: "DETERMINISTIC_RUNNER_AVAILABLE", severity: "low", evidence: records.filter((item) => item.executionClass === "model").map((item) => item.recordId), recommendation: "Prefer the sufficient deterministic runner before model execution." });
  if (records.some((item) => (item.modelOrWorkerClass.toLowerCase().includes("strong") || item.modelOrWorkerClass.toLowerCase().includes("frontier")) && item.evidenceQuality === "unknown")) findings.push({ code: "STRONG_MODEL_WITHOUT_JUSTIFICATION", severity: "medium", evidence: records.filter((item) => item.evidenceQuality === "unknown").map((item) => item.recordId), recommendation: "Require a bounded complexity/evidence justification for stronger models." });
  const unresolved = records.filter((item) => item.outcome !== "completed" && !acceptable.has(item.jobId));
  if (unresolved.length > 1) findings.push({ code: "UNRESOLVED_REPEAT", severity: "high", evidence: unresolved.map((item) => item.recordId), recommendation: "Escalate repeated unresolved work instead of retrying indefinitely." });
  return findings;
}

export function canRaiseBudget(job: Pick<OperationsJob, "id" | "tokenBudget" | "financialBudgetUsd">, requested: { tokenBudget: number; financialBudgetUsd: number }, decision?: OwnerDecision | null) {
  if (requested.tokenBudget < job.tokenBudget || requested.financialBudgetUsd < job.financialBudgetUsd) return false;
  if (requested.tokenBudget === job.tokenBudget && requested.financialBudgetUsd === job.financialBudgetUsd) return true;
  return Boolean(decision && decision.decision === "approved" && decision.jobId === job.id && ["spending", "new_paid_service"].includes(decision.requestedCategory));
}

export function customerTruthOptimizationGuard(target: string) {
  const forbidden = /(candidate|selection|recommendation|budget ledger|booking|lifecycle|provider inventory|gmail|live companion)/i;
  return !forbidden.test(target);
}

export function safeFinOpsSummary(scope: unknown) {
  const finops = (scope as { finops?: Record<string, unknown> } | null)?.finops;
  if (!finops || typeof finops !== "object") return null;
  return {
    provider: typeof finops.provider === "string" ? finops.provider : "UNKNOWN",
    executionClass: typeof finops.executionClass === "string" ? finops.executionClass : "UNKNOWN",
    tokenStatus: typeof finops.tokenStatus === "string" ? finops.tokenStatus : "UNKNOWN",
    costStatus: typeof finops.costStatus === "string" ? finops.costStatus : "UNKNOWN",
    economicDecision: typeof finops.economicDecision === "string" ? finops.economicDecision : "UNKNOWN",
    valueStatus: typeof finops.valueStatus === "string" ? finops.valueStatus : "UNKNOWN"
  };
}
