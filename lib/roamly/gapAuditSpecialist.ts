// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { OperationsScheduler, type OperationsEvidence, type OperationsJob, type OperationsRisk, type RevenueImpact, REVENUE_IMPACT_RANK, createEvidence, createOperationsJob, duplicateJobKey, assertAuthorityUnchanged, revenueImpact } from "./opsControlPlane.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { createSafeRepairJob, SAFE_REPAIR_CONSTRAINTS } from "./specialistOrganization.ts";

export type GapAuditCheckId =
  | "control_plane_dispatch_contract"
  | "operations_admin_boundary"
  | "customer_route_isolation"
  | "evidence_sanitization";

export type GapAuditCheckResult = {
  checkId: GapAuditCheckId;
  ok: boolean;
  subsystem: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  summary: string;
  source: string;
  affectedFiles: string[];
  reproducible: boolean;
  customerImpact: string | null;
};

export type GapAuditFinding = {
  findingId: string;
  checkId: GapAuditCheckId;
  confirmed: boolean;
  severity: GapAuditCheckResult["severity"];
  risk: OperationsRisk;
  subsystem: string;
  summary: string;
  evidenceSummary: string;
  reproducible: boolean;
  affectedFiles: string[];
  customerImpact: string | null;
  revenueImpact: RevenueImpact;
  recommendedNextAction: string;
  acceptanceCriteria: string[];
  approvalCategory: string | null;
};

export type GapAuditSourceSnapshot = {
  controlPlane: string;
  operationsApi: string;
  customerRoute: string;
};

const CHECK_SOURCES: Record<GapAuditCheckId, string> = {
  control_plane_dispatch_contract: "lib/roamly/opsControlPlane.ts",
  operations_admin_boundary: "app/api/admin/roamly/operations/route.ts",
  customer_route_isolation: "app/api/roamly/market-search/route.ts",
  evidence_sanitization: "lib/roamly/opsControlPlane.ts"
};

function result(checkId: GapAuditCheckId, ok: boolean, subsystem: string, severity: GapAuditCheckResult["severity"], summary: string, affectedFiles: string[], customerImpact: string | null = null): GapAuditCheckResult {
  return { checkId, ok, subsystem, severity, summary, source: CHECK_SOURCES[checkId], affectedFiles, reproducible: true, customerImpact };
}

export function runGapAuditChecks(snapshot: GapAuditSourceSnapshot): GapAuditCheckResult[] {
  return [
    result(
      "control_plane_dispatch_contract",
      snapshot.controlPlane.includes('allowedAuthorityLevels') && snapshot.controlPlane.includes('isRegisteredRunner(job.runnerId)') && snapshot.controlPlane.includes('"LEVEL_1_OBSERVE"'),
      "operations_control_plane",
      "high",
      "Dispatch must enforce explicit authority and registered-runner gates.",
      ["lib/roamly/opsControlPlane.ts"]
    ),
    result(
      "operations_admin_boundary",
      snapshot.operationsApi.includes("requireRoamlyAdmin") && !/export async function (POST|PUT|PATCH|DELETE)/.test(snapshot.operationsApi),
      "operations_admin",
      "high",
      "Operations data must remain admin-only and read-only.",
      ["app/api/admin/roamly/operations/route.ts"]
    ),
    result(
      "customer_route_isolation",
      !snapshot.customerRoute.includes("roamly_ops_") && !snapshot.customerRoute.includes("opsControlPlane"),
      "customer_route_boundary",
      "critical",
      "Customer travel routes must not depend on the operations control plane.",
      ["app/api/roamly/market-search/route.ts"],
      "A customer route could expose or depend on internal operations state."
    ),
    result(
      "evidence_sanitization",
      snapshot.controlPlane.includes("SENSITIVE_EVIDENCE_KEY_REJECTED") && snapshot.controlPlane.includes("EVIDENCE_VALUE_NOT_SCALAR"),
      "operations_evidence",
      "high",
      "Evidence metadata must reject sensitive keys and non-scalar payloads.",
      ["lib/roamly/opsControlPlane.ts"]
    )
  ];
}

function riskForSeverity(severity: GapAuditCheckResult["severity"]): OperationsRisk {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

const CHECK_REVENUE_IMPACT: Record<GapAuditCheckId, RevenueImpact> = {
  control_plane_dispatch_contract: revenueImpact("medium", "A broken dispatch gate stalls every specialist job behind all revenue fixes."),
  operations_admin_boundary: revenueImpact("medium", "Leaked ops data erodes trust in the automation that protects revenue."),
  customer_route_isolation: revenueImpact("high", "Customer routes touching ops internals risk outages that directly kill bookings."),
  evidence_sanitization: revenueImpact("low", "Weak evidence hygiene slows audits but does not directly touch revenue.")
};

export function findingFromCheck(check: GapAuditCheckResult): GapAuditFinding | null {
  if (check.ok) return null;
  return {
    findingId: `GAP-${check.checkId}`,
    checkId: check.checkId,
    confirmed: true,
    severity: check.severity,
    risk: riskForSeverity(check.severity),
    subsystem: check.subsystem,
    summary: check.summary,
    evidenceSummary: `Deterministic check ${check.checkId} failed against ${check.source}.`,
    reproducible: check.reproducible,
    affectedFiles: check.affectedFiles,
    customerImpact: check.customerImpact,
    revenueImpact: CHECK_REVENUE_IMPACT[check.checkId],
    recommendedNextAction: "Review the bounded affected files and prepare a separately approved repair plan.",
    acceptanceCriteria: ["Re-run the failed deterministic check with a passing result.", "Confirm no customer travel truth or sensitive evidence boundary changed."],
    approvalCategory: null
  };
}

const RISK_RANK: Record<OperationsRisk, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Money-first prioritization: dedupe findings across specialists by
 * findingId, then order by revenue impact (highest first), breaking ties by
 * risk. This is the single repair queue the owner sees.
 */
export function prioritizeMoneyFirst(findings: GapAuditFinding[]): GapAuditFinding[] {
  const seen = new Set<string>();
  return findings
    .filter((finding) => {
      if (seen.has(finding.findingId)) return false;
      seen.add(finding.findingId);
      return true;
    })
    .sort(
      (a, b) =>
        REVENUE_IMPACT_RANK[b.revenueImpact.level] - REVENUE_IMPACT_RANK[a.revenueImpact.level] ||
        RISK_RANK[b.risk] - RISK_RANK[a.risk]
    );
}

/**
 * Build the money-first safe-repair queue: prioritized findings become
 * bounded LEVEL_3 safe-repair jobs when a caller-supplied line-change
 * estimate fits the safe-repair constraints. Findings without a usable
 * estimate (or too broad to be bounded) are returned in needsEstimate —
 * never guessed, never forced into a repair.
 */
export function buildMoneyFirstRepairQueue(
  findings: GapAuditFinding[],
  linesChangedEstimates: Record<string, number>
): { queue: OperationsJob[]; needsEstimate: GapAuditFinding[] } {
  const queue: OperationsJob[] = [];
  const needsEstimate: GapAuditFinding[] = [];
  for (const finding of prioritizeMoneyFirst(findings)) {
    const estimatedLinesChanged = linesChangedEstimates[finding.findingId];
    try {
      if (!Number.isFinite(estimatedLinesChanged)) throw new Error("SAFE_REPAIR_LINES_ESTIMATE_REQUIRED");
      if (finding.affectedFiles.length > SAFE_REPAIR_CONSTRAINTS.maxFilesChanged) throw new Error("SAFE_REPAIR_TOO_MANY_FILES");
      queue.push(
        createSafeRepairJob({
          role: "GAP_AUDIT_QA",
          initiatingSignal: `deterministic_check:${finding.checkId}`,
          objective: `Safe repair: ${finding.summary}`,
          subsystem: finding.subsystem,
          allowedFiles: finding.affectedFiles,
          estimatedLinesChanged,
          acceptanceCriteria: finding.acceptanceCriteria,
          findingId: finding.findingId,
          approvalCategory: finding.approvalCategory
        })
      );
    } catch {
      needsEstimate.push(finding);
    }
  }
  return { queue, needsEstimate };
}

export function observeGapAudit(snapshot: GapAuditSourceSnapshot, scheduler = new OperationsScheduler()) {
  const checks = runGapAuditChecks(snapshot);
  const findings = checks.map(findingFromCheck).filter((finding): finding is GapAuditFinding => Boolean(finding));
  const jobs: OperationsJob[] = [];
  const evidence: OperationsEvidence[] = [];
  for (const finding of findings) {
    const job = createOperationsJob({
      role: "GAP_AUDIT_QA",
      initiatingSignal: `deterministic_check:${finding.checkId}`,
      objective: finding.summary,
      subsystem: finding.subsystem,
      priority: finding.severity === "critical" ? "critical" : finding.severity === "high" ? "high" : "normal",
      risk: finding.risk,
      authorityLevel: "LEVEL_1_OBSERVE",
      scope: { specialist: "GAP_AUDIT_QA", finding },
      allowedOperations: ["read_approved_repository_state", "record_deterministic_evidence"],
      allowedFiles: finding.affectedFiles,
      forbiddenOperations: ["production_mutation", "customer_data_access", "arbitrary_command", "code_edit", "commit", "deploy", "spending"],
      acceptanceCriteria: finding.acceptanceCriteria,
      evidenceRequirements: ["deterministic_check"],
      runnerId: "phase2.gap-audit.observe",
      dedupeKey: duplicateJobKey({ role: "GAP_AUDIT_QA", subsystem: finding.subsystem, objective: finding.findingId, signal: finding.checkId })
    });
    if (scheduler.enqueue(job)) {
      jobs.push(job);
      evidence.push(createEvidence({ jobId: job.id, category: "deterministic_check", source: finding.checkId, result: "fail", summary: finding.evidenceSummary, metadata: { findingId: finding.findingId, reproducible: finding.reproducible, severity: finding.severity } }));
    }
  }
  return { checks, findings, jobs, evidence, scheduler };
}

export function diagnoseGapAuditFinding(finding: GapAuditFinding, job: OperationsJob) {
  if (job.role !== "GAP_AUDIT_QA" || job.authorityLevel !== "LEVEL_2_DIAGNOSE") throw new Error("GAP_AUDIT_DIAGNOSIS_AUTHORITY_REQUIRED");
  if (job.allowedOperations.some((operation) => ["code_edit", "commit", "deploy", "production_mutation", "spending"].includes(operation))) throw new Error("GAP_AUDIT_DIAGNOSIS_SCOPE_INVALID");
  assertAuthorityUnchanged(job, { ...job, authorityLevel: "LEVEL_2_DIAGNOSE" });
  return {
    confirmed: finding.confirmed,
    diagnosis: `Deterministic evidence confirms ${finding.findingId} in ${finding.subsystem}; no repair was performed.`,
    recommendedNextAction: finding.recommendedNextAction,
    acceptanceCriteria: finding.acceptanceCriteria,
    ownerApprovalRequired: Boolean(finding.approvalCategory),
    authorityLevel: "LEVEL_2_DIAGNOSE" as const
  };
}

export function safeFindingSummary(scope: unknown) {
  const finding = (scope as { finding?: Partial<GapAuditFinding> } | null)?.finding;
  if (!finding || typeof finding !== "object") return null;
  return {
    findingId: typeof finding.findingId === "string" ? finding.findingId : "Unknown",
    severity: typeof finding.severity === "string" ? finding.severity : "Unknown",
    confirmed: finding.confirmed === true,
    summary: typeof finding.summary === "string" ? finding.summary.slice(0, 240) : "No summary",
    revenueImpact: finding.revenueImpact && typeof finding.revenueImpact === "object" && typeof finding.revenueImpact.level === "string" ? finding.revenueImpact.level : "Unknown",
    revenueRationale: finding.revenueImpact && typeof finding.revenueImpact === "object" && typeof finding.revenueImpact.rationale === "string" ? finding.revenueImpact.rationale.slice(0, 140) : null,
    recommendedNextAction: typeof finding.recommendedNextAction === "string" ? finding.recommendedNextAction.slice(0, 240) : "No recommendation"
  };
}
