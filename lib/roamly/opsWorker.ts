// Roamly operations worker — executes the queued ops jobs the control plane
// triages but never ran (roamly_ops_jobs had 21 QUEUED rows and zero attempts
// as of 2026-10-15). Wakes on a cron tick, claims jobs under Codex's own
// dispatch policy, runs REAL read-only deterministic checks (never the canned
// stub runners), and writes attempts + evidence back to the ledger.
//
// Authority ceiling: LEVEL_1_OBSERVE + LEVEL_2_DIAGNOSE. LEVEL_3 jobs are never
// executed here — the auto-deploy gate verdict is recorded on them as evidence
// (machinery only, ships DISABLED). Nothing here deploys anything.
import {
  AUTONOMY_LEVELS,
  LEGAL_TRANSITIONS,
  createEvidence,
  createOperationsJob,
  evidenceSatisfiesCompletion,
  isRegisteredRunner,
  dispatchAllowed,
  transitionOperationsJob,
  type AutonomyLevel,
  type OperationsEvidence,
  type OperationsJob,
  type OperationsJobState
} from "@/lib/roamly/opsControlPlane";
import { createSafeRepairJob, SAFE_REPAIR_CONSTRAINTS } from "@/lib/roamly/specialistOrganization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listOperationsJobs,
  enqueueOperationsJob,
  getOperationsJob,
  rowToOperationsJob,
  updateOperationsJobStatus,
  insertOperationsAttempt,
  updateOperationsAttempt,
  insertOperationsEvidence,
  listOperationsLocks,
  deleteExpiredOperationsLocks,
  acquireOperationsLock,
  releaseOperationsLock,
  listRecentDeployEvidence
} from "@/lib/roamly/opsStore";

// ── Policy ──────────────────────────────────────────────────────────────────

export const WORKER_AUTHORITY_CEILING: AutonomyLevel[] = ["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE"];
const WORKER_GLOBAL_LIMIT = 3;
const WORKER_LOCK_LEASE_MINUTES = 10;
const WORKER_DEFAULT_LIMIT = 5;
const WORKER_PROBE_TIMEOUT_MS = 5000;

/** Kill switch: auto-deploy machinery is inert unless explicitly enabled. */
export const AUTODEPLOY_KILL_SWITCH = () => process.env.ROAMLY_OPS_AUTODEPLOY !== "on";

const PRIORITY_WEIGHT: Record<OperationsJob["priority"], number> = { critical: 4, high: 3, normal: 2, low: 1 };

function resolveBaseUrl(optionsBaseUrl?: string): string {
  const raw = (
    optionsBaseUrl ||
    process.env.ROAMLY_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://roamlyhq.com"
  ).trim();
  return raw.replace(/\/+$/, "");
}

// ── Checks ──────────────────────────────────────────────────────────────────

export type WorkerCheckResult = {
  checkId: string;
  category: "deterministic_check" | "safe_production_health";
  ok: boolean;
  summary: string;
  metadata: Record<string, string | number | boolean>;
};

export type WorkerSuiteResult = {
  runnerId: string;
  checks: WorkerCheckResult[];
  summary: string;
};

type ProbeResult = {
  status: number | null;
  ok: boolean;
  latencyMs: number;
  text: string;
  headers: Headers | null;
  error: string | null;
};

async function probe(fetchFn: typeof fetch, url: string, timeoutMs = WORKER_PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { method: "GET", signal: controller.signal });
    const latencyMs = Date.now() - started;
    let text = "";
    try {
      text = (await response.text()).slice(0, 200_000);
    } catch {
      text = "";
    }
    return { status: response.status, ok: response.status >= 200 && response.status < 400, latencyMs, text, headers: response.headers, error: null };
  } catch (error) {
    return { status: null, ok: false, latencyMs: Date.now() - started, text: "", headers: null, error: error instanceof Error ? error.name : "FETCH_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

function gapAuditPolicyCheck(runnerId: string): WorkerCheckResult {
  const levelsOk = AUTONOMY_LEVELS.length === 4;
  const queuedCanRun = (LEGAL_TRANSITIONS.QUEUED || []).includes("RUNNING");
  const runnerRegistered = isRegisteredRunner(runnerId);
  const ok = levelsOk && queuedCanRun && runnerRegistered;
  return {
    checkId: "control_plane_policy_registry",
    category: "deterministic_check",
    ok,
    summary: ok ? "Control-plane policy registry consistent." : "Control-plane policy registry drift detected.",
    metadata: { check_id: "control_plane_policy_registry", levels_ok: levelsOk, queued_runs: queuedCanRun, runner_registered: runnerRegistered }
  };
}

async function probePathCheck(fetchFn: typeof fetch, baseUrl: string, checkId: string, path: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, `${baseUrl}${path}`);
  const ok = result.status === 200;
  return {
    checkId,
    category: "deterministic_check",
    ok,
    summary: ok ? `${path} returned 200.` : `${path} probe failed (status ${result.status === null ? "none" : result.status}).`,
    metadata: {
      check_id: checkId,
      path,
      http_status: result.status === null ? -1 : result.status,
      latency_ms: result.latencyMs,
      error_class: result.error || "none"
    }
  };
}

async function seoSitemapCheck(fetchFn: typeof fetch, baseUrl: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, `${baseUrl}/sitemap.xml`);
  const hasUrlset = result.text.includes("<urlset");
  const ok = result.status === 200 && hasUrlset;
  return {
    checkId: "seo_sitemap",
    category: "deterministic_check",
    ok,
    summary: ok ? "sitemap.xml present and well-formed." : "sitemap.xml missing or invalid.",
    metadata: { check_id: "seo_sitemap", path: "/sitemap.xml", http_status: result.status === null ? -1 : result.status, has_urlset: hasUrlset }
  };
}

async function seoRobotsCheck(fetchFn: typeof fetch, baseUrl: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, `${baseUrl}/robots.txt`);
  const nonEmpty = result.text.trim().length > 0;
  const ok = result.status === 200 && nonEmpty;
  return {
    checkId: "seo_robots",
    category: "deterministic_check",
    ok,
    summary: ok ? "robots.txt present." : "robots.txt missing or empty.",
    metadata: { check_id: "seo_robots", path: "/robots.txt", http_status: result.status === null ? -1 : result.status, non_empty: nonEmpty }
  };
}

async function seoMetaHomeCheck(fetchFn: typeof fetch, baseUrl: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, baseUrl + "/");
  const lower = result.text.toLowerCase();
  const hasTitle = /<title>[^<]+<\/title>/i.test(result.text);
  const hasDescription = lower.includes('name="description"');
  const hasOgTitle = lower.includes('property="og:title"');
  const ok = result.status === 200 && hasTitle && hasDescription && hasOgTitle;
  return {
    checkId: "seo_meta_home",
    category: "deterministic_check",
    ok,
    summary: ok ? "Home page carries title, meta description, and og:title." : "Home page metadata incomplete.",
    metadata: { check_id: "seo_meta_home", path: "/", http_status: result.status === null ? -1 : result.status, has_title: hasTitle, has_description: hasDescription, has_og_title: hasOgTitle }
  };
}

async function securityHeadersCheck(fetchFn: typeof fetch, baseUrl: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, baseUrl + "/");
  const headers = result.headers;
  const hsts = Boolean(headers?.get("strict-transport-security"));
  const xcto = Boolean(headers?.get("x-content-type-options"));
  const framing = Boolean(headers?.get("x-frame-options")) || (headers?.get("content-security-policy") || "").toLowerCase().includes("frame-ancestors");
  const ok = result.status === 200 && hsts && xcto && framing;
  return {
    checkId: "security_headers_home",
    category: "safe_production_health",
    ok,
    summary: ok ? "Security headers present on the home page." : "Security headers incomplete on the home page.",
    metadata: { check_id: "security_headers_home", path: "/", http_status: result.status === null ? -1 : result.status, hsts, xcto, framing }
  };
}

async function securityCronAuthCheck(fetchFn: typeof fetch, baseUrl: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, `${baseUrl}/api/cron/roamly-operations-signals`);
  const ok = result.status === 401 || result.status === 503;
  return {
    checkId: "security_cron_rejects_anonymous",
    category: "safe_production_health",
    ok,
    summary: ok ? "Cron endpoint rejects anonymous requests." : "Cron endpoint did not reject an anonymous request.",
    metadata: { check_id: "security_cron_rejects_anonymous", path: "/api/cron/roamly-operations-signals", http_status: result.status === null ? -1 : result.status, rejected: ok }
  };
}

async function securityAdminApiAuthCheck(fetchFn: typeof fetch, baseUrl: string): Promise<WorkerCheckResult> {
  const result = await probe(fetchFn, `${baseUrl}/api/admin/roamly/operations`);
  const ok = result.status === 401 || result.status === 403;
  return {
    checkId: "security_admin_api_rejects_anonymous",
    category: "safe_production_health",
    ok,
    summary: ok ? "Admin operations API rejects anonymous requests." : "Admin operations API did not reject an anonymous request.",
    metadata: { check_id: "security_admin_api_rejects_anonymous", path: "/api/admin/roamly/operations", http_status: result.status === null ? -1 : result.status, rejected: ok }
  };
}

/** Exported for simulation/testing without Supabase. */
export async function runCheckSuite(runnerId: string, input: { baseUrl: string; fetchFn?: typeof fetch }): Promise<WorkerSuiteResult> {
  const fetchFn = input.fetchFn || fetch;
  const baseUrl = input.baseUrl;
  const checks: WorkerCheckResult[] = [];
  if (runnerId.startsWith("phase2.gap-audit")) {
    checks.push(gapAuditPolicyCheck(runnerId));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_home", "/"));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_plan", "/plan"));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_finds", "/finds"));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_login", "/login"));
  } else if (runnerId.startsWith("phase5.seo")) {
    checks.push(await seoSitemapCheck(fetchFn, baseUrl));
    checks.push(await seoRobotsCheck(fetchFn, baseUrl));
    checks.push(await seoMetaHomeCheck(fetchFn, baseUrl));
  } else if (runnerId.startsWith("phase5.security")) {
    checks.push(await securityHeadersCheck(fetchFn, baseUrl));
    checks.push(await securityCronAuthCheck(fetchFn, baseUrl));
    checks.push(await securityAdminApiAuthCheck(fetchFn, baseUrl));
  } else {
    // Generic suite for every other registered runner family (phase1/phase4,
    // phase5.ux/provider/marketing/cx): live route probes + policy registry.
    checks.push(gapAuditPolicyCheck(runnerId));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_home", "/"));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_plan", "/plan"));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_finds", "/finds"));
    checks.push(await probePathCheck(fetchFn, baseUrl, "probe_login", "/login"));
  }
  const passed = checks.filter((check) => check.ok).length;
  return { runnerId, checks, summary: `${passed}/${checks.length} checks passed for ${runnerId}` };
}

// ── Findings + bounded repair preparation ────────────────────────────────────

// Verified against the repo tree 2026-10-15: all three files exist.
// Probe 5xx and header checks deliberately have NO entry — they need human diagnosis.
const REPAIR_PLAYBOOK: Record<string, { allowedFiles: string[]; estimatedLinesChanged: number }> = {
  seo_sitemap: { allowedFiles: ["app/sitemap.ts"], estimatedLinesChanged: 40 },
  seo_robots: { allowedFiles: ["app/robots.ts"], estimatedLinesChanged: 30 },
  seo_meta_home: { allowedFiles: ["app/layout.tsx"], estimatedLinesChanged: 30 }
};

const REPAIR_ACCEPTANCE_CRITERIA = [
  "Re-run the failed deterministic check with a passing result.",
  "Confirm no customer travel truth or sensitive evidence boundary changed."
];

async function handleFailedChecks(
  job: OperationsJob,
  suite: WorkerSuiteResult,
  now: number
): Promise<{ findingsCreated: number; repairJobsCreated: number }> {
  let findingsCreated = 0;
  let repairJobsCreated = 0;
  const failed = suite.checks.filter((check) => !check.ok);
  const today = new Date(now).toISOString().slice(0, 10);

  // Gap-audit pattern (from gapAuditSpecialist.observeGapAudit): a failed
  // check becomes a tracked finding job for the owner/admin to see.
  if (suite.runnerId.startsWith("phase2.gap-audit")) {
    for (const check of failed) {
      try {
        const findingJob = createOperationsJob({
          role: "GAP_AUDIT_QA",
          initiatingSignal: `deterministic_check:${check.checkId}`,
          objective: check.summary,
          subsystem: job.subsystem,
          priority: "high",
          risk: "medium",
          authorityLevel: "LEVEL_1_OBSERVE",
          evidenceRequirements: ["deterministic_check"],
          runnerId: "phase2.gap-audit.observe",
          dedupeKey: `finding:${check.checkId}:${today}`
        });
        findingJob.status = "QUEUED";
        const stored = await enqueueOperationsJob(findingJob);
        if (stored.ok) findingsCreated++;
      } catch {
        // Malformed finding — leave it to the human; never force it.
      }
    }
  }

  // Bounded safe-repair preparation (LEVEL_3 playbook): a failed check with a
  // playbook entry becomes a queued repair job. Never executed by this worker.
  for (const check of failed) {
    const playbook = REPAIR_PLAYBOOK[check.checkId];
    if (!playbook) continue;
    try {
      const repair = createSafeRepairJob({
        role: "GAP_AUDIT_QA",
        initiatingSignal: `deterministic_check:${check.checkId}`,
        objective: `Safe repair: ${check.summary}`,
        subsystem: job.subsystem,
        allowedFiles: playbook.allowedFiles,
        estimatedLinesChanged: playbook.estimatedLinesChanged,
        acceptanceCriteria: REPAIR_ACCEPTANCE_CRITERIA,
        findingId: `OPS-${check.checkId}`,
        approvalCategory: null
      });
      const stored = await enqueueOperationsJob({ ...repair, status: "QUEUED" });
      if (stored.ok) repairJobsCreated++;
    } catch {
      // Constraint rejected (too broad / estimate invalid) — needs a human.
    }
  }
  return { findingsCreated, repairJobsCreated };
}

// ── Auto-deploy gate (machinery only — inert unless enabled) ─────────────────

export type AutoDeployGateVerdict = { eligible: boolean; reason: string };

export async function evaluateAutoDeployGate(
  job: OperationsJob,
  evidence: Array<Pick<OperationsEvidence, "result" | "category">>
): Promise<AutoDeployGateVerdict> {
  if (AUTODEPLOY_KILL_SWITCH()) return { eligible: false, reason: "AUTODEPLOY_OFF" };
  if (job.authorityLevel !== "LEVEL_3_SAFE_REPAIR") return { eligible: false, reason: "NOT_LEVEL_3" };
  if ((job.scope as { safeRepair?: boolean } | null)?.safeRepair !== true) return { eligible: false, reason: "SAFE_REPAIR_SCOPE_FLAG_MISSING" };
  const passed = new Set(evidence.filter((item) => item.result === "pass").map((item) => item.category));
  for (const required of ["deterministic_check", "typecheck", "build"] as const) {
    if (!passed.has(required)) return { eligible: false, reason: `EVIDENCE_MISSING:${required}` };
  }
  if (!Array.isArray(job.allowedFiles) || job.allowedFiles.length === 0 || job.allowedFiles.length > SAFE_REPAIR_CONSTRAINTS.maxFilesChanged) {
    return { eligible: false, reason: "FILE_SCOPE_INVALID" };
  }
  const capRaw = Number(process.env.ROAMLY_OPS_AUTODEPLOY_DAILY_CAP);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : 1;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const recent = await listRecentDeployEvidence(todayStart.toISOString());
  if (recent.length >= cap) return { eligible: false, reason: "DAILY_CAP_REACHED" };
  return { eligible: true, reason: "GATE_PASSED" };
}

// ── Job execution ───────────────────────────────────────────────────────────

export type OpsWorkerBatchSummary = {
  processed: number;
  completed: number;
  failed: number;
  skippedPolicy: number;
  skippedLocked: number;
  skippedOwnerApproval: number;
  repairJobsCreated: number;
  findingsCreated: number;
  jobIds: string[];
};

async function recordAutodeployGateVerdict(job: OperationsJob): Promise<void> {
  const client = createSupabaseAdminClient();
  let evidence: Array<Pick<OperationsEvidence, "result" | "category">> = [];
  if (client) {
    const detail = await getOperationsJob(client, job.id);
    if (detail.ok) {
      evidence = (detail.detail.evidence || []).map((row) => ({ result: row.result, category: row.category }));
    }
  }
  const verdict = await evaluateAutoDeployGate(job, evidence);
  const gateEvidence = createEvidence({
    jobId: job.id,
    category: "deterministic_check",
    source: "ops_worker:autodeploy_gate",
    result: verdict.eligible ? "pass" : verdict.reason === "AUTODEPLOY_OFF" ? "not_run" : "blocked",
    summary: `Auto-deploy gate: ${verdict.reason}`.slice(0, 240),
    metadata: { gate_reason: verdict.reason, eligible: verdict.eligible }
  });
  await insertOperationsEvidence(gateEvidence, null);
}

async function executeJob(
  job: OperationsJob,
  input: { baseUrl: string; fetchFn?: typeof fetch; now: number }
): Promise<{ outcome: "COMPLETED" | "FAILED"; findingsCreated: number; repairJobsCreated: number }> {
  const nowIso = new Date(input.now).toISOString();
  const claimed = await updateOperationsJobStatus(job.id, "QUEUED", { status: "RUNNING", started_at: nowIso });
  if (!claimed) throw new Error("CLAIM_LOST");

  const attemptId = await insertOperationsAttempt({
    jobId: job.id,
    attemptNumber: job.retryCount + 1,
    workerRole: job.role,
    runnerId: job.runnerId,
    status: "started"
  });
  const finishAttempt = async (status: "passed" | "failed", summaryText: string, errorClass: string | null) => {
    if (!attemptId) return;
    await updateOperationsAttempt(attemptId, {
      status,
      sanitized_summary: summaryText.slice(0, 240),
      error_class: errorClass,
      completed_at: new Date().toISOString()
    });
  };

  try {
    const suite = await runCheckSuite(job.runnerId || "", { baseUrl: input.baseUrl, fetchFn: input.fetchFn });
    const evidenceList: OperationsEvidence[] = [];
    for (const check of suite.checks) {
      const evidence = createEvidence({
        jobId: job.id,
        category: check.category,
        source: `ops_worker:${check.checkId}`,
        result: check.ok ? "pass" : "fail",
        summary: check.summary.slice(0, 240),
        metadata: check.metadata
      });
      const evidenceId = await insertOperationsEvidence(evidence, attemptId);
      if (evidenceId) evidenceList.push(evidence);
    }

    const runningJob = { ...job, status: "RUNNING" as const };
    if (evidenceSatisfiesCompletion(runningJob, evidenceList)) {
      // Legal path: RUNNING -> VALIDATING -> COMPLETED; DB writes mirror it.
      transitionOperationsJob(runningJob, "VALIDATING");
      await updateOperationsJobStatus(job.id, "RUNNING", { status: "VALIDATING" });
      const validatingJob = { ...runningJob, status: "VALIDATING" as const };
      transitionOperationsJob(validatingJob, "COMPLETED", evidenceList);
      await updateOperationsJobStatus(job.id, "VALIDATING", { status: "COMPLETED", completed_at: nowIso });
      await finishAttempt("passed", suite.summary, null);
      const followUp = await handleFailedChecks(job, suite, input.now);
      return { outcome: "COMPLETED", findingsCreated: followUp.findingsCreated, repairJobsCreated: followUp.repairJobsCreated };
    }

    // Every check failed — the sweep itself is evidence, but Codex's completion
    // rule blocks COMPLETED; RUNNING -> FAILED (legal) with the reason recorded.
    transitionOperationsJob(runningJob, "FAILED");
    await updateOperationsJobStatus(job.id, "RUNNING", {
      status: "FAILED",
      completed_at: nowIso,
      escalation_reason: "COMPLETION_EVIDENCE_REQUIRED"
    });
    await finishAttempt("failed", suite.summary, "EVIDENCE_NOT_SATISFIED");
    return { outcome: "FAILED", findingsCreated: 0, repairJobsCreated: 0 };
  } catch {
    const runningJob = { ...job, status: "RUNNING" as const };
    try {
      transitionOperationsJob(runningJob, "FAILED");
    } catch {
      // Unreachable by construction (RUNNING -> FAILED is legal).
    }
    await updateOperationsJobStatus(job.id, "RUNNING", {
      status: "FAILED",
      completed_at: nowIso,
      escalation_reason: "RUNNER_EXCEPTION"
    });
    await finishAttempt("failed", "Runner exception during execution.", "RUNNER_EXCEPTION");
    return { outcome: "FAILED", findingsCreated: 0, repairJobsCreated: 0 };
  }
}

export async function runOpsWorkerBatch(
  options: { now?: number; limit?: number; baseUrl?: string; fetchFn?: typeof fetch } = {}
): Promise<OpsWorkerBatchSummary> {
  const now = options.now || Date.now();
  const nowIso = new Date(now).toISOString();
  const limit = Math.max(1, Math.min(20, options.limit ?? WORKER_DEFAULT_LIMIT));
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const summary: OpsWorkerBatchSummary = {
    processed: 0,
    completed: 0,
    failed: 0,
    skippedPolicy: 0,
    skippedLocked: 0,
    skippedOwnerApproval: 0,
    repairJobsCreated: 0,
    findingsCreated: 0,
    jobIds: []
  };

  const listed = await listOperationsJobs(undefined, 100);
  if (!listed.ok) return summary;
  const jobs = listed.jobs.map(rowToOperationsJob);

  await deleteExpiredOperationsLocks(nowIso);
  const locks = await listOperationsLocks();
  const lockedSubsystems = new Set(locks.filter((lock) => Date.parse(lock.lease_expires_at) > now).map((lock) => lock.subsystem));

  const candidates = jobs
    .filter((job) => job.status === "QUEUED")
    .sort((a, b) => (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0) || a.createdAt.localeCompare(b.createdAt));

  const dependencyStates: Record<string, OperationsJobState> = {};
  for (const job of jobs) dependencyStates[job.id] = job.status;
  let activeGlobalJobs = jobs.filter((job) => job.status === "RUNNING").length;

  for (const job of candidates) {
    // LEVEL_3: never executed here — record the (disabled-by-default)
    // auto-deploy gate verdict as evidence and move on. LEVEL_4: untouched.
    if (job.authorityLevel === "LEVEL_3_SAFE_REPAIR") {
      await recordAutodeployGateVerdict(job);
      summary.processed++;
      summary.jobIds.push(job.id);
      continue;
    }
    if (job.authorityLevel !== "LEVEL_1_OBSERVE" && job.authorityLevel !== "LEVEL_2_DIAGNOSE") continue;

    if (summary.processed >= limit) break;
    if (job.ownerApprovalRequired) {
      summary.skippedOwnerApproval++;
      continue;
    }
    const allowed = dispatchAllowed(job, {
      activeGlobalJobs,
      globalLimit: WORKER_GLOBAL_LIMIT,
      lockedSubsystems: [...lockedSubsystems],
      dependencyStates,
      allowedAuthorityLevels: WORKER_AUTHORITY_CEILING
    });
    if (!allowed) {
      summary.skippedPolicy++;
      continue;
    }
    const locked = await acquireOperationsLock(job.subsystem, job.id, WORKER_LOCK_LEASE_MINUTES);
    if (!locked) {
      summary.skippedLocked++;
      continue;
    }
    lockedSubsystems.add(job.subsystem);
    activeGlobalJobs++;
    try {
      const result = await executeJob(job, { baseUrl, fetchFn: options.fetchFn, now });
      summary.processed++;
      summary.jobIds.push(job.id);
      if (result.outcome === "COMPLETED") summary.completed++;
      else summary.failed++;
      summary.findingsCreated += result.findingsCreated;
      summary.repairJobsCreated += result.repairJobsCreated;
      dependencyStates[job.id] = result.outcome;
    } catch {
      summary.processed++;
      summary.jobIds.push(job.id);
      summary.failed++;
      dependencyStates[job.id] = "FAILED";
    } finally {
      activeGlobalJobs--;
      lockedSubsystems.delete(job.subsystem);
      await releaseOperationsLock(job.subsystem, job.id);
    }
  }
  return summary;
}
