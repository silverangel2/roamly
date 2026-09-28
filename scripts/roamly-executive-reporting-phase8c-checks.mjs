import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXECUTIVE_REPORT_SCHEDULES,
  buildExecutiveReport,
  completedReportPeriodBounds,
  dedupeExecutiveReports,
  executiveCanPerform,
  executiveReportIdentity,
  executiveReportPersistenceRow,
  safeExecutiveReport
} from "../lib/roamly/executiveSecretary.ts";

const at = new Date("2026-09-28T12:00:00.000Z");
assert.deepEqual(EXECUTIVE_REPORT_SCHEDULES.map((item) => [item.period, item.cadence]), [
  ["weekly", "17 7 * * 1"],
  ["monthly", "17 8 1 * *"],
  ["quarterly", "17 9 1 1,4,7,10 *"],
  ["year_end", "17 10 1 1 *"]
]);
assert.equal(EXECUTIVE_REPORT_SCHEDULES.every((item) => item.enabled === false), true, "Phase 8C schedules remain disabled");

assert.deepEqual(completedReportPeriodBounds("weekly", at), { kind: "weekly", start: "2026-09-21T00:00:00.000Z", end: "2026-09-28T00:00:00.000Z" });
assert.deepEqual(completedReportPeriodBounds("monthly", at), { kind: "monthly", start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" });
assert.deepEqual(completedReportPeriodBounds("quarterly", at), { kind: "quarterly", start: "2026-04-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" });
assert.deepEqual(completedReportPeriodBounds("year_end", at), { kind: "year_end", start: "2025-01-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" });
assert.deepEqual(completedReportPeriodBounds("monthly", new Date("2024-03-01T12:00:00.000Z")), { kind: "monthly", start: "2024-02-01T00:00:00.000Z", end: "2024-03-01T00:00:00.000Z" });
assert.deepEqual(completedReportPeriodBounds("quarterly", new Date("2027-01-01T12:00:00.000Z")), { kind: "quarterly", start: "2026-10-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
assert.deepEqual(completedReportPeriodBounds("year_end", new Date("2027-01-01T12:00:00.000Z")), { kind: "year_end", start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });

const weekly = buildExecutiveReport({ period: "weekly", at, jobs: [] });
const monthly = buildExecutiveReport({ period: "monthly", at, jobs: [] });
const quarterly = buildExecutiveReport({ period: "quarterly", at, jobs: [] });
const yearEnd = buildExecutiveReport({ period: "year_end", at, jobs: [] });
assert.equal(new Set([weekly.reportId, monthly.reportId, quarterly.reportId, yearEnd.reportId]).size, 4);
assert.equal(weekly.reportId, executiveReportIdentity("weekly", at));
assert.equal(dedupeExecutiveReports([weekly, weekly, monthly]).length, 2, "duplicate report identity is suppressed");
assert.equal(quarterly.reportId !== buildExecutiveReport({ period: "year_end", at, jobs: [] }).reportId, true, "quarterly and year-end remain distinct on overlapping dates");
assert.equal(weekly.record.counts.jobsConsidered, 0, "empty periods do not fabricate activity");
assert.equal(weekly.tokenBudget, 0);
assert.equal(weekly.financialBudgetUsd, 0);
const persistenceRow = executiveReportPersistenceRow(weekly);
assert.equal(persistenceRow.report_identity, weekly.reportId);
assert.equal(persistenceRow.generation_status, "GENERATED");
assert.equal(persistenceRow.schema_version, "phase8c2.v1");
assert.equal(Array.isArray(persistenceRow.evidence_references), true);
assert.equal(JSON.stringify(persistenceRow).includes("raw Gmail"), false);

const sensitiveJob = {
  id: "job-sensitive", role: "CUSTOMER_EXPERIENCE", status: "COMPLETED", risk: "low", priority: "normal", subsystem: "customer_experience",
  objective: "raw Gmail body should not appear", created_at: "2026-09-22T10:00:00.000Z", updated_at: "2026-09-22T10:01:00.000Z",
  scope_json: { finding: { findingId: "safe-workflow", severity: "low", confirmed: true }, rawBody: "private", latitude: 1 }
};
const safe = safeExecutiveReport(buildExecutiveReport({ period: "weekly", at, jobs: [sensitiveJob] }));
assert.equal(JSON.stringify(safe).includes("raw Gmail"), false);
assert.equal(JSON.stringify(safe).includes("private"), false);
assert.equal(JSON.stringify(safe).includes("latitude"), false);

for (const action of ["dispatch specialist", "reprioritize job", "raise budget", "spend money", "mutate customer truth", "grant Level 3"]) {
  assert.equal(executiveCanPerform(action), false, `Evan must reject ${action}`);
}
assert.equal(executiveCanPerform("aggregate sanitized evidence"), true);

const page = await readFile(new URL("../app/admin/operations/page.tsx", import.meta.url), "utf8");
const reportRoute = await readFile(new URL("../app/api/cron/roamly-executive-reports/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const migration = await readFile(new URL("../supabase/migrations/20260928000400_roamly_executive_reports_phase8c2.sql", import.meta.url), "utf8");
assert.match(page, /requireRoamlyAdmin/);
assert.match(page, /EXECUTIVE_REPORT_SCHEDULES/);
assert.match(page, /Evan executive reports/);
assert.match(reportRoute, /isCronRequestAuthorized/);
assert.match(reportRoute, /REPORT_TYPE_NOT_REGISTERED/);
assert.match(reportRoute, /REPORT_TYPE_MISMATCH/);
assert.match(reportRoute, /persistExecutiveReport/);
assert.doesNotMatch(reportRoute, /searchParams.*secret|console\.(log|warn).*secret/i);
assert.equal(vercel.crons.length, 13, "Phase 8C adds four executive report crons");
assert.deepEqual(vercel.crons.filter(({ path }) => path.includes("roamly-operations-signals")), [
  { path: "/api/cron/roamly-operations-signals", schedule: "17 3 * * *" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=seo_weekly", schedule: "17 4 * * 1" },
  { path: "/api/cron/roamly-operations-signals?scheduleId=security_weekly", schedule: "17 5 * * 0" }
]);
assert.deepEqual(vercel.crons.filter(({ path }) => path.includes("roamly-executive-reports")), [
  { path: "/api/cron/roamly-executive-reports?reportType=weekly", schedule: "17 7 * * 1" },
  { path: "/api/cron/roamly-executive-reports?reportType=monthly", schedule: "17 8 1 * *" },
  { path: "/api/cron/roamly-executive-reports?reportType=quarterly", schedule: "17 9 1 1,4,7,10 *" },
  { path: "/api/cron/roamly-executive-reports?reportType=year_end", schedule: "17 10 1 1 *" }
]);
assert.equal(vercel.crons.some(({ path }) => path.includes("ux") || path.includes("provider") || path.includes("marketing") || path.includes("customer-experience") || path.includes("finops") || path.includes("evan")), false);
assert.match(migration, /create table if not exists public\.roamly_ops_executive_reports/);
assert.match(migration, /unique \(report_identity\)/);
assert.match(migration, /unique \(report_type, period_start\)/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on public\.roamly_ops_executive_reports from public, anon, authenticated/);
assert.match(migration, /grant all on public\.roamly_ops_executive_reports to service_role/);
assert.match(migration, /generation_status in \('GENERATING','GENERATED','FAILED'\)/);
assert.equal(/insert into|copy into|delete from|drop table/i.test(migration), false, "migration must not copy or destructively remove data");

console.log("Roamly Phase 8C executive reporting checks passed");
