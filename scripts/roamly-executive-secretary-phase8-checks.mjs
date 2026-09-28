import assert from "node:assert/strict";
import { buildExecutiveRecord, classifyExecutiveJob, executiveCanPerform, reportPeriodBounds, safeExecutiveSummary, suppressExecutiveNoise } from "../lib/roamly/executiveSecretary.ts";

const at = new Date("2026-09-28T12:00:00.000Z");
const weekly = reportPeriodBounds("weekly", at);
assert.equal(weekly.start, "2026-09-28T00:00:00.000Z");
assert.equal(reportPeriodBounds("monthly", at).start, "2026-09-01T00:00:00.000Z");
assert.equal(reportPeriodBounds("quarterly", at).start, "2026-07-01T00:00:00.000Z");
assert.equal(reportPeriodBounds("year_end", at).start, "2026-01-01T00:00:00.000Z");
const jobs = [
  { id: "job-healthy", role: "SEO", status: "COMPLETED", risk: "low", priority: "normal", subsystem: "seo", objective: "Healthy check", created_at: "2026-09-28T09:00:00.000Z", updated_at: "2026-09-28T09:01:00.000Z", scope_json: {} },
  { id: "job-watch", role: "GAP_AUDIT_QA", status: "BLOCKED", risk: "medium", priority: "normal", subsystem: "reliability", objective: "Bounded issue", created_at: "2026-09-28T10:00:00.000Z", updated_at: "2026-09-28T10:01:00.000Z", scope_json: {} },
  { id: "job-owner", role: "CFO_FINOPS", status: "AWAITING_APPROVAL", risk: "high", priority: "high", subsystem: "operations_control_plane", owner_approval_required: true, created_at: "2026-09-28T11:00:00.000Z", scope_json: { approvalCategory: "spending" } }
];
assert.equal(classifyExecutiveJob(jobs[0]), "ROUTINE");
assert.equal(classifyExecutiveJob(jobs[1]), "WATCH");
assert.equal(classifyExecutiveJob(jobs[2]), "URGENT_OWNER_DECISION");
const record = buildExecutiveRecord({ period: "weekly", at, jobs, decisions: [], finopsRecords: [{ inputTokens: null, outputTokens: null, financialCostUsd: null, valueStatus: "UNKNOWN" }] });
assert.equal(record.counts.jobsConsidered, 3);
assert.equal(record.counts.ownerDecisionsRequired, 1);
assert.equal(record.priorityCounts.ROUTINE, 1);
assert.equal(record.priorityCounts.WATCH, 1);
assert.equal(record.priorityCounts.URGENT_OWNER_DECISION, 1);
assert.equal(record.finops.unknownTokenRecords, 1);
assert.equal(record.finops.unknownCostRecords, 1);
assert.equal(record.finops.confirmedRevenue, "UNKNOWN");
assert.equal(record.issues.length, 0, "empty findings do not fabricate issues");
assert.equal(executiveCanPerform("summarize sanitized evidence"), true);
assert.equal(executiveCanPerform("dispatch a repair job"), false);
assert.equal(executiveCanPerform("raise financial budget"), false);
assert.equal(executiveCanPerform("grant Level 3"), false);
const compact = suppressExecutiveNoise([record]);
assert.equal(compact.routineJobs, 1);
assert.equal(compact.ownerDecisionsRequired, 1);
const safe = safeExecutiveSummary(record);
assert.equal(safe.finops.unknownCostRecords, 1);
assert.equal(JSON.stringify(safe).includes("Healthy check"), false, "executive summary does not copy raw job text");
console.log("Roamly Phase 8 Executive Secretary checks passed");
