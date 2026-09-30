// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { createOperationsJob, type AutonomyLevel, type OperationsEvidence, type OperationsJob, type OperationsRole, type RegisteredRunnerId } from "./opsControlPlane.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { type RevenueImpact, type RevenueImpactLevel, REVENUE_IMPACT_LEVELS, revenueImpact } from "./opsControlPlane.ts";

export const SPECIALIST_MAX_AUTHORITY: AutonomyLevel = "LEVEL_2_DIAGNOSE";
export const SPECIALIST_NETWORK_POLICY = "NONE" as const;

/**
 * Level-3 grant (owner-approved 2026-09-30): the gap auditor and the
 * executive secretary may create and advance bounded safe-repair jobs up to
 * LEVEL_3_SAFE_REPAIR. Every other specialist stays capped at
 * SPECIALIST_MAX_AUTHORITY (LEVEL_2_DIAGNOSE): they diagnose, prioritize,
 * and propose — they never repair or deploy.
 */
export const SAFE_REPAIR_MAX_AUTHORITY: AutonomyLevel = "LEVEL_3_SAFE_REPAIR";
export const LEVEL_3_SAFE_REPAIR_ROLES = ["GAP_AUDIT_QA", "EXECUTIVE_SECRETARY"] as const;
export type Level3SafeRepairRole = typeof LEVEL_3_SAFE_REPAIR_ROLES[number];

export function roleMayReachLevel3(role: string): role is Level3SafeRepairRole {
  return (LEVEL_3_SAFE_REPAIR_ROLES as readonly string[]).includes(role);
}

export type SpecialistId =
  | "GAP_AUDIT_QA_RELIABILITY"
  | "SEO"
  | "UX_PRODUCT_EXPERIENCE"
  | "SECURITY_PRIVACY"
  | "PROVIDER_TRAVEL_INTELLIGENCE"
  | "MARKETING_GROWTH"
  | "CUSTOMER_EXPERIENCE";

export function specialistMayReachLevel3(id: SpecialistId): boolean {
  return id === "GAP_AUDIT_QA_RELIABILITY";
}

/**
 * Bounded safe-repair job shape. A safe repair is small, revertible,
 * non-destructive, and evidence-gated: it may never touch migrations,
 * secrets, spending, or customer financial truth, and it may only reach
 * DEPLOYING after deterministic_check + typecheck + build evidence passes.
 */
export const SAFE_REPAIR_ALLOWED_OPERATIONS = [
  "read_approved_repository_state",
  "record_deterministic_evidence",
  "prepare_bounded_repair",
  "run_bounded_validation"
] as const;

export const SAFE_REPAIR_FORBIDDEN_OPERATIONS = [
  "code_edit",
  "commit",
  "push",
  "deploy",
  "production_mutation",
  "customer_data_access",
  "spending",
  "credential_access",
  "arbitrary_command",
  "provider_configuration_change",
  "customer_truth_change",
  // Every LEVEL_4_OWNER_APPROVAL gate stays intact inside safe repair.
  "database_migration",
  "destructive_database_operation",
  "billing_payment",
  "new_paid_service",
  "provider_commercial_agreement",
  "credentials_secrets",
  "security_sensitive",
  "major_architecture",
  "customer_financial_truth",
  "privacy_data_retention",
  "weaken_validation"
] as const;

export const SAFE_REPAIR_CONSTRAINTS = {
  maxFilesChanged: 5,
  maxLinesChanged: 200,
  mustBeRevertible: true,
  requiresValidationBeforeDeploy: true,
  noMigrations: true,
  noSecrets: true,
  noSpending: true,
  noCustomerFinancialTruth: true
} as const;

export const SAFE_REPAIR_DEPLOY_EVIDENCE: ReadonlyArray<OperationsEvidence["category"]> = [
  "deterministic_check",
  "typecheck",
  "build"
];

export function createSafeRepairJob(input: {
  role: Level3SafeRepairRole;
  initiatingSignal: string;
  objective: string;
  subsystem: string;
  allowedFiles: string[];
  estimatedLinesChanged: number;
  acceptanceCriteria: string[];
  findingId?: string;
  approvalCategory?: string | null;
  priority?: OperationsJob["priority"];
}): OperationsJob {
  if (!roleMayReachLevel3(input.role)) throw new Error("SAFE_REPAIR_ROLE_NOT_GRANTED");
  if (input.approvalCategory) throw new Error("SAFE_REPAIR_OWNER_APPROVAL_CATEGORY_FORBIDDEN");
  if (!Array.isArray(input.allowedFiles) || input.allowedFiles.length === 0) throw new Error("SAFE_REPAIR_SCOPE_EMPTY");
  if (input.allowedFiles.length > SAFE_REPAIR_CONSTRAINTS.maxFilesChanged) throw new Error("SAFE_REPAIR_TOO_MANY_FILES");
  if (!Number.isFinite(input.estimatedLinesChanged) || input.estimatedLinesChanged <= 0) throw new Error("SAFE_REPAIR_LINES_ESTIMATE_REQUIRED");
  if (input.estimatedLinesChanged > SAFE_REPAIR_CONSTRAINTS.maxLinesChanged) throw new Error("SAFE_REPAIR_TOO_MANY_LINES");
  if (!Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.length === 0) throw new Error("SAFE_REPAIR_ACCEPTANCE_CRITERIA_REQUIRED");
  return createOperationsJob({
    role: input.role,
    initiatingSignal: input.initiatingSignal,
    objective: input.objective,
    subsystem: input.subsystem,
    priority: input.priority || "high",
    risk: "medium",
    authorityLevel: "LEVEL_3_SAFE_REPAIR",
    scope: {
      safeRepair: true,
      revertible: SAFE_REPAIR_CONSTRAINTS.mustBeRevertible,
      findingId: input.findingId || null,
      estimatedLinesChanged: input.estimatedLinesChanged,
      approvalCategory: null
    },
    allowedOperations: [...SAFE_REPAIR_ALLOWED_OPERATIONS],
    allowedFiles: [...input.allowedFiles],
    forbiddenOperations: [...SAFE_REPAIR_FORBIDDEN_OPERATIONS],
    acceptanceCriteria: [...input.acceptanceCriteria],
    evidenceRequirements: [...SAFE_REPAIR_DEPLOY_EVIDENCE],
    tokenBudget: 0,
    financialBudgetUsd: 0,
    maxAttempts: 1,
    ownerApprovalRequired: false,
    runnerId: input.role === "GAP_AUDIT_QA" ? "phase2.gap-audit.safe-repair" : "phase8.secretary.safe-repair"
  });
}

/**
 * Validation-before-deploy gate: a safe-repair job may only transition to
 * DEPLOYING when it is a granted LEVEL_3 job with no owner-approval
 * requirement and passing deterministic_check + typecheck + build evidence.
 */
export function assertSafeRepairDeployReady(job: OperationsJob, evidence: OperationsEvidence[]): void {
  if (job.authorityLevel !== "LEVEL_3_SAFE_REPAIR") throw new Error("SAFE_REPAIR_AUTHORITY_REQUIRED");
  if (!roleMayReachLevel3(job.role)) throw new Error("SAFE_REPAIR_ROLE_NOT_GRANTED");
  if (job.ownerApprovalRequired) throw new Error("SAFE_REPAIR_OWNER_APPROVAL_REQUIRED");
  if (job.scope?.safeRepair !== true) throw new Error("SAFE_REPAIR_SCOPE_FLAG_MISSING");
  const passed = new Set(
    evidence
      .filter((item) => item.jobId === job.id && item.result === "pass")
      .map((item) => item.category)
  );
  for (const required of SAFE_REPAIR_DEPLOY_EVIDENCE) {
    if (!passed.has(required)) throw new Error(`SAFE_REPAIR_EVIDENCE_MISSING:${required}`);
  }
}

export type SpecialistSignalSource = "deterministic_check" | "operational_incident" | "failed_job" | "schedule";

export type SpecialistProfile = {
  id: SpecialistId;
  role: OperationsRole;
  supportedSignalTypes: readonly string[];
  supportedSubsystems: readonly string[];
  maxAuthority: AutonomyLevel;
  runners: Readonly<Partial<Record<"LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE" | "LEVEL_3_SAFE_REPAIR", RegisteredRunnerId>>>;
  permittedEvidence: readonly OperationsEvidence["category"][];
  sensitiveDataRestrictions: readonly string[];
  network: typeof SPECIALIST_NETWORK_POLICY;
  tokenBudget: number;
  financialBudgetUsd: number;
  maxAttempts: number;
  cooldownSeconds: number;
  diagnosticCapabilities: readonly string[];
  escalationCategories: readonly string[];
  /**
   * Money mission: the specialist's standing objective tied to the owner's
   * goals — more traffic without paying for ads, more app trials, less
   * expense, more income. Every finding it produces is scored by revenue
   * impact; the secretary's briefings and the gap auditor's repair queue
   * lead with money first.
   */
  moneyMission: string;
};

const COMMON_OPERATIONS = ["read_approved_repository_state", "record_deterministic_evidence", "prepare_bounded_diagnosis"] as const;
const COMMON_FORBIDDEN = [
  "code_edit", "commit", "push", "deploy", "production_mutation", "customer_data_access",
  "spending", "credential_access", "arbitrary_command", "provider_configuration_change", "customer_truth_change"
] as const;
const COMMON_RESTRICTIONS = [
  "no_production_secrets", "no_customer_pii", "no_raw_gmail", "no_precise_location", "no_payment_data", "no_network"
] as const;

function profile(input: Omit<SpecialistProfile, "permittedEvidence" | "sensitiveDataRestrictions" | "network" | "tokenBudget" | "financialBudgetUsd" | "maxAttempts" | "cooldownSeconds">): SpecialistProfile {
  if (!input.moneyMission || !input.moneyMission.trim()) throw new Error("SPECIALIST_MONEY_MISSION_REQUIRED");
  if (input.moneyMission.length > 280) throw new Error("SPECIALIST_MONEY_MISSION_TOO_LONG");
  return {
    ...input,
    permittedEvidence: ["deterministic_check", "test", "typecheck", "build", "safe_production_health", "external_config_blocker"],
    sensitiveDataRestrictions: COMMON_RESTRICTIONS,
    network: SPECIALIST_NETWORK_POLICY,
    tokenBudget: 0,
    financialBudgetUsd: 0,
    maxAttempts: 1,
    cooldownSeconds: 300
  };
}

export const SPECIALIST_PROFILES: Readonly<Record<SpecialistId, SpecialistProfile>> = {
  GAP_AUDIT_QA_RELIABILITY: profile({
    id: "GAP_AUDIT_QA_RELIABILITY", role: "GAP_AUDIT_QA",
    supportedSignalTypes: ["gap", "qa", "reliability", "deterministic_check", "failed_job"],
    supportedSubsystems: ["operations_control_plane", "operations_admin", "operations_evidence", "customer_route_boundary", "reliability"],
    maxAuthority: SAFE_REPAIR_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase2.gap-audit.observe", LEVEL_2_DIAGNOSE: "phase2.gap-audit.diagnose", LEVEL_3_SAFE_REPAIR: "phase2.gap-audit.safe-repair" },
    diagnosticCapabilities: ["deterministic_regression", "build_typecheck", "safe_runtime_contracts"],
    escalationCategories: ["security_sensitive", "major_architecture", "weaken_validation"],
    moneyMission: "Correlate findings across all specialists, dedupe them, and produce one money-first repair queue — highest revenue impact first — then safely repair what is bounded and revertible."
  }),
  SEO: profile({
    id: "SEO", role: "SEO",
    supportedSignalTypes: ["seo", "crawlability", "indexability", "metadata", "sitemap", "robots", "structured_data", "public_route"],
    supportedSubsystems: ["seo", "public_routes", "metadata", "sitemap", "robots", "structured_data"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.seo.observe", LEVEL_2_DIAGNOSE: "phase5.seo.diagnose" },
    diagnosticCapabilities: ["public_route_checks", "metadata_consistency", "sitemap_robots_contract"],
    escalationCategories: ["major_architecture", "security_sensitive"],
    moneyMission: "Grow organic traffic without paid ads: find and propose fixes for missing meta/OG tags, sitemap gaps, thin pages, weak internal linking, and slow public routes — every finding carries a traffic-impact score."
  }),
  UX_PRODUCT_EXPERIENCE: profile({
    id: "UX_PRODUCT_EXPERIENCE", role: "UX",
    supportedSignalTypes: ["ux", "accessibility", "navigation", "interaction", "loading_state", "mobile_layout", "public_route"],
    supportedSubsystems: ["ux", "product_experience", "public_routes", "accessibility", "navigation"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.ux.observe", LEVEL_2_DIAGNOSE: "phase5.ux.diagnose" },
    diagnosticCapabilities: ["deterministic_accessibility", "interaction_contracts", "responsive_surface_checks"],
    escalationCategories: ["major_architecture", "security_sensitive"],
    moneyMission: "Remove trial-conversion friction on /plan and trip pages — dead buttons, confusing copy, dull itinerary presentation — and rank every proposal by conversion impact."
  }),
  SECURITY_PRIVACY: profile({
    id: "SECURITY_PRIVACY", role: "SECURITY_PRIVACY",
    supportedSignalTypes: ["security", "privacy", "authorization", "secret_handling", "security_header", "pii_logging", "dependency_security"],
    supportedSubsystems: ["security", "privacy", "authorization", "operations_security"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.security.observe", LEVEL_2_DIAGNOSE: "phase5.security.diagnose" },
    diagnosticCapabilities: ["authorization_checks", "privacy_boundary_checks", "safe_dependency_signals"],
    escalationCategories: ["security_sensitive", "credentials_secrets", "privacy_data_retention", "major_architecture"],
    moneyMission: "A breach kills trust and trust is revenue: keep finding authorization, secret-handling, and privacy-boundary gaps, and rank every finding by business risk — highest first."
  }),
  PROVIDER_TRAVEL_INTELLIGENCE: profile({
    id: "PROVIDER_TRAVEL_INTELLIGENCE", role: "PROVIDER_INTELLIGENCE",
    supportedSignalTypes: ["provider", "travel_provider", "provider_contract", "provider_health", "inventory_provenance", "commercial_routing"],
    supportedSubsystems: ["provider", "travel_intelligence", "inventory_truth", "commercial_routing"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.provider.observe", LEVEL_2_DIAGNOSE: "phase5.provider.diagnose" },
    diagnosticCapabilities: ["adapter_contracts", "provenance_checks", "degradation_evidence"],
    escalationCategories: ["provider_commercial_agreement", "security_sensitive", "major_architecture"],
    moneyMission: "Protect and grow affiliate and booking revenue: verify affiliate links are present, correctly tagged, and honestly labeled — never invent availability, prices, or products — and propose conversion improvements."
  }),
  MARKETING_GROWTH: profile({
    id: "MARKETING_GROWTH", role: "GROWTH_MARKETING",
    supportedSignalTypes: ["marketing", "growth", "campaign", "attribution", "affiliate", "acquisition", "conversion"],
    supportedSubsystems: ["marketing", "growth", "campaigns", "affiliate"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.marketing.observe", LEVEL_2_DIAGNOSE: "phase5.marketing.diagnose" },
    diagnosticCapabilities: ["public_funnel_checks", "attribution_contracts", "affiliate_integrity"],
    escalationCategories: ["spending", "provider_commercial_agreement", "major_architecture"],
    moneyMission: "Turn autopost output into app trials: audit caption hooks, CTAs, hashtags, and link discipline in the social automation engine; propose improvements that drive clicks to /plan — never invent metrics."
  }),
  CUSTOMER_EXPERIENCE: profile({
    id: "CUSTOMER_EXPERIENCE", role: "CUSTOMER_EXPERIENCE",
    supportedSignalTypes: ["customer_experience", "cx", "notification", "booking_handoff", "support", "itinerary_workflow"],
    supportedSubsystems: ["customer_experience", "notifications", "booking_handoff", "support", "itinerary_workflow"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.cx.observe", LEVEL_2_DIAGNOSE: "phase5.cx.diagnose" },
    diagnosticCapabilities: ["workflow_contracts", "notification_journey_checks", "support_route_checks"],
    escalationCategories: ["customer_financial_truth", "security_sensitive", "major_architecture"],
    moneyMission: "Protect retention revenue: detect notification-spam risks, confusing traveler states, and broken empty states early, and propose fixes before they cost travelers."
  })
};

export const SPECIALIST_COMMON_OPERATIONS = COMMON_OPERATIONS;
export const SPECIALIST_COMMON_FORBIDDEN_OPERATIONS = COMMON_FORBIDDEN;

function matches(profileToCheck: SpecialistProfile, code: string, subsystem: string) {
  const haystack = `${code} ${subsystem}`.toLowerCase();
  return profileToCheck.supportedSignalTypes.some((value) => haystack.includes(value.toLowerCase())) || profileToCheck.supportedSubsystems.some((value) => haystack.includes(value.toLowerCase()));
}

export function routeSpecialistSignal(input: { code: string; subsystem: string; source?: SpecialistSignalSource }): SpecialistId | null {
  const matchesFound = Object.values(SPECIALIST_PROFILES).filter((candidate) => matches(candidate, input.code, input.subsystem));
  if (matchesFound.length !== 1) return null;
  return matchesFound[0].id;
}

export function specialistSupportsSignal(specialist: SpecialistId, input: { code: string; subsystem: string }) {
  return matches(SPECIALIST_PROFILES[specialist], input.code, input.subsystem);
}

export function specialistSupportsSubsystem(specialist: SpecialistId, subsystem: string) {
  return SPECIALIST_PROFILES[specialist].supportedSubsystems.includes(subsystem);
}

export function specialistSupportsRunner(specialist: SpecialistId, authority: "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE" | "LEVEL_3_SAFE_REPAIR", runnerId: string | null) {
  return runnerId !== null && SPECIALIST_PROFILES[specialist].runners[authority] === runnerId;
}

export function specialistPolicySummary(specialist: SpecialistId) {
  const candidate = SPECIALIST_PROFILES[specialist];
  return {
    id: candidate.id,
    role: candidate.role,
    maxAuthority: candidate.maxAuthority,
    network: candidate.network,
    tokenBudget: candidate.tokenBudget,
    financialBudgetUsd: candidate.financialBudgetUsd,
    maxAttempts: candidate.maxAttempts,
    supportedSubsystems: [...candidate.supportedSubsystems],
    moneyMission: candidate.moneyMission
  };
}

export { REVENUE_IMPACT_LEVELS, revenueImpact };
export type { RevenueImpact, RevenueImpactLevel };
