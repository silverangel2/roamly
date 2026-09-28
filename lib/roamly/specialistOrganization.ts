// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { type AutonomyLevel, type OperationsEvidence, type OperationsRole, type RegisteredRunnerId } from "./opsControlPlane.ts";

export const SPECIALIST_MAX_AUTHORITY: AutonomyLevel = "LEVEL_2_DIAGNOSE";
export const SPECIALIST_NETWORK_POLICY = "NONE" as const;

export type SpecialistId =
  | "GAP_AUDIT_QA_RELIABILITY"
  | "SEO"
  | "UX_PRODUCT_EXPERIENCE"
  | "SECURITY_PRIVACY"
  | "PROVIDER_TRAVEL_INTELLIGENCE"
  | "MARKETING_GROWTH"
  | "CUSTOMER_EXPERIENCE";

export type SpecialistSignalSource = "deterministic_check" | "operational_incident" | "failed_job" | "schedule";

export type SpecialistProfile = {
  id: SpecialistId;
  role: OperationsRole;
  supportedSignalTypes: readonly string[];
  supportedSubsystems: readonly string[];
  maxAuthority: AutonomyLevel;
  runners: Readonly<Partial<Record<"LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE", RegisteredRunnerId>>>;
  permittedEvidence: readonly OperationsEvidence["category"][];
  sensitiveDataRestrictions: readonly string[];
  network: typeof SPECIALIST_NETWORK_POLICY;
  tokenBudget: number;
  financialBudgetUsd: number;
  maxAttempts: number;
  cooldownSeconds: number;
  diagnosticCapabilities: readonly string[];
  escalationCategories: readonly string[];
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
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase2.gap-audit.observe", LEVEL_2_DIAGNOSE: "phase2.gap-audit.diagnose" },
    diagnosticCapabilities: ["deterministic_regression", "build_typecheck", "safe_runtime_contracts"],
    escalationCategories: ["security_sensitive", "major_architecture", "weaken_validation"]
  }),
  SEO: profile({
    id: "SEO", role: "SEO",
    supportedSignalTypes: ["seo", "crawlability", "indexability", "metadata", "sitemap", "robots", "structured_data", "public_route"],
    supportedSubsystems: ["seo", "public_routes", "metadata", "sitemap", "robots", "structured_data"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.seo.observe", LEVEL_2_DIAGNOSE: "phase5.seo.diagnose" },
    diagnosticCapabilities: ["public_route_checks", "metadata_consistency", "sitemap_robots_contract"],
    escalationCategories: ["major_architecture", "security_sensitive"]
  }),
  UX_PRODUCT_EXPERIENCE: profile({
    id: "UX_PRODUCT_EXPERIENCE", role: "UX",
    supportedSignalTypes: ["ux", "accessibility", "navigation", "interaction", "loading_state", "mobile_layout", "public_route"],
    supportedSubsystems: ["ux", "product_experience", "public_routes", "accessibility", "navigation"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.ux.observe", LEVEL_2_DIAGNOSE: "phase5.ux.diagnose" },
    diagnosticCapabilities: ["deterministic_accessibility", "interaction_contracts", "responsive_surface_checks"],
    escalationCategories: ["major_architecture", "security_sensitive"]
  }),
  SECURITY_PRIVACY: profile({
    id: "SECURITY_PRIVACY", role: "SECURITY_PRIVACY",
    supportedSignalTypes: ["security", "privacy", "authorization", "secret_handling", "security_header", "pii_logging", "dependency_security"],
    supportedSubsystems: ["security", "privacy", "authorization", "operations_security"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.security.observe", LEVEL_2_DIAGNOSE: "phase5.security.diagnose" },
    diagnosticCapabilities: ["authorization_checks", "privacy_boundary_checks", "safe_dependency_signals"],
    escalationCategories: ["security_sensitive", "credentials_secrets", "privacy_data_retention", "major_architecture"]
  }),
  PROVIDER_TRAVEL_INTELLIGENCE: profile({
    id: "PROVIDER_TRAVEL_INTELLIGENCE", role: "PROVIDER_INTELLIGENCE",
    supportedSignalTypes: ["provider", "travel_provider", "provider_contract", "provider_health", "inventory_provenance", "commercial_routing"],
    supportedSubsystems: ["provider", "travel_intelligence", "inventory_truth", "commercial_routing"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.provider.observe", LEVEL_2_DIAGNOSE: "phase5.provider.diagnose" },
    diagnosticCapabilities: ["adapter_contracts", "provenance_checks", "degradation_evidence"],
    escalationCategories: ["provider_commercial_agreement", "security_sensitive", "major_architecture"]
  }),
  MARKETING_GROWTH: profile({
    id: "MARKETING_GROWTH", role: "GROWTH_MARKETING",
    supportedSignalTypes: ["marketing", "growth", "campaign", "attribution", "affiliate", "acquisition", "conversion"],
    supportedSubsystems: ["marketing", "growth", "campaigns", "affiliate"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.marketing.observe", LEVEL_2_DIAGNOSE: "phase5.marketing.diagnose" },
    diagnosticCapabilities: ["public_funnel_checks", "attribution_contracts", "affiliate_integrity"],
    escalationCategories: ["spending", "provider_commercial_agreement", "major_architecture"]
  }),
  CUSTOMER_EXPERIENCE: profile({
    id: "CUSTOMER_EXPERIENCE", role: "CUSTOMER_EXPERIENCE",
    supportedSignalTypes: ["customer_experience", "cx", "notification", "booking_handoff", "support", "itinerary_workflow"],
    supportedSubsystems: ["customer_experience", "notifications", "booking_handoff", "support", "itinerary_workflow"],
    maxAuthority: SPECIALIST_MAX_AUTHORITY,
    runners: { LEVEL_1_OBSERVE: "phase5.cx.observe", LEVEL_2_DIAGNOSE: "phase5.cx.diagnose" },
    diagnosticCapabilities: ["workflow_contracts", "notification_journey_checks", "support_route_checks"],
    escalationCategories: ["customer_financial_truth", "security_sensitive", "major_architecture"]
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

export function specialistSupportsRunner(specialist: SpecialistId, authority: "LEVEL_1_OBSERVE" | "LEVEL_2_DIAGNOSE", runnerId: string | null) {
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
    supportedSubsystems: [...candidate.supportedSubsystems]
  };
}
