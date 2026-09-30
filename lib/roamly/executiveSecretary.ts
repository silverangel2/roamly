import type { OperationsRisk, OwnerApprovalCategory, RevenueImpactLevel } from "./opsControlPlane.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { REVENUE_IMPACT_RANK } from "./opsControlPlane.ts";

export const EXECUTIVE_SECRETARY_ROLE = "EXECUTIVE_SECRETARY" as const;
export const REPORT_PERIODS = ["weekly", "monthly", "quarterly", "year_end"] as const;
export type ReportPeriod = typeof REPORT_PERIODS[number];
export const EXECUTIVE_REPORT_SCHEDULES = [
  { period: "weekly", cadence: "17 7 * * 1", target: "Monday 07:17 UTC", enabled: false },
  { period: "monthly", cadence: "17 8 1 * *", target: "1st day of month 08:17 UTC", enabled: false },
  { period: "quarterly", cadence: "17 9 1 1,4,7,10 *", target: "Quarter start 09:17 UTC", enabled: false },
  { period: "year_end", cadence: "17 10 1 1 *", target: "January 1 10:17 UTC", enabled: false }
] as const;
export const EXECUTIVE_PRIORITIES = ["ROUTINE", "INFORMATIONAL", "WATCH", "OWNER_ATTENTION", "URGENT_OWNER_DECISION"] as const;
export type ExecutivePriority = typeof EXECUTIVE_PRIORITIES[number];

export type ExecutiveJobSnapshot = {
  id: string;
  role: string;
  status: string;
  risk: OperationsRisk | string;
  priority: string;
  subsystem: string;
  objective?: string | null;
  initiating_signal?: string | null;
  owner_approval_required?: boolean;
  scope_json?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

export type ExecutiveDecisionSnapshot = {
  id: string;
  job_id: string;
  requested_category: OwnerApprovalCategory | string;
  risk: OperationsRisk | string;
  decision: "approved" | "rejected" | "deferred" | string;
  evidence_ids?: string[] | null;
  decided_at?: string | null;
};

export type ExecutiveEvidenceReference = {
  jobId: string;
  evidenceIds: string[];
  source: "job" | "decision" | "finops";
};

export type ExecutiveRecord = {
  role: typeof EXECUTIVE_SECRETARY_ROLE;
  period: { kind: ReportPeriod; start: string; end: string };
  generatedAt: string;
  counts: {
    jobsConsidered: number;
    completed: number;
    failed: number;
    blocked: number;
    active: number;
    recovered: number;
    ownerDecisionsRequired: number;
    ownerDecisionsRecorded: number;
  };
  priorityCounts: Record<ExecutivePriority, number>;
  specialistActivity: Record<string, number>;
  issues: Array<{ key: string; status: "open" | "resolved"; severity: string; jobIds: string[]; evidenceReferences: string[] }>;
  /**
   * Money-first view: open issues ordered by revenue impact (highest
   * first). Briefings lead with this section so the owner sees what moves
   * revenue before anything else.
   */
  moneyFirst: Array<{
    key: string;
    status: "open" | "resolved";
    severity: string;
    revenueImpact: RevenueImpactLevel | null;
    revenueRationale: string | null;
    jobIds: string[];
  }>;
  decisionsRequired: Array<{ jobId: string; category: string; risk: string; evidenceIds: string[] }>;
  decisionsRecorded: Array<{ jobId: string; decision: string; category: string; decidedAt: string | null; evidenceIds: string[] }>;
  finops: {
    records: number;
    knownTokenRecords: number;
    unknownTokenRecords: number;
    knownCostRecords: number;
    unknownCostRecords: number;
    confirmedRevenue: "UNKNOWN" | "PRESENT";
    attributedRevenue: "UNKNOWN" | "PRESENT";
    estimatedValue: "UNKNOWN" | "PRESENT";
    costAvoided: "UNKNOWN" | "PRESENT";
  };
  nextPeriod: string[];
  evidenceReferences: ExecutiveEvidenceReference[];
};

export type ExecutiveReportArtifact = {
  reportId: string;
  reportType: ReportPeriod;
  period: ExecutiveRecord["period"];
  generatedAt: string;
  status: "GENERATED";
  tokenBudget: 0;
  financialBudgetUsd: 0;
  record: ExecutiveRecord;
};

const SENSITIVE_TEXT = /(raw|body|content|cookie|credential|email|gps|latitude|longitude|password|payment|prompt|secret|token|authorization|api[_-]?key|screenshot)/i;
const TERMINAL = new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]);

function iso(date: Date) { return date.toISOString(); }

export function reportPeriodBounds(period: ReportPeriod, at = new Date()): { kind: ReportPeriod; start: string; end: string } {
  const cursor = new Date(at);
  if (Number.isNaN(cursor.getTime())) throw new Error("EXECUTIVE_INVALID_DATE");
  const start = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
  if (period === "weekly") {
    const mondayOffset = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - mondayOffset);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    return { kind: period, start: iso(start), end: iso(end) };
  }
  if (period === "monthly") {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    start.setUTCDate(1);
    return { kind: period, start: iso(start), end: iso(end) };
  }
  if (period === "quarterly") {
    const quarterStart = Math.floor(start.getUTCMonth() / 3) * 3;
    const end = new Date(Date.UTC(start.getUTCFullYear(), quarterStart + 3, 1));
    start.setUTCMonth(quarterStart, 1);
    return { kind: period, start: iso(start), end: iso(end) };
  }
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
  start.setUTCMonth(0, 1);
  return { kind: period, start: iso(start), end: iso(end) };
}

export function completedReportPeriodBounds(period: ReportPeriod, at = new Date()) {
  const current = reportPeriodBounds(period, at);
  const end = new Date(current.start);
  const start = new Date(current.start);
  if (period === "weekly") {
    start.setUTCDate(start.getUTCDate() - 7);
  } else if (period === "monthly") {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (period === "quarterly") {
    start.setUTCMonth(start.getUTCMonth() - 3);
  } else {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  }
  return { kind: period, start: iso(start), end: iso(end) };
}

export function executiveReportIdentity(period: ReportPeriod, at = new Date()) {
  return `executive:${period}:${completedReportPeriodBounds(period, at).start}`;
}

function inPeriod(value: string | null | undefined, period: { start: string; end: string }) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(period.start) && time < Date.parse(period.end);
}

function safeKey(value: unknown) {
  return typeof value === "string" && value.length > 0 && !SENSITIVE_TEXT.test(value) ? value.slice(0, 120) : "UNKNOWN";
}

function findingFromScope(scope: unknown) {
  const finding = (scope as { finding?: Record<string, unknown> } | null)?.finding;
  if (!finding || typeof finding !== "object") return null;
  const id = typeof finding.findingId === "string" ? finding.findingId : null;
  const severity = typeof finding.severity === "string" ? finding.severity : "unknown";
  const confirmed = finding.confirmed === true;
  const impact = (finding as { revenueImpact?: unknown }).revenueImpact;
  let revenueImpact: RevenueImpactLevel | null = null;
  let revenueRationale: string | null = null;
  if (impact && typeof impact === "object") {
    const level = (impact as { level?: unknown }).level;
    const rationale = (impact as { rationale?: unknown }).rationale;
    if ((level === "high" || level === "medium" || level === "low") && typeof rationale === "string" && rationale.trim()) {
      revenueImpact = level;
      revenueRationale = rationale.slice(0, 140);
    }
  }
  return id ? { id: safeKey(id), severity, confirmed, revenueImpact, revenueRationale } : null;
}

function priorityFor(job: ExecutiveJobSnapshot, finding: ReturnType<typeof findingFromScope>): ExecutivePriority {
  if (job.owner_approval_required) return "URGENT_OWNER_DECISION";
  if (job.risk === "critical" && (job.status === "FAILED" || job.status === "BLOCKED" || finding?.confirmed)) return "URGENT_OWNER_DECISION";
  if ((job.risk === "high" || finding?.severity === "high" || finding?.severity === "critical") && !["COMPLETED", "CANCELLED"].includes(job.status)) return "OWNER_ATTENTION";
  if (job.status === "FAILED" || job.status === "BLOCKED") return "WATCH";
  if (job.status === "COMPLETED" && !finding) return "ROUTINE";
  return "INFORMATIONAL";
}

export function classifyExecutiveJob(job: ExecutiveJobSnapshot): ExecutivePriority {
  return priorityFor(job, findingFromScope(job.scope_json));
}

function emptyPriorityCounts(): Record<ExecutivePriority, number> {
  return { ROUTINE: 0, INFORMATIONAL: 0, WATCH: 0, OWNER_ATTENTION: 0, URGENT_OWNER_DECISION: 0 };
}

export function buildExecutiveRecord(input: {
  period: ReportPeriod;
  at?: Date;
  jobs: readonly ExecutiveJobSnapshot[];
  decisions?: readonly ExecutiveDecisionSnapshot[];
  finopsRecords?: readonly { jobId?: string; inputTokens?: number | null; outputTokens?: number | null; financialCostUsd?: number | null; valueStatus?: string }[];
  periodBounds?: ExecutiveRecord["period"];
}): ExecutiveRecord {
  const period = input.periodBounds || reportPeriodBounds(input.period, input.at);
  const jobs = input.jobs.filter((job) => inPeriod(job.created_at, period) || inPeriod(job.updated_at, period) || inPeriod(job.completed_at, period));
  const decisions = (input.decisions || []).filter((decision) => inPeriod(decision.decided_at, period));
  const priorityCounts = emptyPriorityCounts();
  const specialistActivity: Record<string, number> = {};
  const issuesByKey = new Map<string, { status: "open" | "resolved"; severity: string; jobIds: string[]; evidenceReferences: string[]; revenueImpact: RevenueImpactLevel | null; revenueRationale: string | null }>();
  const evidenceReferences: ExecutiveEvidenceReference[] = [];
  let recovered = 0;
  for (const job of jobs) {
    const finding = findingFromScope(job.scope_json);
    const priority = priorityFor(job, finding);
    priorityCounts[priority] += 1;
    const role = safeKey(job.role);
    specialistActivity[role] = (specialistActivity[role] || 0) + 1;
    if (job.status === "COMPLETED" && finding) {
      const key = finding.id;
      const existing = issuesByKey.get(key);
      if (existing) {
        existing.status = "resolved"; existing.jobIds.push(job.id);
        if (finding.revenueImpact && (!existing.revenueImpact || REVENUE_IMPACT_RANK[finding.revenueImpact] > REVENUE_IMPACT_RANK[existing.revenueImpact])) {
          existing.revenueImpact = finding.revenueImpact; existing.revenueRationale = finding.revenueRationale;
        }
      } else issuesByKey.set(key, { status: "resolved", severity: finding.severity, jobIds: [job.id], evidenceReferences: [], revenueImpact: finding.revenueImpact, revenueRationale: finding.revenueRationale });
      recovered += 1;
    } else if (finding && !["COMPLETED", "CANCELLED"].includes(job.status)) {
      const key = finding.id;
      const existing = issuesByKey.get(key);
      if (existing) {
        existing.status = "open"; existing.jobIds.push(job.id);
        if (finding.revenueImpact && (!existing.revenueImpact || REVENUE_IMPACT_RANK[finding.revenueImpact] > REVENUE_IMPACT_RANK[existing.revenueImpact])) {
          existing.revenueImpact = finding.revenueImpact; existing.revenueRationale = finding.revenueRationale;
        }
      } else issuesByKey.set(key, { status: "open", severity: finding.severity, jobIds: [job.id], evidenceReferences: [], revenueImpact: finding.revenueImpact, revenueRationale: finding.revenueRationale });
    }
    if (finding) evidenceReferences.push({ jobId: job.id, evidenceIds: [], source: "job" });
  }
  const decisionsRequired = jobs.filter((job) => job.owner_approval_required && !decisions.some((decision) => decision.job_id === job.id && decision.decision === "approved")).map((job) => ({ jobId: job.id, category: safeKey((job.scope_json as { approvalCategory?: unknown } | null)?.approvalCategory), risk: safeKey(job.risk), evidenceIds: [] }));
  const decisionsRecorded = decisions.map((decision) => ({ jobId: decision.job_id, decision: safeKey(decision.decision), category: safeKey(decision.requested_category), decidedAt: decision.decided_at || null, evidenceIds: Array.isArray(decision.evidence_ids) ? decision.evidence_ids.slice(0, 20).filter((id): id is string => typeof id === "string") : [] }));
  const finops = { records: input.finopsRecords?.length || 0, knownTokenRecords: (input.finopsRecords || []).filter((record) => record.inputTokens !== null && record.outputTokens !== null).length, unknownTokenRecords: (input.finopsRecords || []).filter((record) => record.inputTokens === null || record.outputTokens === null).length, knownCostRecords: (input.finopsRecords || []).filter((record) => record.financialCostUsd !== null).length, unknownCostRecords: (input.finopsRecords || []).filter((record) => record.financialCostUsd === null).length, confirmedRevenue: (input.finopsRecords || []).some((record) => record.valueStatus === "CONFIRMED_REVENUE") ? "PRESENT" as const : "UNKNOWN" as const, attributedRevenue: (input.finopsRecords || []).some((record) => record.valueStatus === "ATTRIBUTED_REVENUE") ? "PRESENT" as const : "UNKNOWN" as const, estimatedValue: (input.finopsRecords || []).some((record) => record.valueStatus === "ESTIMATED_VALUE") ? "PRESENT" as const : "UNKNOWN" as const, costAvoided: (input.finopsRecords || []).some((record) => record.valueStatus === "COST_AVOIDED") ? "PRESENT" as const : "UNKNOWN" as const };
  const unresolved = [...issuesByKey.entries()].filter(([, issue]) => issue.status === "open").map(([key, issue]) => ({ key, ...issue }));
  const moneyFirst = unresolved
    .map((issue) => ({
      key: issue.key,
      status: issue.status as "open" | "resolved",
      severity: issue.severity,
      revenueImpact: issue.revenueImpact,
      revenueRationale: issue.revenueRationale,
      jobIds: issue.jobIds
    }))
    .sort((a, b) => (b.revenueImpact ? REVENUE_IMPACT_RANK[b.revenueImpact] : 0) - (a.revenueImpact ? REVENUE_IMPACT_RANK[a.revenueImpact] : 0));
  return {
    role: EXECUTIVE_SECRETARY_ROLE,
    period,
    generatedAt: new Date(input.at || Date.now()).toISOString(),
    counts: { jobsConsidered: jobs.length, completed: jobs.filter((job) => job.status === "COMPLETED").length, failed: jobs.filter((job) => job.status === "FAILED").length, blocked: jobs.filter((job) => job.status === "BLOCKED").length, active: jobs.filter((job) => !TERMINAL.has(job.status)).length, recovered, ownerDecisionsRequired: decisionsRequired.length, ownerDecisionsRecorded: decisionsRecorded.length },
    priorityCounts,
    specialistActivity,
    issues: unresolved,
    moneyFirst,
    decisionsRequired,
    decisionsRecorded,
    finops,
    nextPeriod: [],
    evidenceReferences: evidenceReferences.slice(0, 100)
  };
}

export function buildExecutiveReport(input: Omit<Parameters<typeof buildExecutiveRecord>[0], "periodBounds">): ExecutiveReportArtifact {
  const at = input.at || new Date();
  const period = completedReportPeriodBounds(input.period, at);
  const record = buildExecutiveRecord({ ...input, periodBounds: period });
  return {
    reportId: executiveReportIdentity(input.period, at),
    reportType: input.period,
    period,
    generatedAt: at.toISOString(),
    status: "GENERATED",
    tokenBudget: 0,
    financialBudgetUsd: 0,
    record
  };
}

export function dedupeExecutiveReports(reports: readonly ExecutiveReportArtifact[]) {
  const unique = new Map<string, ExecutiveReportArtifact>();
  for (const report of reports) if (!unique.has(report.reportId)) unique.set(report.reportId, report);
  return [...unique.values()];
}

export function executiveCanPerform(action: string) {
  // Level-3 grant (owner-approved 2026-09-30): the executive secretary may
  // coordinate bounded safe repairs — prepare, validate, brief, review, and
  // record them. It still may not dispatch jobs, touch budgets or spending,
  // reach production, or grant authority.
  if (/^(prepare|validate|brief|review|record)( a| the)? bounded safe[- ]repair\b/i.test(action.trim())) return true;
  return !/(dispatch|repriorit|priority|budget|spend|production|commit|push|deploy|level.?3|customer.?truth|provider.?configuration)/i.test(action);
}

export function suppressExecutiveNoise(records: readonly ExecutiveRecord[]) {
  const latest = records[records.length - 1];
  if (!latest) return null;
  return {
    period: latest.period,
    routineJobs: latest.priorityCounts.ROUTINE,
    informationalJobs: latest.priorityCounts.INFORMATIONAL,
    watchItems: latest.priorityCounts.WATCH,
    ownerAttentionItems: latest.priorityCounts.OWNER_ATTENTION,
    urgentOwnerDecisions: latest.priorityCounts.URGENT_OWNER_DECISION,
    unresolvedIssues: latest.issues.length,
    ownerDecisionsRequired: latest.decisionsRequired.length
  };
}

export function safeExecutiveSummary(record: ExecutiveRecord) {
  return {
    period: record.period,
    generatedAt: record.generatedAt,
    moneyFirst: record.moneyFirst,
    counts: record.counts,
    priorityCounts: record.priorityCounts,
    specialistActivity: record.specialistActivity,
    finops: record.finops,
    unresolvedIssueCount: record.issues.length,
    ownerDecisionCount: record.decisionsRequired.length
  };
}

/**
 * Money-first briefing: the owner-facing summary that leads with revenue
 * impact — the top money-moving open issues first — before operational
 * counts. Deterministic, zero marginal cost, no invented metrics: every
 * entry carries only recorded severities and rationales.
 */
export function buildMoneyFirstBriefing(record: ExecutiveRecord) {
  return {
    period: record.period,
    generatedAt: record.generatedAt,
    moneyFirst: record.moneyFirst,
    topMoneyIssues: record.moneyFirst.slice(0, 5),
    openMoneyIssueCount: record.moneyFirst.length,
    ownerDecisionsRequired: record.decisionsRequired.length,
    counts: record.counts,
    priorityCounts: record.priorityCounts,
    finops: record.finops
  };
}

export function safeExecutiveReport(report: ExecutiveReportArtifact) {
  return {
    reportId: report.reportId,
    reportType: report.reportType,
    period: report.period,
    generatedAt: report.generatedAt,
    status: report.status,
    tokenBudget: report.tokenBudget,
    financialBudgetUsd: report.financialBudgetUsd,
    summary: safeExecutiveSummary(report.record)
  };
}

export function executiveReportPersistenceRow(report: ExecutiveReportArtifact) {
  const safe = safeExecutiveReport(report);
  return {
    report_identity: report.reportId,
    report_type: report.reportType,
    period_start: report.period.start,
    period_end: report.period.end,
    generation_status: "GENERATED" as const,
    payload_json: safe,
    evidence_references: report.record.evidenceReferences.slice(0, 100),
    generated_at: report.generatedAt,
    schema_version: "phase8c2.v1"
  };
}
