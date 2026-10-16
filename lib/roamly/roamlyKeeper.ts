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
  | "config_flags"
  | "deploy_doctor"
  | "library_health";

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

/**
 * One Concierge suggestion's keep/drop tally, as the Library Keeper sees it.
 * This is an adapter interface for the Concierge crew: the Concierge attaches
 * its suggestion log here (array, one entry per suggestion). Until it does,
 * the keep-rate scan is skipped with an honest note — never faked.
 */
export type LibrarySuggestionLogEntry = {
  suggestionId: string;
  label: string;
  kept: number;
  dropped: number;
};

export type KeeperDeps = {
  db: KeeperDb;
  env: KeeperEnv;
  now: () => Date;
  suggestions?: LibrarySuggestionLogEntry[];
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

// ── Deploy Doctor (v2 lane, both keepers) ───────────────────────────────────

/**
 * DEPLOY DOCTOR — watches which build is live and whether it broke lanes.
 *
 * The Oct-16 Roamly deploy failure (two layers: a TS null guard, then 23
 * eslint no-explicit-any errors) sat silent for hours until a route probe
 * flipped 404 → 401. This lane reads the build stamp the keeper itself is
 * running inside (process.env.VERCEL_GIT_COMMIT_SHA — the same build
 * serving production) and records it in the ops ledger every run:
 *  - stamp CHANGES → the check row notes "new build live" old→new.
 *  - lanes that were healthy last run (from deterministic_check evidence
 *    rows) and are down/degraded now, right after a stamp change →
 *    escalate "deploy suspect".
 *  - optional env ROAMLY_EXPECTED_BUILD_SHA: when set and the observed
 *    stamp hasn't matched it for 2 consecutive runs → escalate
 *    "expected build not live." WITHOUT the env var this lane is
 *    observation-only: it records the stamp and watches for fresh
 *    failures, nothing more.
 *
 * Detection only — the keeper never rolls back; a human does. Fail-soft:
 * the evidence table read degrades to "no history" when the table is
 * absent, and the stamp is "unavailable" off Vercel.
 */
export const ROAMLY_EVIDENCE_TABLE = "roamly_ops_evidence";
const ROAMLY_EXPECTED_BUILD_SHA_ENV = "ROAMLY_EXPECTED_BUILD_SHA";

export type DeployDoctorResult = {
  check: KeeperCheckResult;
  escalation: { causeClass: string; humanAction: string } | null;
};

export function readRoamlyDeployStamp(env: KeeperEnv): { app: "roamly"; sha: string | null } {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return { app: "roamly", sha: typeof sha === "string" && sha.trim() ? sha.trim() : null };
}

function roamlyShortSha(s: string | null): string {
  return s ? s.slice(0, 12) : "none";
}

/** Narrow an evidence row's metadata to a record (DB column: safe_metadata). */
function evidenceMetadata(row: KeeperDbRow): Record<string, unknown> {
  return asRecord(row.safe_metadata ?? row.metadata);
}

/** Previous deploy-doctor stamp observations, newest first. Empty = no history. */
async function readRoamlyStampHistory(deps: KeeperDeps): Promise<string[]> {
  if (deps.db.tableMissing(ROAMLY_EVIDENCE_TABLE)) return [];
  try {
    const rows = await deps.db.table(ROAMLY_EVIDENCE_TABLE).rows(
      [{ column: "source", op: "eq", value: "keeper:lane:deploy_doctor" }],
      { limit: 5, order: "created_at desc", columns: "id,source,result,safe_metadata,created_at" }
    );
    return rows
      .map((row) => {
        const sha = evidenceMetadata(row).sha;
        return typeof sha === "string" ? sha : "";
      })
      .filter((sha) => sha.length > 0);
  } catch {
    return [];
  }
}

/**
 * Previous run's per-lane statuses, from deterministic_check evidence rows
 * (result pass → healthy, blocked → degraded, fail → down). The current
 * run hasn't logged yet when checks execute, so the newest rows belong to
 * the previous run. Empty = no history.
 */
async function readRoamlyPreviousLaneStatuses(deps: KeeperDeps): Promise<Partial<Record<KeeperLane, KeeperStatus>>> {
  const out: Partial<Record<KeeperLane, KeeperStatus>> = {};
  if (deps.db.tableMissing(ROAMLY_EVIDENCE_TABLE)) return out;
  try {
    const rows = await deps.db.table(ROAMLY_EVIDENCE_TABLE).rows(
      [],
      { limit: 60, order: "created_at desc", columns: "id,source,category,result,safe_metadata,created_at" }
    );
    const lanes = new Set<KeeperLane>(["completion_email_queue", "social_autopost", "fyi_upsell_hygiene", "booking_audit_leftovers", "config_flags", "deploy_doctor", "library_health"]);
    for (const row of rows) {
      const source = String(row.source || "");
      if (!source.startsWith("keeper:lane:")) continue;
      if (String(row.category || "") !== "deterministic_check") continue;
      const laneName = source.slice("keeper:lane:".length);
      if (laneName === "deploy_doctor") continue;
      if (!lanes.has(laneName as KeeperLane)) continue;
      const lane = laneName as KeeperLane;
      if (lane in out) continue;
      const result = String(row.result || "");
      out[lane] = result === "pass" ? "healthy" : result === "blocked" ? "degraded" : result === "fail" ? "down" : "healthy";
    }
    return out;
  } catch {
    return {};
  }
}

export async function deployDoctorCheck(deps: KeeperDeps, priorChecks: KeeperCheckResult[]): Promise<DeployDoctorResult> {
  const lane: KeeperLane = "deploy_doctor";
  const stamp = readRoamlyDeployStamp(deps.env);
  if (!stamp.sha) {
    return {
      check: {
        lane,
        status: "healthy",
        summary: "build stamp unavailable (VERCEL_GIT_COMMIT_SHA not set — not on Vercel); deploy tracking is observation-only off Vercel",
        evidence: {},
      },
      escalation: null,
    };
  }

  const history = await readRoamlyStampHistory(deps);
  const previousSha = history.length > 0 ? history[0] : null;
  const changed = Boolean(previousSha) && previousSha !== stamp.sha;

  const expected = (deps.env[ROAMLY_EXPECTED_BUILD_SHA_ENV] || "").trim() || null;
  let consecutiveMismatches = 0;
  if (expected && stamp.sha !== expected) {
    consecutiveMismatches = 1;
    for (const h of history) {
      if (h === expected) break;
      consecutiveMismatches += 1;
    }
  }

  const freshFailures: KeeperLane[] = [];
  if (changed) {
    const prev = await readRoamlyPreviousLaneStatuses(deps);
    for (const check of priorChecks) {
      if (prev[check.lane] === "healthy" && (check.status === "degraded" || check.status === "down")) {
        freshFailures.push(check.lane);
      }
    }
  }

  const evidence: Record<string, unknown> = {
    sha: stamp.sha,
    previousSha,
    changed,
    expectedSha: expected,
    consecutiveMismatches,
    freshFailures,
  };

  if (expected && consecutiveMismatches >= 2) {
    return {
      check: {
        lane,
        status: "down",
        summary: `expected build ${roamlyShortSha(expected)} not live after ${consecutiveMismatches} consecutive keeper runs (observed ${roamlyShortSha(stamp.sha)})`,
        evidence,
      },
      escalation: {
        causeClass: "expected-build-not-live",
        humanAction: `Dylan: the Vercel deployment for commit ${expected} failed or Vercel is still serving an older build — read its build logs. If broken, fix and redeploy, or set ${ROAMLY_EXPECTED_BUILD_SHA_ENV} to the build that should be live.`,
      },
    };
  }
  if (changed && freshFailures.length > 0) {
    return {
      check: {
        lane,
        status: "down",
        summary: `deploy suspect: new build ${roamlyShortSha(previousSha)} → ${roamlyShortSha(stamp.sha)} went live and ${freshFailures.length} lane(s) just started failing: ${freshFailures.join(", ")}`,
        evidence,
      },
      escalation: {
        causeClass: "deploy-suspect",
        humanAction: `Dylan: the new build ${stamp.sha} may have introduced a regression — check the Vercel deployment logs. If the build is broken, roll back to the previous deployment in the Vercel dashboard and re-ship the round as one release.`,
      },
    };
  }
  if (expected && consecutiveMismatches === 1) {
    return {
      check: {
        lane,
        status: "degraded",
        summary: `observed build ${roamlyShortSha(stamp.sha)} does not match expected ${roamlyShortSha(expected)} (1st run — watching one more before escalating)`,
        evidence,
      },
      escalation: null,
    };
  }
  return {
    check: {
      lane,
      status: "healthy",
      summary: changed
        ? `new build live: ${roamlyShortSha(previousSha)} → ${roamlyShortSha(stamp.sha)}; no fresh lane failures`
        : `build ${roamlyShortSha(stamp.sha)} still live; no drift`,
      evidence,
    },
    escalation: null,
  };
}

// ── Library Health (v3 lane) ─────────────────────────────────────────────

/**
 * LIBRARY HEALTH — watches Roamly's itinerary-library machinery:
 *  1. Consent integrity: any library-bound submission row missing its
 *     consent flag (consent_anonymized_reuse IS NULL) → DOWN. Junel's rule
 *     is consent-gated reuse; a null flag means consent state is unknown,
 *     and unknown is never treated as granted.
 *  2. Publishability guard: any stored pattern below the 3-trip publish
 *     floor (the writer filters these before saving, so a stored one is a
 *     writer bug) → DOWN, naming the pattern.
 *  3. Staleness: patterns with no refresh in 90+ days → DEGRADED, listed.
 *  4. Provenance completeness: item verdicts missing the provenance stamp
 *     (blank source, null booking_proven) → DEGRADED with counts.
 *  5. Ask funnel evidence: post-trip asks sent vs answered (30d window),
 *     from roamly_email_logs idempotency keys vs trip_feedback +
 *     itinerary_submissions. Evidence only — a starving funnel is how the
 *     library dies quietly; the verdict is for the humans.
 *  6. Suggestion keep-rate: if the Concierge attached its suggestion log
 *     (KeeperDeps.suggestions), any suggestion with ≥5 drops and 0 keeps
 *     is flagged "retire candidate" — evidence only. Retiring is a
 *     human/Concierge-side decision; this lane never writes.
 *
 * Front-door storage (migration 20261015000100) is applied by Junel by
 * hand. If those tables are absent, the lane says so honestly
 * ("storage not present yet") and degrades — never a false DOWN and
 * never a crash. Detection only: no repair whitelist entry, the existing
 * whitelist is untouched, and the write guard is never bypassed.
 */
export const LIBRARY_SUBMISSIONS_TABLE = "itinerary_submissions";
export const LIBRARY_VERDICTS_TABLE = "item_verdicts";
export const LIBRARY_PATTERNS_TABLE = "successful_trip_experience_patterns";
export const LIBRARY_EMAIL_LOGS_TABLE = "roamly_email_logs";
export const LIBRARY_FEEDBACK_TABLE = "trip_feedback";
export const PUBLISHABLE_MIN_TRIPS = 3;
export const PATTERN_STALE_DAYS = 90;
export const SUGGESTION_RETIRE_DROPS = 5;
export const ASK_WINDOW_DAYS = 30;
export const POST_TRIP_ASK_PREFIX = "post_trip_library_ask:";

export type LibraryHealthResult = {
  check: KeeperCheckResult;
  escalations: KeeperEscalation[];
};

function distinctStrings(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value) out.add(value);
  }
  return [...out];
}

function countTrips(row: KeeperDbRow): number | null {
  const source = row.source_trip_count;
  const sample = row.sample_count;
  const pick = typeof source === "number" ? source : typeof sample === "number" ? sample : null;
  return pick !== null && Number.isFinite(pick) ? pick : null;
}

export async function libraryHealthCheck(deps: KeeperDeps): Promise<LibraryHealthResult> {
  const lane: KeeperLane = "library_health";
  try {
    const db = deps.db;
    const now = deps.now();
    const evidence: Record<string, unknown> = {};
    const escalations: KeeperEscalation[] = [];
    const problems: string[] = [];

    // ── 1/2. Patterns library: publishability + staleness ──
    let patternCount = 0;
    const stalePatterns: string[] = [];
    const belowFloor: string[] = [];
    if (db.tableMissing(LIBRARY_PATTERNS_TABLE)) {
      evidence.patternsTable = "absent (expected since Oct 2025)";
      problems.push("patterns table absent");
    } else {
      const rows = await db.table(LIBRARY_PATTERNS_TABLE).rows([], {
        columns: "pattern_key,destination_key,sample_count,source_trip_count,updated_at",
        order: "updated_at desc",
        limit: 500,
      });
      patternCount = rows.length;
      const staleCutoff = now.getTime() - PATTERN_STALE_DAYS * 86_400_000;
      for (const row of rows) {
        const key = String(row.pattern_key || "unnamed-pattern");
        const trips = countTrips(row);
        if (trips === null || trips < PUBLISHABLE_MIN_TRIPS) {
          belowFloor.push(`${key} (${trips === null ? "no trip count" : `${trips} trips`})`);
          continue;
        }
        const updatedAt = typeof row.updated_at === "string" ? row.updated_at : "";
        if (updatedAt && Date.parse(updatedAt) < staleCutoff) stalePatterns.push(key);
      }
      evidence.patternCount = patternCount;
      evidence.belowPublishFloor = belowFloor.slice(0, 10);
      evidence.belowPublishFloorTotal = belowFloor.length;
      evidence.stalePatterns = stalePatterns.slice(0, 10);
      evidence.stalePatternsTotal = stalePatterns.length;
      if (belowFloor.length) problems.push(`${belowFloor.length} pattern(s) below the ${PUBLISHABLE_MIN_TRIPS}-trip publish floor`);
      if (stalePatterns.length) problems.push(`${stalePatterns.length} pattern(s) stale (${PATTERN_STALE_DAYS}+ days)`);
    }

    // ── Front-door storage (hand-applied migration): 1/4/consent/provenance ──
    const frontDoorPresent =
      !db.tableMissing(LIBRARY_SUBMISSIONS_TABLE) && !db.tableMissing(LIBRARY_VERDICTS_TABLE);
    if (!frontDoorPresent) {
      evidence.frontDoorStorage =
        "not present yet — migration 20261015000100_roamly_itinerary_library_frontdoor.sql not applied; front-door checks skipped, no false alarm raised";
      problems.push("front-door storage not present yet");
    } else {
      // 1. Consent integrity: a null consent flag = unknown consent state.
      const missingConsent = await db.table(LIBRARY_SUBMISSIONS_TABLE).rows(
        [{ column: "consent_anonymized_reuse", op: "is", value: null }],
        { columns: "id,trip_id", limit: 50 }
      );
      evidence.missingConsentTotal = missingConsent.length;
      if (missingConsent.length) {
        const tripIds = distinctStrings(missingConsent.map((row) => row.trip_id)).slice(0, 10);
        evidence.missingConsentTrips = tripIds;
        problems.push(`${missingConsent.length} submission(s) missing the consent flag`);
        escalations.push({
          lane,
          evidence: { missingConsentCount: missingConsent.length, tripIds },
          causeClass: "consent-integrity-breach",
          humanAction:
            `Dylan: ${missingConsent.length} library submission(s) have no consent flag (trips: ${tripIds.join(", ") || "n/a"}). ` +
            "Do NOT assume consent — inspect how the flag was nulled, then restore the correct value with Junel's explicit direction. " +
            "Only rows the traveler approved may feed the patterns.",
        });
      }

      // 4. Provenance completeness on item verdicts.
      const verdicts = await db.table(LIBRARY_VERDICTS_TABLE).rows([], {
        columns: "id,submission_id,source,booking_proven",
        limit: 500,
      });
      const missingProvenance = verdicts.filter((row) => {
        const source = typeof row.source === "string" ? row.source.trim() : "";
        return !source || row.booking_proven === null || row.booking_proven === undefined;
      });
      evidence.verdictCount = verdicts.length;
      evidence.missingProvenanceTotal = missingProvenance.length;
      if (missingProvenance.length) {
        problems.push(`${missingProvenance.length} item verdict(s) missing provenance stamps`);
      }
    }

    // ── 5. Ask funnel evidence (30-day window) ──
    const windowIso = new Date(now.getTime() - ASK_WINDOW_DAYS * 86_400_000).toISOString();
    if (db.tableMissing(LIBRARY_EMAIL_LOGS_TABLE)) {
      evidence.askFunnel = { note: "roamly_email_logs unreadable — funnel evidence unavailable" };
    } else {
      const sends = await db.table(LIBRARY_EMAIL_LOGS_TABLE).rows(
        [
          { column: "status", op: "in", value: ["sent", "captured"] },
          { column: "created_at", op: "gte", value: windowIso },
        ],
        { columns: "id,idempotency_key,created_at", limit: 5000 }
      );
      const askedTrips = distinctStrings(
        sends
          .map((row) => (typeof row.idempotency_key === "string" ? row.idempotency_key : ""))
          .filter((key) => key.startsWith(POST_TRIP_ASK_PREFIX))
          .map((key) => key.slice(POST_TRIP_ASK_PREFIX.length))
      );
      let feedbackAnswers = -1;
      let shareAnswers = -1;
      if (!db.tableMissing(LIBRARY_FEEDBACK_TABLE)) {
        const feedback = await db.table(LIBRARY_FEEDBACK_TABLE).rows(
          [
            { column: "feedback_type", op: "eq", value: "post_trip" },
            { column: "created_at", op: "gte", value: windowIso },
          ],
          { columns: "trip_id", limit: 5000 }
        );
        feedbackAnswers = distinctStrings(feedback.map((row) => row.trip_id)).length;
      }
      if (frontDoorPresent) {
        const shares = await db.table(LIBRARY_SUBMISSIONS_TABLE).rows(
          [{ column: "created_at", op: "gte", value: windowIso }],
          { columns: "trip_id", limit: 2000 }
        );
        shareAnswers = distinctStrings(shares.map((row) => row.trip_id)).length;
      }
      evidence.askFunnel = {
        windowDays: ASK_WINDOW_DAYS,
        asksSent: askedTrips.length,
        feedbackAnswers,
        shareAnswers,
        note: "answers lag asks; evidence only, no verdict",
      };
    }

    // ── 6. Suggestion keep-rate (Concierge adapter) ──
    if (deps.suggestions) {
      const retireCandidates = deps.suggestions
        .filter(
          (entry) =>
            typeof entry.dropped === "number" &&
            typeof entry.kept === "number" &&
            entry.dropped >= SUGGESTION_RETIRE_DROPS &&
            entry.kept === 0
        )
        .map((entry) => ({ suggestionId: entry.suggestionId, label: entry.label, dropped: entry.dropped }));
      evidence.suggestionKeepRate = {
        tracked: deps.suggestions.length,
        retireCandidates,
        note: "retire candidates are evidence only — retiring is a human/Concierge-side decision",
      };
    } else {
      evidence.suggestionKeepRate = {
        note: "no suggestion log attached — Concierge not wired yet; retire-candidate scan skipped",
      };
    }

    const down = belowFloor.length > 0 || (evidence.missingConsentTotal as number) > 0;
    if (down) {
      if (belowFloor.length) {
        escalations.push({
          lane,
          evidence: { belowFloorKeys: belowFloor.slice(0, 10), belowFloorTotal: belowFloor.length },
          causeClass: "publishability-breach",
          humanAction:
            `Dylan: ${belowFloor.length} stored pattern(s) sit below the ${PUBLISHABLE_MIN_TRIPS}-trip publish floor ` +
            `(${belowFloor.slice(0, 5).join("; ")}). The writer filters these before saving, so inspect the aggregation job; ` +
            "remove the unpublishable rows deliberately — do not let them teach the Concierge.",
        });
      }
      return {
        check: { lane, status: "down", summary: `library health down: ${problems.join("; ")}`, evidence },
        escalations,
      };
    }
    if (problems.length) {
      return {
        check: { lane, status: "degraded", summary: `library needs attention: ${problems.join("; ")}`, evidence },
        escalations,
      };
    }
    return {
      check: {
        lane,
        status: "healthy",
        summary: `library healthy: ${patternCount} patterns above the publish floor, consent + provenance intact`,
        evidence,
      },
      escalations,
    };
  } catch (error) {
    return {
      check: {
        lane,
        status: "degraded",
        summary: `check failed softly: ${error instanceof Error ? error.message : String(error)}`,
        evidence: { error: true },
      },
      escalations: [],
    };
  }
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

  // Library health runs before the deploy doctor so the doctor sees its
  // status when comparing this run's lanes against the previous run.
  const libraryHealth = await libraryHealthCheck(deps);
  checks.push(libraryHealth.check);
  escalations.push(...libraryHealth.escalations);

  // Deploy doctor runs last: it compares this run's lanes against the
  // previous run's deterministic_check evidence rows and the observed
  // build stamp.
  const deployDoctor = await deployDoctorCheck(deps, checks);
  checks.push(deployDoctor.check);
  if (deployDoctor.escalation) {
    escalations.push({
      lane: "deploy_doctor",
      evidence: deployDoctor.check.evidence,
      causeClass: deployDoctor.escalation.causeClass,
      humanAction: deployDoctor.escalation.humanAction,
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
