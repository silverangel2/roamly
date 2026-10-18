/**
 * Sophie Command Door — Roamly's side of the Empire Central Command
 * contract (v1, 2026-10-17).
 *
 * Sophie (Junel's local AI) connects OUTBOUND from his iMac to this door.
 * She can read the keeper/ops picture (sitrep) and enqueue whitelisted jobs
 * into Roamly's OWN roamly_ops_jobs ledger, where the existing
 * roamly-ops-worker (cron every 15 min) executes them under its own
 * authority ceiling:
 *   - "run_sweep"      → LEVEL_1_OBSERVE, runner phase2.gap-audit.observe:
 *     the real read-only check suite (route probes + policy registry).
 *   - "prepare_repair" → LEVEL_3_SAFE_REPAIR, runner phase2.gap-audit.safe-repair:
 *     bounded preparation-only job (max 5 files, ≤200 lines, revertible;
 *     no migrations, secrets, spending, or customer financial truth).
 *     LEVEL_3 jobs are NEVER executed by the worker — it only records the
 *     auto-deploy gate verdict as evidence, and the auto-deploy machinery
 *     ships DISABLED (ROAMLY_OPS_AUTODEPLOY unset). A human reviews.
 *
 * Residency rule holds: the door writes only through Roamly's own store
 * functions (opsStore, opsControlPlane, specialistOrganization). It deploys
 * nothing, repairs nothing, spends nothing, and touches no customer.
 * Repairs stay OFF (the worker's kill switch + the keeper's
 * ROAMLY_KEEPER_REPAIRS gate are untouched by this module).
 *
 * Auth: Bearer SOPHIE_COMMAND_KEY (per-site key, set by Junel in Vercel
 * env). Unset key = door disabled. Constant-time comparison. Fail-closed.
 *
 * This module never throws to its routes; failures are values.
 */
import { timingSafeEqual } from "crypto";
import {
  enqueueOperationsJob,
  listOperationsJobs,
  type OperationsJobRow,
} from "@/lib/roamly/opsStore";
import {
  createOperationsJob,
  isRegisteredRunner,
  type OperationsJob,
} from "@/lib/roamly/opsControlPlane";
import {
  createSafeRepairJob,
  SAFE_REPAIR_CONSTRAINTS,
} from "@/lib/roamly/specialistOrganization";

export const SOPHIE_ORDER_TYPES = ["run_sweep", "prepare_repair"] as const;
export type SophieOrderType = (typeof SOPHIE_ORDER_TYPES)[number];

const MAX_QUEUED_SOPHIE_JOBS = 3;
const MAX_REPAIR_FILES = SAFE_REPAIR_CONSTRAINTS.maxFilesChanged;
const MAX_REPAIR_LINES = SAFE_REPAIR_CONSTRAINTS.maxLinesChanged;
const MAX_DETAIL_FILE_LENGTH = 200;

const REPAIR_ACCEPTANCE_CRITERIA = [
  "Re-run the failed deterministic check with a passing result.",
  "Confirm no customer travel truth or sensitive evidence boundary changed.",
];

function keyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Returns an error message when the caller is not Sophie, else null. */
export function sophieAuthError(request: Request): string | null {
  const expected = process.env.SOPHIE_COMMAND_KEY;
  if (!expected) return "Sophie command door is not configured.";
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!provided || !keyMatches(provided, expected)) {
    return "Unauthorized command request.";
  }
  return null;
}

export type OrderValidation =
  | {
      ok: true;
      type: SophieOrderType;
      reason: string;
      detail: Record<string, unknown>;
      files: string[];
      estimatedLinesChanged: number;
    }
  | { ok: false; error: string };

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && trimmed.length <= MAX_DETAIL_FILE_LENGTH) out.push(trimmed);
  }
  return out;
}

/** Pure validation of an order body against the v1 whitelist. */
export function validateSophieOrder(body: unknown): OrderValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Order body must be a JSON object." };
  }
  const { type, reason, detail } = body as {
    type?: unknown;
    reason?: unknown;
    detail?: unknown;
  };
  if (
    typeof type !== "string" ||
    !(SOPHIE_ORDER_TYPES as readonly string[]).includes(type)
  ) {
    return {
      ok: false,
      error: `Order type not whitelisted. Allowed: ${SOPHIE_ORDER_TYPES.join(", ")}.`,
    };
  }
  const orderType = type as SophieOrderType;
  const cleanReason =
    typeof reason === "string" && reason.trim()
      ? reason.trim().slice(0, 300)
      : "No reason given.";
  const cleanDetail =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {};
  let files: string[] = [];
  let estimatedLinesChanged = 40;
  if (orderType === "prepare_repair") {
    files = cleanStringArray(cleanDetail.files).slice(0, MAX_REPAIR_FILES);
    if (files.length === 0) {
      return {
        ok: false,
        error: `prepare_repair needs detail.files: 1 to ${MAX_REPAIR_FILES} file path(s).`,
      };
    }
    const rawLines = cleanDetail.estimatedLinesChanged;
    if (typeof rawLines === "number" && Number.isFinite(rawLines)) {
      estimatedLinesChanged = Math.max(
        1,
        Math.min(MAX_REPAIR_LINES, Math.floor(rawLines))
      );
    }
  }
  return {
    ok: true,
    type: orderType,
    reason: cleanReason,
    detail: cleanDetail,
    files,
    estimatedLinesChanged,
  };
}

export type SophieOrderResult =
  | {
      ok: true;
      job: { id: string; role: string; authority_level: string; status: string };
    }
  | { ok: false; status: number; error: string };

function jobSource(row: OperationsJobRow): string | null {
  const scope = row.scope_json as { source?: unknown } | null | undefined;
  return typeof scope?.source === "string" ? scope.source : null;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Enqueue a validated order into Roamly's own ops ledger, with the anti-flood guard. */
export async function placeSophieOrder(
  validation: Extract<OrderValidation, { ok: true }>
): Promise<SophieOrderResult> {
  const listed = await listOperationsJobs(undefined, 50);
  if (!listed.ok) {
    return {
      ok: false,
      status: 503,
      error: "Roamly ops ledger is not provisioned yet; orders cannot be recorded.",
    };
  }
  const queuedSophie = (listed.jobs as OperationsJobRow[]).filter(
    (j) => j.status === "QUEUED" && jobSource(j) === "sophie"
  ).length;
  if (queuedSophie >= MAX_QUEUED_SOPHIE_JOBS) {
    return {
      ok: false,
      status: 429,
      error: `Too many Sophie orders already queued (${queuedSophie}). Wait for the ops worker to drain them.`,
    };
  }

  const requestedAt = new Date().toISOString();
  const scope = {
    source: "sophie",
    reason: validation.reason,
    detail: validation.detail,
    requestedAt,
  };

  let job: OperationsJob;
  if (validation.type === "run_sweep") {
    job = createOperationsJob({
      role: "GAP_AUDIT_QA",
      initiatingSignal: "sophie-command:run_sweep",
      objective: `Sophie-ordered site sweep: ${validation.reason}`,
      subsystem: "website",
      priority: "normal",
      risk: "low",
      authorityLevel: "LEVEL_1_OBSERVE",
      scope,
      evidenceRequirements: ["deterministic_check"],
      tokenBudget: 0,
      financialBudgetUsd: 0,
      maxAttempts: 1,
      runnerId: "phase2.gap-audit.observe",
      dedupeKey: `sophie:sweep:${todayStamp()}`,
    });
    // Safety: never enqueue a sweep the real worker cannot dispatch.
    if (!isRegisteredRunner(job.runnerId)) {
      return {
        ok: false,
        status: 500,
        error: "Sweep runner is not registered with the ops control plane.",
      };
    }
  } else {
    job = createSafeRepairJob({
      role: "GAP_AUDIT_QA",
      initiatingSignal: "sophie-command:prepare_repair",
      objective: `Safe repair prepared for Sophie: ${validation.reason}`,
      subsystem: "website",
      allowedFiles: validation.files,
      estimatedLinesChanged: validation.estimatedLinesChanged,
      acceptanceCriteria: [...REPAIR_ACCEPTANCE_CRITERIA],
      approvalCategory: null,
      priority: "high",
    });
    job.scope = { ...job.scope, ...scope };
    job.dedupeKey = `sophie:repair:${validation.files.join(",").slice(0, 60)}:${todayStamp()}`;
  }
  job.status = "QUEUED";

  const stored = await enqueueOperationsJob(job);
  if (stored.duplicate) {
    return {
      ok: false,
      status: 409,
      error: "Duplicate order suppressed (a matching Sophie order already exists).",
    };
  }
  if (!stored.ok || !stored.jobId) {
    return { ok: false, status: 500, error: "The order could not be recorded." };
  }
  return {
    ok: true,
    job: {
      id: stored.jobId,
      role: job.role,
      authority_level: job.authorityLevel,
      status: job.status,
    },
  };
}

export type SophieSitrep = {
  ok: boolean;
  site: "roamly";
  at: string;
  sections: {
    ops: {
      tablesReady: boolean;
      counts: Record<string, number>;
      recentJobs: Array<{
        id: string;
        role: string;
        authority_level: string;
        status: string;
        subsystem: string;
        source: string | null;
        objective: string;
        created_at: string;
      }>;
    } | null;
    keeper: {
      recentRuns: Array<{
        id: string;
        status: string;
        objective: string;
        created_at: string;
      }>;
    } | null;
  };
  degraded: string[];
};

function summarizeJobs(rows: OperationsJobRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const status = String(row.status ?? "unknown");
    counts[status] = (counts[status] || 0) + 1;
  }
  const recentJobs = rows.slice(0, 10).map((row) => ({
    id: String(row.id ?? ""),
    role: String(row.role ?? ""),
    authority_level: String(row.authority_level ?? ""),
    status: String(row.status ?? ""),
    subsystem: String(row.subsystem ?? ""),
    source: jobSource(row),
    objective: String(row.objective ?? "").slice(0, 160),
    created_at: String(row.created_at ?? ""),
  }));
  return { counts, recentJobs };
}

/** The watch picture: ops ledger + recent keeper runs, fail-soft per section. */
export async function buildSophieSitrep(): Promise<SophieSitrep> {
  const degraded: string[] = [];
  let ops: SophieSitrep["sections"]["ops"] = null;
  let keeper: SophieSitrep["sections"]["keeper"] = null;

  let rows: OperationsJobRow[] = [];
  try {
    const listed = await listOperationsJobs(undefined, 50);
    if (!listed.ok) {
      degraded.push("ops");
      degraded.push("keeper");
    } else {
      rows = listed.jobs as OperationsJobRow[];
      const { counts, recentJobs } = summarizeJobs(rows);
      ops = { tablesReady: true, counts, recentJobs };
      const keeperRows = rows
        .filter(
          (row) =>
            row.subsystem === "keeper" ||
            String(row.runner_id ?? "").startsWith("keeper-")
        )
        .slice(0, 5);
      keeper = {
        recentRuns: keeperRows.map((row) => ({
          id: String(row.id ?? ""),
          status: String(row.status ?? ""),
          objective: String(row.objective ?? "").slice(0, 160),
          created_at: String(row.created_at ?? ""),
        })),
      };
    }
  } catch {
    degraded.push("ops");
    degraded.push("keeper");
  }

  return {
    ok: degraded.length === 0,
    site: "roamly",
    at: new Date().toISOString(),
    sections: { ops, keeper },
    degraded,
  };
}
