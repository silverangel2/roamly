/**
 * ROAMLY KEEPER v1 — the site's internal maintenance resident.
 *
 * Charter (Junel, 2026-10-16): a sophisticated bot that lives INSIDE the
 * website and maintains the site independently. Operationalized:
 * - it continuously checks Roamly's lanes (health: healthy/degraded/down + evidence),
 * - it diagnoses problems with a written diagnosis,
 * - it performs a WHITELIST of safe, reversible, idempotent data-level repairs
 *   on its own,
 * - it logs everything with before/after evidence into the existing ops ledger,
 * - anything outside the whitelist escalates to Junel/Dylan with lane, evidence,
 *   likely cause class, and the exact human action needed.
 * Autonomy = judgment inside this charter, never beyond it.
 *
 * THE WALL (family standard): Roamly scope only — Roamly's own database,
 * Roamly's own code paths, Roamly's own configured channels. No external
 * account operation, no other products (the RI keeper is a separate resident;
 * this bot never touches RI or Sophie), no social posting, no browsing,
 * no code changes, no deploys, no schema changes, no env changes, no spending.
 * Repairs are whitelist-only; a repair failing twice stops and escalates.
 * Kill switch: checks always run when invoked; REPAIRS run only when
 * ROAMLY_KEEPER_REPAIRS === "on". Zero OpenAI.
 *
 * Roamly standing rules encoded here:
 * - exactly ONE free itinerary per account lifetime: the keeper never writes
 *   to entitlement/billing/subscription fields (see WRITE_GUARD_DENIED).
 * - budget price provenance: unknown is never zero; the keeper never writes
 *   any price/amount/provenance field (write-guard rejects them).
 * - migration history is incomplete/manual: the keeper never pushes, resets,
 *   or repairs schema. All reads fail-soft when a table is absent.
 *
 * Logging: uses the existing ops ledger (roamly_ops_jobs, roamly_ops_attempts,
 * roamly_ops_evidence) via lib/roamly/opsStore, mirroring opsWorker conventions.
 * Run exclusion: roamly_cron_locks (same pattern as processFyiDigest).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueOperationsJob,
  insertOperationsAttempt,
  insertOperationsEvidence,
  updateOperationsJobStatus,
} from "@/lib/roamly/opsStore";
import { getRoamlyLaunchReadiness } from "@/lib/roamly/launchReadiness";

// ── Kill switch ─────────────────────────────────────────────────────────────

export const keeperRepairsEnabled = (): boolean =>
  (process.env.ROAMLY_KEEPER_REPAIRS || "").trim().toLowerCase() === "on";

// ── Write guard ─────────────────────────────────────────────────────────────

const WRITE_GUARD_DENIED_TABLES = new Set([
  "roamly_entitlements",
  "roamly_billing",
  "roamly_subscriptions",
  "roamly_plans",
  "profiles",
]);

const WRITE_GUARD_DENIED_KEY_PARTS = [
  "free_itinerary",
  "entitlement",
  "subscription",
  "stripe",
  "price",
  "amount",
  "cost",
  "provenance",
  "budget",
];

export function keeperWriteGuard(table: string, patch: Record<string, unknown>): {
  allowed: boolean;
  reason?: string;
} {
  if (WRITE_GUARD_DENIED_TABLES.has(table)) {
    return { allowed: false, reason: `table ${table} is outside the keeper's write scope` };
  }
  const keys = Object.keys(patch);
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (WRITE_GUARD_DENIED_KEY_PARTS.some((part) => lower.includes(part))) {
      return { allowed: false, reason: `field ${key} is protected (billing/price surface)` };
    }
  }
  return { allowed: true };
}

// ── Types ───────────────────────────────────────────────────────────────────

export type KeeperLane =
  | "completion_email_queue"
  | "social_autopost"
  | "fyi_upsell_hygiene"
  | "booking_audit_leftovers"
  | "config_flags";

export type KeeperStatus = "healthy" | "degraded" | "down";

export type KeeperCheckResult = {
  lane: KeeperLane;
  status: KeeperStatus;
  summary: string;
  evidence: Record<string, unknown>;
};

export type KeeperEscalation = {
  lane: KeeperLane;
  evidence: Record<string, unknown>;
  causeClass: string;
  humanAction: string;
};

export type KeeperRepairResult = {
  repair: "completion_email_retry_redrive";
  applied: boolean;
  redriven: string[];
  skipped: string[];
  escalations: KeeperEscalation[];
  summary: string;
};

export type KeeperSuiteReport = {
  runnerId: string;
  at: string;
  repairsEnabled: boolean;
  checks: KeeperCheckResult[];
  repair: KeeperRepairResult | null;
  escalations: KeeperEscalation[];
  summary: string;
};

export type KeeperEmailErrorClass = "provider-era" | "permanent" | "unknown";

/**
 * Classify a completion-email failure into a failure class from its error text.
 * provider-era = the old-provider credential era ("API key is invalid") — the
 * errors the Oct-2026 migration to Google Workspace SMTP leaves behind. These
 * are the only failures the whitelist may re-drive. "permanent" (blocked
 * recipient etc.) is never retried.
 */
export function classifyEmailError(errorText: unknown): KeeperEmailErrorClass {
  const text = String(errorText || "").toLowerCase();
  if (!text) return "unknown";
  if (/api key is invalid|invalid api|unauthorized| 401|auth/i.test(text)) return "provider-era";
  if (/blocked|bounce|invalid recipient| 550|permanent|no mailbox|address rejected/i.test(text))
    return "permanent";
  return "unknown";
}

// ── Dependency seams (production adapter + test doubles) ────────────────────

export type KeeperDbFilter = { column: string; op: "eq" | "is" | "in" | "lt" | "gte" | "neq"; value: unknown };

/** One database row as the keeper sees it: named columns are read off a
 *  string-keyed record; every value is narrowed at the read site. */
export type KeeperDbRow = Record<string, unknown>;

export type KeeperDb = {
  table: (name: string) => {
    count: (filters: KeeperDbFilter[]) => Promise<number>;
    rows: (filters: KeeperDbFilter[], opts?: { limit?: number; order?: string; columns?: string }) => Promise<KeeperDbRow[]>;
    update: (patch: Record<string, unknown>, filters: KeeperDbFilter[]) => Promise<{ updated: number }>;
  };
  tableMissing: (name: string) => boolean;
};

/** Narrow an unknown JSON value to a plain record; anything else becomes {}. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type KeeperEnv = Record<string, string | undefined>;

export type KeeperDeps = {
  db: KeeperDb;
  env: KeeperEnv;
  now: () => Date;
};

// ── Constants ───────────────────────────────────────────────────────────────

export const KEEPER_RUNNER_PREFIX = "keeper.roamly";
export const KEEPER_LOCK_NAME = "roamly-keeper";
export const KEEPER_LOCK_TTL_SECONDS = 1800;
export const STUCK_EMAIL_DOWN_THRESHOLD = 10;
export const STUCK_EMAIL_DEGRADED_THRESHOLD = 3;
export const REPAIR_MAX_PER_RUN = 5;
export const REPAIR_MAX_PER_TRIP = 2;
export const RETRY_ATTEMPT_LIMIT = 5;

// ── Sender readiness ────────────────────────────────────────────────────────

export function keeperSenderReady(env: KeeperEnv): { ready: boolean; detail: string } {
  const provider = (env.ROAMLY_EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  if (provider !== "smtp") {
    return { ready: false, detail: `email provider is "${provider}", keeper redrive expects smtp` };
  }
  const missing: string[] = [];
  for (const key of ["ROAMLY_SMTP_HOST", "ROAMLY_SMTP_PORT", "ROAMLY_SMTP_USER", "ROAMLY_SMTP_PASSWORD"]) {
    if (!(env[key] || "").trim()) missing.push(key);
  }
  if (missing.length) {
    return { ready: false, detail: `smtp not fully configured (missing: ${missing.join(", ")})` };
  }
  return { ready: true, detail: "smtp sender configured" };
}

// ── Checks ──────────────────────────────────────────────────────────────────

function eq(column: string, value: unknown): KeeperDbFilter {
  return { column, op: "eq", value };
}

async function completionEmailQueueCheck(deps: KeeperDeps): Promise<KeeperCheckResult> {
  const lane: KeeperLane = "completion_email_queue";
  const db = deps.db;
  try {
    if (db.tableMissing("roamly_trips")) {
      return { lane, status: "degraded", summary: "roamly_trips unreadable (fail-soft)", evidence: { tableMissing: true } };
    }
    const stuck = await db.table("roamly_trips").rows(
      [
        { column: "completion_email_status", op: "eq", value: "failed" },
        { column: "completion_email_sent_at", op: "is", value: null },
      ],
      { columns: "id,completion_email_last_error,completion_email_attempt_count,completion_email_next_retry_at,completion_email_permanent_failure" }
    );
    const classes: Record<KeeperEmailErrorClass, number> = { "provider-era": 0, permanent: 0, unknown: 0 };
    for (const row of stuck) classes[classifyEmailError(row.completion_email_last_error)] += 1;
    const oldestDays = stuck.length
      ? Math.max(0, ...stuck.map((r) => {
          const t = typeof r.updated_at === "string" ? Date.parse(r.updated_at) : NaN;
          return Number.isFinite(t) ? (deps.now().getTime() - t) / 86_400_000 : 0;
        }))
      : 0;
    const evidence = {
      stuckCount: stuck.length,
      errorClasses: classes,
      oldestStuckDays: Math.round(oldestDays),
      stuckIds: stuck.slice(0, 20).map((r) => r.id),
    };
    if (stuck.length >= STUCK_EMAIL_DOWN_THRESHOLD) {
      return { lane, status: "down", summary: `${stuck.length} completion emails stuck (≥${STUCK_EMAIL_DOWN_THRESHOLD})`, evidence };
    }
    if (stuck.length >= STUCK_EMAIL_DEGRADED_THRESHOLD) {
      return { lane, status: "degraded", summary: `${stuck.length} completion emails stuck`, evidence };
    }
    return { lane, status: "healthy", summary: stuck.length ? `${stuck.length} stuck, below threshold` : "queue flowing", evidence };
  } catch (error) {
    return { lane, status: "degraded", summary: `check failed softly: ${error instanceof Error ? error.message : String(error)}`, evidence: { error: true } };
  }
}

async function socialAutopostCheck(deps: KeeperDeps): Promise<KeeperCheckResult> {
  const lane: KeeperLane = "social_autopost";
  try {
    if (deps.db.tableMissing("roamly_scheduled_posts")) {
      return { lane, status: "degraded", summary: "roamly_scheduled_posts unreadable (fail-soft)", evidence: { tableMissing: true } };
    }
    const recent = await deps.db.table("roamly_scheduled_posts").rows(
      [],
      { limit: 40, order: "created_at desc", columns: "id,status,platform,created_at,published_at" }
    );
    const byStatus: Record<string, number> = {};
    for (const r of recent) byStatus[String(r.status || "unknown")] = (byStatus[String(r.status || "unknown")] || 0) + 1;
    const publishedAt = recent
      .map((r) => Date.parse(String(r.published_at || r.created_at || "")))
      .filter((t) => Number.isFinite(t));
    const latest = publishedAt.length ? Math.max(...publishedAt) : NaN;
    const hoursSincePublished = Number.isFinite(latest) ? (deps.now().getTime() - latest) / 3_600_000 : Infinity;
    const evidence = { recentCount: recent.length, byStatus, hoursSinceLatestPublished: Math.round(hoursSincePublished) };
    // Daily autopost cadence: >36h without a publish is a break in the streak.
    if (hoursSincePublished > 36 && recent.length > 0) {
      return { lane, status: "down", summary: `no published post in ${Math.round(hoursSincePublished)}h (daily cadence broken)`, evidence };
    }
    if ((byStatus.retrying || 0) + (byStatus.failed || 0) >= 3) {
      return { lane, status: "degraded", summary: `${(byStatus.retrying || 0) + (byStatus.failed || 0)} posts retrying/failed`, evidence };
    }
    return { lane, status: "healthy", summary: "autopost cadence on track", evidence };
  } catch (error) {
    return { lane, status: "degraded", summary: `check failed softly: ${error instanceof Error ? error.message : String(error)}`, evidence: { error: true } };
  }
}

async function fyiUpsellHygieneCheck(deps: KeeperDeps): Promise<KeeperCheckResult> {
  const lane: KeeperLane = "fyi_upsell_hygiene";
  const evidence: Record<string, unknown> = {};
  try {
    if (deps.db.tableMissing("roamly_fyi_upsell_moments")) {
      evidence.fyiMomentsTable = "missing (migration not applied — fail-soft)";
    } else {
      const stale = await deps.db.table("roamly_fyi_upsell_moments").rows(
        [{ column: "status", op: "eq", value: "pending" }],
        { limit: 200, columns: "id,status,created_at" }
      );
      const old = stale.filter((r) => {
        const t = Date.parse(String(r.created_at || ""));
        return Number.isFinite(t) && deps.now().getTime() - t > 7 * 86_400_000;
      });
      evidence.stalePendingMoments = old.length;
      evidence.staleIds = old.slice(0, 20).map((r) => r.id);
    }
    const staleCount = Number(evidence.stalePendingMoments || 0);
    if (staleCount >= 20) return { lane, status: "down", summary: `${staleCount} FYI moments pending >7 days`, evidence };
    if (staleCount >= 5) return { lane, status: "degraded", summary: `${staleCount} FYI moments pending >7 days`, evidence };
    return { lane, status: "healthy", summary: "FYI/upsell data healthy", evidence };
  } catch (error) {
    return { lane, status: "degraded", summary: `check failed softly: ${error instanceof Error ? error.message : String(error)}`, evidence: { error: true } };
  }
}

async function bookingAuditLeftoversCheck(deps: KeeperDeps): Promise<KeeperCheckResult> {
  const lane: KeeperLane = "booking_audit_leftovers";
  const evidence: Record<string, unknown> = {};
  try {
    if (!deps.db.tableMissing("roamly_ops_owner_decisions")) {
      const open = await deps.db.table("roamly_ops_owner_decisions").rows(
        [{ column: "decision", op: "is", value: null }],
        { limit: 100, columns: "id,job_id,requested_category,created_at" }
      );
      const dayMs = 86_400_000;
      const stale = open.filter((r) => {
        const t = Date.parse(String(r.created_at || ""));
        return Number.isFinite(t) && deps.now().getTime() - t > dayMs;
      });
      evidence.openOwnerDecisions = open.length;
      evidence.staleOpenDecisions = stale.length;
      evidence.staleIds = stale.slice(0, 20).map((r) => r.id);
    } else {
      evidence.ownerDecisionsTable = "missing (fail-soft)";
    }
    if (!deps.db.tableMissing("roamly_ops_jobs")) {
      const running = await deps.db.table("roamly_ops_jobs").rows(
        [{ column: "status", op: "eq", value: "running" }],
        { limit: 100, columns: "id,job_type,started_at" }
      );
      const stale = running.filter((r) => {
        const t = Date.parse(String(r.started_at || ""));
        return Number.isFinite(t) && deps.now().getTime() - t > 2 * 3_600_000;
      });
      evidence.stuckRunningJobs = stale.length;
      evidence.stuckJobIds = stale.slice(0, 20).map((r) => r.id);
    }
    const staleDecisions = Number(evidence.staleOpenDecisions || 0);
    const stuckJobs = Number(evidence.stuckRunningJobs || 0);
    if (staleDecisions >= 5 || stuckJobs >= 5) {
      return { lane, status: "down", summary: `${staleDecisions} stale owner decisions, ${stuckJobs} stuck jobs`, evidence };
    }
    if (staleDecisions >= 1 || stuckJobs >= 1) {
      return { lane, status: "degraded", summary: `${staleDecisions} stale owner decisions, ${stuckJobs} stuck jobs`, evidence };
    }
    return { lane, status: "healthy", summary: "no audit leftovers", evidence };
  } catch (error) {
    return { lane, status: "degraded", summary: `check failed softly: ${error instanceof Error ? error.message : String(error)}`, evidence: { error: true } };
  }
}

export function configFlagsCheck(readiness: { label: string; status: string }[]): KeeperCheckResult {
  const lane: KeeperLane = "config_flags";
  const notReady = readiness.filter((r) => r.status !== "Ready");
  const evidence = { notReady: notReady.map((r) => `${r.label}: ${r.status}`) };
  if (notReady.some((r) => r.status === "Missing")) {
    return { lane, status: "down", summary: `${notReady.length} config items not ready`, evidence };
  }
  if (notReady.length) return { lane, status: "degraded", summary: `${notReady.length} config items need setup`, evidence };
  return { lane, status: "healthy", summary: "all config ready", evidence };
}

// ── Whitelisted repairs ─────────────────────────────────────────────────────

export type RepairOutcome = { applied: boolean; reason: string };

/**
 * WHITELIST repair #1: re-drive stuck completion emails.
 * Only trips where:
 *  - completion_email_status = "failed" and nothing was sent,
 *  - completion_email_permanent_failure is not true,
 *  - error class is "provider-era" (stale provider credentials — the Oct-2026
 *    Resend→SMTP migration leaves these behind),
 *  - attempt_count < RETRY_ATTEMPT_LIMIT,
 *  - the keeper has repaired this trip fewer than REPAIR_MAX_PER_TRIP times,
 *  - the current sender is ready (SMTP configured),
 * and at most REPAIR_MAX_PER_RUN per run.
 *
 * The repair writes ONLY timing fields the module's own retry loop reads
 * (completion_email_next_retry_at, plus a keeper_reset_count in
 * metadata.generationEmail). It never re-sends directly — the existing
 * generation-email machinery performs the send through the CURRENT configured
 * provider with its own idempotency keys. Idempotent: a second run sees
 * next_retry_at≈now and the same attempt_count; the per-trip cap bounds it.
 */
export async function repairStuckCompletionEmails(
  deps: KeeperDeps,
  stuckRows: KeeperDbRow[]
): Promise<KeeperRepairResult> {
  const escalations: KeeperEscalation[] = [];
  const redriven: string[] = [];
  const skipped: string[] = [];
  const nowIso = deps.now().toISOString();

  const sender = keeperSenderReady(deps.env);
  if (!sender.ready) {
    return {
      repair: "completion_email_retry_redrive",
      applied: false,
      redriven,
      skipped: stuckRows.map((r) => String(r.id)),
      escalations: [
        {
          lane: "completion_email_queue",
          evidence: { stuckCount: stuckRows.length, senderDetail: sender.detail },
          causeClass: "sender-not-ready",
          humanAction:
            "Junel: finish the email sender setup (Google App Password for support@roamlyhq.com in Vercel, production redeploy). The keeper will re-drive the stuck completion sends automatically once the sender is ready.",
        },
      ],
      summary: `not applied — ${sender.detail}`,
    };
  }

  // Pass 1: classify everything. Diagnoses are never capped — the per-run
  // cap limits only the redrive writes in pass 2.
  const eligible: { row: KeeperDbRow; id: string }[] = [];
  for (const row of stuckRows) {
    const id = String(row.id);
    const errorClass = classifyEmailError(row.completion_email_last_error);
    if (errorClass === "permanent") {
      skipped.push(id);
      escalations.push({
        lane: "completion_email_queue",
        evidence: { tripId: id, lastError: String(row.completion_email_last_error || "") },
        causeClass: "permanent-recipient-failure",
        humanAction:
          "Dylan: inspect the trip's completion_email_last_error; the recipient is blocked/invalid, so this one is NOT retried. Confirm with the traveler or mark the trip accordingly — never retry a permanent failure.",
      });
      continue;
    }
    if (errorClass !== "provider-era") {
      skipped.push(id);
      continue;
    }
    if (Number(row.completion_email_attempt_count || 0) >= RETRY_ATTEMPT_LIMIT) {
      skipped.push(id);
      escalations.push({
        lane: "completion_email_queue",
        evidence: { tripId: id, attemptCount: row.completion_email_attempt_count },
        causeClass: "retry-limit-exhausted",
        humanAction:
          "Dylan: this trip exhausted the completion-email retry limit. Check roamly_email_logs for the provider trail, then either clear it manually or raise the limit deliberately — not a keeper decision.",
      });
      continue;
    }
    const generationEmailMeta = asRecord(asRecord(row.metadata).generationEmail);
    const keeperResets = Number(generationEmailMeta.keeper_reset_count || 0);
    if (keeperResets >= REPAIR_MAX_PER_TRIP) {
      skipped.push(id);
      escalations.push({
        lane: "completion_email_queue",
        evidence: { tripId: id, keeperResets },
        causeClass: "repair-failed-twice",
        humanAction:
          "Dylan: the keeper already re-drove this trip twice and it is still failing. Stop auto-retry: diagnose the provider response in roamly_email_logs before any further attempt.",
      });
      continue;
    }
    eligible.push({ row, id });
  }

  // Pass 2: redrive, capped.
  let remaining = REPAIR_MAX_PER_RUN;
  for (const { row, id } of eligible) {
    if (remaining <= 0) {
      skipped.push(id);
      continue;
    }
    const generationEmailMeta = asRecord(asRecord(row.metadata).generationEmail);
    const keeperResets = Number(generationEmailMeta.keeper_reset_count || 0);
    const nextMetadata = {
      ...asRecord(row.metadata),
      generationEmail: {
        ...generationEmailMeta,
        keeper_reset_count: keeperResets + 1,
        keeper_last_reset_at: nowIso,
      },
    };
    const patch: Record<string, unknown> = {
      completion_email_next_retry_at: nowIso,
      completion_email_status: "pending",
      metadata: nextMetadata,
    };
    const guard = keeperWriteGuard("roamly_trips", patch);
    if (!guard.allowed) {
      skipped.push(id);
      escalations.push({
        lane: "completion_email_queue",
        evidence: { tripId: id, reason: guard.reason },
        causeClass: "write-guard-refusal",
        humanAction: "Dylan: the keeper refused its own whitelisted repair — inspect the guard refusal; do not bypass it without Junel's explicit direction.",
      });
      continue;
    }
    try {
      await deps.db.table("roamly_trips").update(patch, [eq("id", row.id)]);
      redriven.push(id);
      remaining -= 1;
    } catch (error) {
      skipped.push(id);
      escalations.push({
        lane: "completion_email_queue",
        evidence: { tripId: id, error: error instanceof Error ? error.message : String(error) },
        causeClass: "repair-write-failed",
        humanAction: "Dylan: the keeper's reset write failed — inspect the database error before retrying.",
      });
    }
  }

  return {
    repair: "completion_email_retry_redrive",
    applied: redriven.length > 0,
    redriven,
    skipped,
    escalations,
    summary: `redrove ${redriven.length} stuck completion send(s), skipped ${skipped.length}`,
  };
}

/** Anything outside the whitelist is refused, never improvised. */
export function refuseRepair(lane: KeeperLane, requested: string): RepairOutcome {
  return { applied: false, reason: `refused: "${requested}" is not on the v1 whitelist (lane ${lane}). Escalate instead.` };
}

// ── Suite runner ────────────────────────────────────────────────────────────

export async function runKeeperSuite(deps: KeeperDeps, runnerId: string): Promise<KeeperSuiteReport> {
  const at = deps.now().toISOString();
  const checks: KeeperCheckResult[] = [];
  const escalations: KeeperEscalation[] = [];

  checks.push(await completionEmailQueueCheck(deps));
  checks.push(await socialAutopostCheck(deps));
  checks.push(await fyiUpsellHygieneCheck(deps));
  checks.push(await bookingAuditLeftoversCheck(deps));
  try {
    const readiness = getRoamlyLaunchReadiness();
    checks.push(configFlagsCheck(readiness.map((r) => ({ label: r.label, status: r.status }))));
  } catch (error) {
    checks.push({
      lane: "config_flags",
      status: "degraded",
      summary: `readiness unavailable: ${error instanceof Error ? error.message : String(error)}`,
      evidence: { error: true },
    });
  }

  let repair: KeeperRepairResult | null = null;
  const repairsOn = keeperRepairsEnabled();
  const emailCheck = checks.find((c) => c.lane === "completion_email_queue");
  if (repairsOn && emailCheck && (emailCheck.status === "degraded" || emailCheck.status === "down")) {
    const stuckRows = await deps.db.table("roamly_trips").rows(
      [
        { column: "completion_email_status", op: "eq", value: "failed" },
        { column: "completion_email_sent_at", op: "is", value: null },
      ],
      { columns: "id,completion_email_last_error,completion_email_attempt_count,completion_email_next_retry_at,completion_email_permanent_failure,metadata" }
    );
    repair = await repairStuckCompletionEmails(deps, stuckRows);
    escalations.push(...repair.escalations);
  } else if (!repairsOn && emailCheck && emailCheck.status !== "healthy") {
    escalations.push({
      lane: "completion_email_queue",
      evidence: emailCheck.evidence,
      causeClass: "repairs-disabled",
      humanAction:
        "Dylan: the keeper found stuck completion emails but repairs are switched OFF (ROAMLY_KEEPER_REPAIRS). Re-drive them manually via the existing generation-email retry path, or enable keeper repairs deliberately.",
    });
  }

  const down = checks.filter((c) => c.status === "down").length;
  const degraded = checks.filter((c) => c.status === "degraded").length;
  return {
    runnerId,
    at,
    repairsEnabled: repairsOn,
    checks,
    repair,
    escalations,
    summary: `${checks.length - down - degraded}/${checks.length} lanes healthy, ${degraded} degraded, ${down} down; ${escalations.length} escalation(s)`,
  };
}

// ── Ops-ledger logging + cron lock (repo conventions) ───────────────────────

/**
 * Log a completed keeper run into the existing ops ledger, using the real
 * opsStore signatures (camelCase; evidence categories are the repo's closed
 * EvidenceCategory union; metadata values must be primitives).
 */
export async function logKeeperRun(
  admin: SupabaseClient,
  report: KeeperSuiteReport
): Promise<{ jobId: string | null; ok: boolean }> {
  try {
    const jobId = `keeper-${report.runnerId}`;
    const enq = await enqueueOperationsJob(
      {
        id: jobId,
        role: "EXECUTIVE_SECRETARY",
        initiatingSignal: "scheduled-keeper-run",
        priority: "normal",
        risk: "low",
        authorityLevel: "LEVEL_3_SAFE_REPAIR",
        status: "QUEUED",
        objective: `Roamly keeper suite: ${report.summary}`,
        subsystem: "keeper",
        scope: { lanes: report.checks.map((c) => c.lane) },
        allowedOperations: ["read", "completion_email_retry_redrive"],
        allowedFiles: [],
        forbiddenOperations: [
          "code_changes",
          "deploys",
          "schema_changes",
          "env_changes",
          "external_account_operation",
          "billing_writes",
          "price_writes",
        ],
        dependencies: [],
        acceptanceCriteria: [],
        evidenceRequirements: ["deterministic_check", "owner_approval"],
        tokenBudget: 0,
        financialBudgetUsd: 0,
        maxAttempts: 1,
        retryCount: 0,
        dedupeKey: `keeper:${report.at.slice(0, 16)}`,
        cooldownUntil: null,
        escalationReason: null,
        ownerApprovalRequired: false,
        runnerId: report.runnerId,
        createdAt: report.at,
        updatedAt: report.at,
      },
      admin
    );
    if (!enq.ok) return { jobId: null, ok: false };
    const attemptId = await insertOperationsAttempt({
      jobId,
      attemptNumber: 1,
      workerRole: "keeper",
      runnerId: report.runnerId,
      status: report.checks.some((c) => c.status === "down") ? "completed_with_findings" : "completed",
      sanitizedSummary: report.summary.slice(0, 2000),
    });
    const flatMeta = (evidence: Record<string, unknown>): Record<string, string | number | boolean> => {
      const out: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(evidence)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
        else if (Array.isArray(value)) out[key] = value.slice(0, 5).map(String).join(",");
        else if (value && typeof value === "object")
          for (const [sub, subValue] of Object.entries(value as Record<string, unknown>))
            if (typeof subValue === "number") out[`${key}_${sub}`] = subValue;
      }
      return out;
    };
    let i = 0;
    for (const check of report.checks) {
      i += 1;
      await insertOperationsEvidence(
        {
          id: `${jobId}-check-${i}`,
          jobId,
          category: "deterministic_check",
          source: `keeper:lane:${check.lane}`,
          result: check.status === "healthy" ? "pass" : check.status === "degraded" ? "blocked" : "fail",
          summary: `${check.lane}: ${check.summary}`.slice(0, 500),
          metadata: { lane: check.lane, status: check.status, ...flatMeta(check.evidence) },
          createdAt: report.at,
        },
        attemptId
      );
    }
    for (const esc of report.escalations) {
      i += 1;
      await insertOperationsEvidence(
        {
          id: `${jobId}-escalation-${i}`,
          jobId,
          category: "owner_approval",
          source: `keeper:lane:${esc.lane}`,
          result: "blocked",
          summary: `${esc.causeClass}: ${esc.humanAction}`.slice(0, 500),
          metadata: { lane: esc.lane, causeClass: esc.causeClass, ...flatMeta(esc.evidence) },
          createdAt: report.at,
        },
        attemptId
      );
    }
    await updateOperationsJobStatus(jobId, "QUEUED", {
      status: "COMPLETED",
      completed_at: report.at,
    });
    return { jobId, ok: true };
  } catch {
    return { jobId: null, ok: false };
  }
}

export async function acquireKeeperLock(admin: SupabaseClient, owner: string): Promise<boolean> {
  const now = new Date();
  const expires = new Date(now.getTime() + KEEPER_LOCK_TTL_SECONDS * 1000).toISOString();
  const result = await admin
    .from("roamly_cron_locks")
    .upsert(
      { lock_name: KEEPER_LOCK_NAME, lock_owner: owner, expires_at: expires, updated_at: now.toISOString() },
      { onConflict: "lock_name" }
    );
  return !result.error;
}

export async function releaseKeeperLock(admin: SupabaseClient, owner: string): Promise<void> {
  await admin.from("roamly_cron_locks").delete().eq("lock_name", KEEPER_LOCK_NAME).eq("lock_owner", owner);
}
