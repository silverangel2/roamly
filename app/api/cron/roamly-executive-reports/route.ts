import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { buildExecutiveReport, REPORT_PERIODS, type ReportPeriod } from "@/lib/roamly/executiveSecretary";
import { listOperationsJobs, persistExecutiveReport } from "@/lib/roamly/opsStore";

export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized executive report endpoint." }, { status: 401 });
}

function configuredSecret() {
  return (process.env.CRON_SECRET || "").trim();
}

function requestedReportType(request: NextRequest) {
  const queryType = new URL(request.url).searchParams.get("reportType")?.trim() || "";
  const headerType = request.headers.get("x-roamly-report-type")?.trim() || "";
  if (queryType && headerType && queryType !== headerType) return { ok: false as const, error: "REPORT_TYPE_MISMATCH" };
  const reportType = queryType || headerType;
  if (!REPORT_PERIODS.includes(reportType as ReportPeriod)) return { ok: false as const, error: "REPORT_TYPE_NOT_REGISTERED" };
  return { ok: true as const, reportType: reportType as ReportPeriod };
}

export async function GET(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "Executive report secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return unauthorized();
  const requested = requestedReportType(request);
  if (!requested.ok) return NextResponse.json({ ok: false, error: requested.error }, { status: 400 });

  const jobsResult = await listOperationsJobs(undefined, 100);
  if (!jobsResult.ok) return NextResponse.json({ ok: false, error: jobsResult.error }, { status: 503 });
  const report = buildExecutiveReport({ period: requested.reportType, jobs: jobsResult.jobs });
  const stored = await persistExecutiveReport(report);
  if (!stored.ok) return NextResponse.json({ ok: false, error: stored.error }, { status: 503 });
  return NextResponse.json({ ok: true, reportId: report.reportId, reportType: report.reportType, period: report.period, reused: stored.reused, tokenBudget: 0, financialBudgetUsd: 0 });
}
