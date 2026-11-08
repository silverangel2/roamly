/**
 * ROAMLY KEEPER FAULT MEMORY v1 — the keeper's shared fault memory
 * (Ruflo Lift 2, commissioned by Junel 2026-11-08).
 *
 * Until now the keeper re-derived every diagnosis from live state on every
 * run: the ops ledger stores each run, but in a shape nothing can learn
 * from (truncated summaries, flattened metadata, no pattern key, no fix,
 * no outcome). This module adds the missing store: ONE row per fault
 * pattern in the keeper-owned table `roamly_keeper_fault_memory`
 * (migration 20261108000200), keyed by a deterministic fingerprint built
 * ONLY from closed vocabularies already in the keeper's code:
 *
 *   pattern_key = <lane>:<cause_class>:<signature_class>
 *
 * - lane: the KeeperLane vocabulary (roamlyKeeper.ts).
 * - cause_class: the escalation classes hardcoded in roamlyKeeper.ts, plus
 *   one check-level class per lane for non-healthy checks that produced no
 *   escalation. A new class is added deliberately here, in code — never
 *   derived from raw text.
 * - signature_class: a coarse classifier output, never raw text. Email
 *   faults reuse classifyEmailError (provider-era / permanent / unknown);
 *   deploy faults use sha-changed / expected-mismatch; ids, addresses,
 *   message bodies and raw error strings NEVER enter the key, the
 *   signature, or last_evidence (see flattenFaultEvidence).
 *
 * WRITE PATH: recordKeeperFaultMemory runs in the cron route beside
 * logKeeperRun, fail-soft with the same contract (a memory failure never
 * fails a run; until Junel applies the migration by hand, every call
 * reports tableMissing and the run proceeds exactly as today).
 *
 * READ PATH (v1): a point lookup by pattern_key before the whitelisted
 * repair (faultRecallKeysForEmailCheck + recallKeeperFaultMemory in
 * runKeeperSuite), attached to escalation TEXT only. CHARTER GUARDRAIL:
 * memory never gates, skips, or alters a whitelisted repair in v1 — it
 * informs the human reading the escalation. Any behavior change is a
 * charter amendment for Junel.
 *
 * OUTCOME ATTRIBUTION (conservative by design): a fault that clears
 * without the keeper's own repair is recorded `cleared_unattributed`,
 * never credited to a fix; `verified_fixed` is reserved for a pattern
 * whose lane is healthy on the run after the keeper's own redrive;
 * escalated (human-action) patterns resolve with their outcome left
 * uncredited. The memory must never learn a false lesson.
 *
 * Residency: this store lives in Roamly's own Supabase, written and read
 * only by Roamly's keeper. No shared store with RI or Sophie, ever.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KeeperCheckResult,
  KeeperDb,
  KeeperEmailErrorClass,
  KeeperEscalation,
  KeeperLane,
  KeeperSuiteReport,
} from "@/lib/roamly/roamlyKeeper";

// ── Constants ───────────────────────────────────────────────────────────────

export const FAULT_MEMORY_TABLE = "roamly_keeper_fault_memory";
export const FAULT_MEMORY_RETENTION_DAYS = 180;

const FAULT_MEMORY_COLUMNS =
  "id,pattern_key,lane,cause_class,signature,first_seen_at,last_seen_at,occurrence_count,recurrence_count,consecutive_failures,status,fix_kind,fix_summary,fix_outcome,last_job_id,last_evidence,resolved_at,created_at,updated_at";

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Escalation cause classes exactly as hardcoded in roamlyKeeper.ts
 * (repair + deploy doctor + library health + repairs-disabled). Adding a
 * class here is a deliberate vocabulary change, reviewed like any other.
 */
export const KEEPER_FAULT_ESCALATION_CAUSE_CLASSES = [
  "sender-not-ready",
  "permanent-recipient-failure",
  "retry-limit-exhausted",
  "repair-failed-twice",
  "write-guard-refusal",
  "repair-write-failed",
  "repairs-disabled",
  "deploy-suspect",
  "expected-build-not-live",
  "consent-integrity-breach",
  "publishability-breach",
] as const;

/** Check-level cause class per lane, for a non-healthy check that produced
 *  no escalation of its own in the same run. */
export const KEEPER_FAULT_CHECK_CAUSE_CLASS: Record<KeeperLane, string> = {
  completion_email_queue: "queue-stuck",
  social_autopost: "autopost-stalled",
  fyi_upsell_hygiene: "stale-pending-moments",
  booking_audit_leftovers: "audit-leftovers-stale",
  config_flags: "config-not-ready",
  deploy_doctor: "deploy-drift",
  library_health: "library-unhealthy",
};

const EMAIL_ERROR_CLASS_ORDER: KeeperEmailErrorClass[] = ["provider-era", "permanent", "unknown"];

// ── Types ───────────────────────────────────────────────────────────────────

export type KeeperFaultStatus = "open" | "repairing" | "resolved" | "escalated" | "retired";

export type KeeperFaultOutcome =
  | "verified_fixed"
  | "failed"
  | "partial"
  | "cleared_unattributed"
  | "unknown";

export type KeeperFaultMemoryRow = {
  id: string;
  pattern_key: string;
  lane: KeeperLane;
  cause_class: string;
  signature: Record<string, string | number | boolean>;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  recurrence_count: number;
  consecutive_failures: number;
  status: KeeperFaultStatus;
  fix_kind: string | null;
  fix_summary: string | null;
  fix_outcome: KeeperFaultOutcome | null;
  last_job_id: string | null;
  last_evidence: Record<string, string | number | boolean>;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

/** One fault pattern derived from a single run's report (pre-storage). */
export type KeeperFaultPattern = {
  patternKey: string;
  lane: KeeperLane;
  causeClass: string;
  signatureClass: string;
  signature: Record<string, string | number | boolean>;
  lastEvidence: Record<string, string | number | boolean>;
  fromEscalation: boolean;
  /** Preset fix attribution carried by the pattern itself (today only
   *  repair-failed-twice, whose outcome is known when it fires). */
  fixKind: string | null;
  fixSummary: string | null;
  fixOutcome: KeeperFaultOutcome | null;
};

export type KeeperFaultMemoryCounters = {
  known: number;
  seenBefore: number;
  recurring: number;
  recorded: number;
  verifiedFixed: number;
  clearedUnattributed: number;
  retired: number;
};

export const EMPTY_FAULT_MEMORY_COUNTERS: KeeperFaultMemoryCounters = {
  known: 0,
  seenBefore: 0,
  recurring: 0,
  recorded: 0,
  verifiedFixed: 0,
  clearedUnattributed: 0,
  retired: 0,
};

export type RecordKeeperFaultMemoryResult = {
  ok: boolean;
  tableMissing: boolean;
  counters: KeeperFaultMemoryCounters;
  /** The report to log: identical to the input unless ok, in which case
   *  its summary carries the fault-memory counters line (Sophie World). */
  report: KeeperSuiteReport;
};

type ClassifyEmailError = (errorText: unknown) => KeeperEmailErrorClass;

// ── Pattern key + signature derivation ──────────────────────────────────────

export function keeperFaultPatternKey(lane: KeeperLane, causeClass: string, signatureClass: string): string {
  return `${lane}:${causeClass}:${signatureClass}`;
}

export function countBucket(count: number): string {
  if (count <= 2) return "1-2";
  if (count <= 9) return "3-9";
  return "10+";
}

/** Dominant email error class from the email check's evidence counts.
 *  Deterministic: fixed class order breaks ties. */
export function dominantEmailErrorClass(evidence: Record<string, unknown>): KeeperEmailErrorClass {
  const classes = evidence.errorClasses;
  if (!classes || typeof classes !== "object" || Array.isArray(classes)) return "unknown";
  const counts = classes as Record<string, unknown>;
  let best: KeeperEmailErrorClass = "unknown";
  let bestCount = -1;
  for (const cls of EMAIL_ERROR_CLASS_ORDER) {
    const n = typeof counts[cls] === "number" ? (counts[cls] as number) : 0;
    if (n > bestCount) {
      best = cls;
      bestCount = n;
    }
  }
  return best;
}

function checkSignatureClass(check: KeeperCheckResult): string {
  if (check.lane === "completion_email_queue") return dominantEmailErrorClass(check.evidence);
  if (check.lane === "deploy_doctor") {
    if (check.evidence.changed === true) return "sha-changed";
    if (typeof check.evidence.expectedSha === "string" && check.evidence.expectedSha) return "expected-mismatch";
    return check.status;
  }
  return check.status;
}

/**
 * Candidate signature classes for an escalation, most specific first.
 * Email-lane classes are pinned by construction of the repair passes:
 * only provider-era rows can reach the redrive outcomes (permanent and
 * unknown rows are skipped before eligibility), so retry-limit /
 * repair-failed-twice / write-guard / repair-write-failed are
 * provider-era patterns. repairs-disabled matches any queue class (the
 * caller falls back across the recalled set).
 */
export function faultSignatureClassesForEscalation(
  esc: KeeperEscalation,
  classify: ClassifyEmailError
): string[] {
  if (esc.lane === "completion_email_queue") {
    switch (esc.causeClass) {
      case "permanent-recipient-failure":
        return ["permanent"];
      case "sender-not-ready":
        return ["smtp-not-ready"];
      case "retry-limit-exhausted":
      case "repair-failed-twice":
      case "write-guard-refusal":
      case "repair-write-failed":
        return ["provider-era"];
      case "repairs-disabled":
        return [...EMAIL_ERROR_CLASS_ORDER];
      default:
        return [typeof esc.evidence.lastError === "string" ? classify(esc.evidence.lastError) : "unknown"];
    }
  }
  if (esc.lane === "deploy_doctor") {
    if (esc.causeClass === "expected-build-not-live") return ["expected-mismatch"];
    if (esc.causeClass === "deploy-suspect") return ["sha-changed"];
    return ["general"];
  }
  if (esc.lane === "library_health") {
    if (esc.causeClass === "consent-integrity-breach") return ["consent-missing"];
    if (esc.causeClass === "publishability-breach") return ["below-publish-floor"];
    return ["general"];
  }
  return ["general"];
}

// ── Safe evidence flattening ────────────────────────────────────────────────

/**
 * Flatten run evidence into safe primitives for the memory store. STRICTER
 * than the ops ledger's flatMeta by design: arrays collapse to counts
 * (their contents are row ids), raw error strings and id-bearing string
 * fields are dropped entirely — the derived class is what memory keeps.
 * Never: emails, names, trip ids, message bodies, raw error text.
 */
const FAULT_EVIDENCE_DROP_KEYS = new Set([
  "lasterror",
  "error",
  "tripid",
  "tripids",
  "stuckids",
  "staleids",
  "stuckjobids",
  "missingconsenttrips",
  "email",
  "name",
]);

export function flattenFaultEvidence(
  evidence: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(evidence)) {
    const lower = key.toLowerCase();
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      if (FAULT_EVIDENCE_DROP_KEYS.has(lower) || lower.endsWith("id")) continue;
      out[key] = value.slice(0, 200);
    } else if (Array.isArray(value)) {
      out[`${key}Count`] = value.length;
    } else if (value && typeof value === "object") {
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof subValue === "number" && !/id/i.test(sub)) out[`${key}_${sub}`] = subValue;
      }
    }
  }
  return out;
}

/** The lane's primary fault count, for the signature's count bucket. */
function primaryCount(check: KeeperCheckResult): number | null {
  const e = check.evidence;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (check.lane) {
    case "completion_email_queue":
      return num(e.stuckCount);
    case "social_autopost": {
      const byStatus = e.byStatus;
      if (byStatus && typeof byStatus === "object" && !Array.isArray(byStatus)) {
        const rec = byStatus as Record<string, unknown>;
        return (num(rec.retrying) ?? 0) + (num(rec.failed) ?? 0);
      }
      return null;
    }
    case "fyi_upsell_hygiene":
      return num(e.stalePendingMoments);
    case "booking_audit_leftovers":
      return (num(e.staleOpenDecisions) ?? 0) + (num(e.stuckRunningJobs) ?? 0);
    case "config_flags":
      return Array.isArray(e.notReady) ? e.notReady.length : null;
    case "deploy_doctor":
      return num(e.consecutiveMismatches);
    case "library_health":
      return num(e.belowPublishFloorTotal) ?? num(e.missingConsentTotal);
    default:
      return null;
  }
}

// ── Derivation: report → patterns ───────────────────────────────────────────

/**
 * Derive this run's fault patterns: one per non-healthy check, one per
 * escalation, deduped by pattern key (occurrence_count counts RUNS in
 * which the pattern appeared; within-run multiplicity stays in evidence).
 * Pure and deterministic — same report, same patterns.
 */
export function deriveKeeperFaultPatterns(
  report: KeeperSuiteReport,
  classify: ClassifyEmailError
): KeeperFaultPattern[] {
  const byKey = new Map<string, KeeperFaultPattern>();

  for (const check of report.checks) {
    if (check.status === "healthy") continue;
    const causeClass = KEEPER_FAULT_CHECK_CAUSE_CLASS[check.lane];
    const signatureClass = checkSignatureClass(check);
    const signature: Record<string, string | number | boolean> = {
      signatureClass,
      status: check.status,
    };
    if (check.lane === "completion_email_queue") signature.errorClass = signatureClass;
    if (check.lane === "deploy_doctor" && typeof check.evidence.sha === "string")
      signature.shaPrefix = check.evidence.sha.slice(0, 12);
    const count = primaryCount(check);
    if (count !== null) signature.countBucket = countBucket(count);
    const patternKey = keeperFaultPatternKey(check.lane, causeClass, signatureClass);
    byKey.set(patternKey, {
      patternKey,
      lane: check.lane,
      causeClass,
      signatureClass,
      signature,
      lastEvidence: flattenFaultEvidence(check.evidence),
      fromEscalation: false,
      fixKind: null,
      fixSummary: null,
      fixOutcome: null,
    });
  }

  for (const esc of report.escalations) {
    const signatureClass = faultSignatureClassesForEscalation(esc, classify)[0];
    const signature: Record<string, string | number | boolean> = { signatureClass };
    if (esc.lane === "completion_email_queue" && EMAIL_ERROR_CLASS_ORDER.includes(signatureClass as KeeperEmailErrorClass))
      signature.errorClass = signatureClass;
    if (esc.lane === "deploy_doctor" && typeof esc.evidence.sha === "string")
      signature.shaPrefix = esc.evidence.sha.slice(0, 12);
    const patternKey = keeperFaultPatternKey(esc.lane, esc.causeClass, signatureClass);
    const failedTwice = esc.causeClass === "repair-failed-twice";
    byKey.set(patternKey, {
      patternKey,
      lane: esc.lane,
      causeClass: esc.causeClass,
      signatureClass,
      signature,
      lastEvidence: flattenFaultEvidence(esc.evidence),
      fromEscalation: true,
      fixKind: failedTwice ? "keeper_redrive" : null,
      fixSummary: failedTwice
        ? "Keeper re-drive reached the per-trip cap and the fault persisted; auto-retry stopped."
        : null,
      fixOutcome: failedTwice ? "failed" : null,
    });
  }

  return [...byKey.values()];
}

// ── Recall (read path, v1: escalation text only) ────────────────────────────

/** Pattern keys to recall before the whitelisted repair: the queue-stuck
 *  pattern for each email error class present in this run's email check. */
export function faultRecallKeysForEmailCheck(check: KeeperCheckResult): string[] {
  if (check.lane !== "completion_email_queue" || check.status === "healthy") return [];
  const classes = check.evidence.errorClasses;
  if (!classes || typeof classes !== "object" || Array.isArray(classes)) return [];
  const counts = classes as Record<string, unknown>;
  return EMAIL_ERROR_CLASS_ORDER.filter((cls) => typeof counts[cls] === "number" && (counts[cls] as number) > 0).map(
    (cls) => keeperFaultPatternKey(check.lane, KEEPER_FAULT_CHECK_CAUSE_CLASS[check.lane], cls)
  );
}

/** Point lookup by pattern_key through the keeper's KeeperDb seam.
 *  Fail-soft: any error (including the table not existing yet) recalls
 *  nothing — the run proceeds exactly as it did before memory existed. */
export async function recallKeeperFaultMemory(
  db: KeeperDb,
  patternKeys: string[]
): Promise<KeeperFaultMemoryRow[]> {
  if (!patternKeys.length) return [];
  try {
    const rows = await db.table(FAULT_MEMORY_TABLE).rows(
      [{ column: "pattern_key", op: "in", value: patternKeys }],
      { columns: FAULT_MEMORY_COLUMNS }
    );
    return rows as unknown as KeeperFaultMemoryRow[];
  } catch {
    return [];
  }
}

/** One honest history line for an escalation, from a recalled row. */
export function formatFaultMemoryHistory(row: KeeperFaultMemoryRow): string {
  let line =
    `Fault memory: pattern ${row.pattern_key} seen in ${row.occurrence_count} keeper run(s) ` +
    `since ${row.first_seen_at.slice(0, 10)} (last: ${row.last_seen_at.slice(0, 10)})`;
  if (row.recurrence_count > 0) line += `; recurred ${row.recurrence_count}x after being resolved`;
  if (row.consecutive_failures > 1) line += `; ${row.consecutive_failures} consecutive failing runs`;
  if (row.fix_kind) line += `; fix attempted (${row.fix_kind}): ${row.fix_outcome ?? "outcome unknown"}`;
  if (row.fix_summary) line += ` — ${row.fix_summary}`;
  return line.slice(0, 400);
}

/**
 * Attach recalled history to matching escalation text. TEXT ONLY — this
 * function receives copies of nothing and changes nothing but the
 * humanAction strings of email-lane escalations whose signature class
 * matches a recalled queue pattern. Repair inputs, repair decisions, and
 * every other escalation field are untouched.
 */
export function attachFaultMemoryHistory(
  escalations: KeeperEscalation[],
  recalled: KeeperFaultMemoryRow[],
  classify: ClassifyEmailError
): number {
  if (!recalled.length) return 0;
  const bySignature = new Map<string, KeeperFaultMemoryRow>();
  for (const row of recalled) {
    const sig = row.pattern_key.split(":")[2] ?? "";
    if (sig && !bySignature.has(sig)) bySignature.set(sig, row);
  }
  let attached = 0;
  for (const esc of escalations) {
    if (esc.lane !== "completion_email_queue") continue;
    const candidates = faultSignatureClassesForEscalation(esc, classify);
    const row = candidates.map((sig) => bySignature.get(sig)).find((r) => r !== undefined);
    if (!row) continue;
    esc.humanAction = `${esc.humanAction}\n${formatFaultMemoryHistory(row)}`;
    attached += 1;
  }
  return attached;
}

// ── Sophie World board line ─────────────────────────────────────────────────

export function keeperFaultMemoryBoardLine(counters: KeeperFaultMemoryCounters): string {
  return (
    `fault memory: ${counters.known} patterns known, ${counters.seenBefore} seen before, ` +
    `${counters.recurring} recurring, ${counters.clearedUnattributed} cleared_unattributed, ` +
    `${counters.verifiedFixed} verified_fixed`
  );
}

// ── Write path (record + retire) ────────────────────────────────────────────

/**
 * Structural view of the supabase-js chains this module uses — the same
 * untyped-client convention as lib/roamly/keeperStore.ts. The real client
 * is cast to this shape at the call sites below.
 */
type FaultMemoryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

type FaultMemoryQuery = PromiseLike<FaultMemoryResult> & {
  eq: (column: string, value: unknown) => FaultMemoryQuery;
  in: (column: string, values: unknown[]) => FaultMemoryQuery;
  lt: (column: string, value: unknown) => FaultMemoryQuery;
  select: (columns: string, options?: { count: "exact"; head: boolean }) => FaultMemoryQuery;
};

type FaultMemoryTable = {
  select: (columns: string, options?: { count: "exact"; head: boolean }) => FaultMemoryQuery;
  upsert: (rows: Record<string, unknown>[], options: { onConflict: string }) => FaultMemoryQuery;
  update: (patch: Record<string, unknown>) => FaultMemoryQuery;
};

function faultTable(admin: SupabaseClient): FaultMemoryTable {
  return admin.from(FAULT_MEMORY_TABLE) as unknown as FaultMemoryTable;
}

function isFaultTableMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "42P01" || code === "PGRST205") return true;
  const message = String((error as { message?: unknown } | null)?.message || error || "");
  return /does not exist|relation .* not found|42P01/i.test(message);
}

function asFaultRows(data: unknown): KeeperFaultMemoryRow[] {
  if (!Array.isArray(data)) return [];
  return data as KeeperFaultMemoryRow[];
}

async function selectFaultRowsByKeys(admin: SupabaseClient, keys: string[]): Promise<KeeperFaultMemoryRow[]> {
  const result = await faultTable(admin).select(FAULT_MEMORY_COLUMNS).in("pattern_key", keys);
  if (result.error) throw result.error;
  return asFaultRows(result.data);
}

async function selectOpenFaultRows(admin: SupabaseClient, lane: KeeperLane): Promise<KeeperFaultMemoryRow[]> {
  const result = await faultTable(admin)
    .select(FAULT_MEMORY_COLUMNS)
    .eq("lane", lane)
    .in("status", ["open", "repairing", "escalated"]);
  if (result.error) throw result.error;
  return asFaultRows(result.data);
}

async function countFaultRows(admin: SupabaseClient): Promise<number> {
  const result = await faultTable(admin).select("id", { count: "exact", head: true });
  if (result.error) throw result.error;
  return result.count ?? 0;
}

/**
 * Retirement pass: resolved patterns retire 180 days after resolution
 * (row kept for counts; a recurrence un-retires it via the upsert path).
 * Open/escalated patterns are never auto-retired — they are the site's
 * known-fault list. Throws on store errors; the caller decides fail-soft.
 */
export async function retireResolvedKeeperFaultMemory(
  admin: SupabaseClient,
  nowIso: string
): Promise<number> {
  const cutoff = new Date(Date.parse(nowIso) - FAULT_MEMORY_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await faultTable(admin)
    .update({ status: "retired", updated_at: nowIso })
    .eq("status", "resolved")
    .lt("resolved_at", cutoff)
    .select("id");
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data.length : 0;
}

type FaultRowWrite = Record<string, unknown>;

function rowToWrite(row: KeeperFaultMemoryRow): FaultRowWrite {
  return {
    pattern_key: row.pattern_key,
    lane: row.lane,
    cause_class: row.cause_class,
    signature: row.signature,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    occurrence_count: row.occurrence_count,
    recurrence_count: row.recurrence_count,
    consecutive_failures: row.consecutive_failures,
    status: row.status,
    fix_kind: row.fix_kind,
    fix_summary: row.fix_summary,
    fix_outcome: row.fix_outcome,
    last_job_id: row.last_job_id,
    last_evidence: row.last_evidence,
    resolved_at: row.resolved_at,
    updated_at: row.updated_at,
  };
}

/**
 * Record one completed keeper run into fault memory, beside logKeeperRun
 * in the cron route. Single-writer by design (the route holds the keeper
 * cron lock), so counters are read-modify-write. FAIL-SOFT, mirroring
 * logKeeperRun's contract: any store error returns ok:false and the
 * ORIGINAL report — a memory failure never fails or alters a run.
 */
export async function recordKeeperFaultMemory(
  admin: SupabaseClient,
  report: KeeperSuiteReport,
  classify: ClassifyEmailError
): Promise<RecordKeeperFaultMemoryResult> {
  const jobId = `keeper-${report.runnerId}`;
  const nowIso = report.at;
  try {
    const patterns = deriveKeeperFaultPatterns(report, classify);
    const keys = patterns.map((p) => p.patternKey);
    const existingRows = keys.length ? await selectFaultRowsByKeys(admin, keys) : [];
    const existing = new Map(existingRows.map((r) => [r.pattern_key, r]));

    // A lane "clears" this run only if its check is healthy AND no
    // pattern was derived from it (a healthy check can still carry
    // escalations — library health — and those lanes are not clear).
    const patternLanes = new Set(patterns.map((p) => p.lane));
    const clearLanes = report.checks
      .filter((c) => c.status === "healthy" && !patternLanes.has(c.lane))
      .map((c) => c.lane);
    const openRows: KeeperFaultMemoryRow[] = [];
    for (const lane of clearLanes) openRows.push(...(await selectOpenFaultRows(admin, lane)));

    const writes: FaultRowWrite[] = [];
    let seenBefore = 0;
    let recurring = 0;

    const repairApplied = Boolean(report.repair?.applied && report.repair.redriven.length > 0);
    for (const pattern of patterns) {
      const prev = existing.get(pattern.patternKey);
      if (prev) seenBefore += 1;
      const recurred = Boolean(prev && (prev.status === "resolved" || prev.status === "retired"));
      if (recurred) recurring += 1;
      const pendingFix =
        repairApplied &&
        pattern.lane === "completion_email_queue" &&
        pattern.causeClass === "queue-stuck" &&
        pattern.signatureClass === "provider-era";
      const status: KeeperFaultStatus =
        pattern.fixOutcome === "failed"
          ? "escalated"
          : pendingFix
            ? "repairing"
            : pattern.fromEscalation
              ? "escalated"
              : "open";
      writes.push({
        pattern_key: pattern.patternKey,
        lane: pattern.lane,
        cause_class: pattern.causeClass,
        signature: pattern.signature,
        first_seen_at: prev?.first_seen_at ?? nowIso,
        last_seen_at: nowIso,
        occurrence_count: (prev?.occurrence_count ?? 0) + 1,
        recurrence_count: (prev?.recurrence_count ?? 0) + (recurred ? 1 : 0),
        consecutive_failures: (prev?.consecutive_failures ?? 0) + 1,
        status,
        fix_kind: pattern.fixKind ?? (pendingFix ? "keeper_redrive" : (prev?.fix_kind ?? null)),
        fix_summary:
          pattern.fixSummary ??
          (pendingFix
            ? `Keeper re-drove ${report.repair?.redriven.length ?? 0} stuck completion send(s) this run (retry clock reset); the outcome is decided by the next run's lane state.`
            : (prev?.fix_summary ?? null)),
        fix_outcome: pattern.fixOutcome ?? (prev?.fix_outcome ?? null),
        last_job_id: jobId,
        last_evidence: pattern.lastEvidence,
        resolved_at: null,
        updated_at: nowIso,
      });
    }

    // Outcome write-back for patterns whose lane cleared this run.
    let verifiedFixed = 0;
    let clearedUnattributed = 0;
    const thisRunKeys = new Set(keys);
    for (const row of openRows) {
      if (thisRunKeys.has(row.pattern_key)) continue;
      const write = rowToWrite(row);
      write.status = "resolved";
      write.resolved_at = nowIso;
      write.consecutive_failures = 0;
      write.last_job_id = jobId;
      write.updated_at = nowIso;
      if (row.status === "repairing" && row.fix_kind === "keeper_redrive") {
        // The keeper's own fix was pending and the lane is now healthy:
        // the one outcome that may be credited.
        if (row.fix_outcome !== "failed") {
          write.fix_outcome = "verified_fixed";
          verifiedFixed += 1;
        }
      } else if (row.status === "escalated") {
        // Human-action pattern cleared off-record: resolve it, but the
        // outcome stays uncredited (never teach a false lesson).
      } else if (row.fix_outcome !== "failed") {
        write.fix_outcome = "cleared_unattributed";
        clearedUnattributed += 1;
      }
      writes.push(write);
    }

    if (writes.length) {
      const result = await faultTable(admin).upsert(writes, { onConflict: "pattern_key" }).select("pattern_key");
      if (result.error) throw result.error;
    }

    const retired = await retireResolvedKeeperFaultMemory(admin, nowIso);
    const known = await countFaultRows(admin);
    const counters: KeeperFaultMemoryCounters = {
      known,
      seenBefore,
      recurring,
      recorded: patterns.length,
      verifiedFixed,
      clearedUnattributed,
      retired,
    };
    return {
      ok: true,
      tableMissing: false,
      counters,
      report: { ...report, summary: `${report.summary}; ${keeperFaultMemoryBoardLine(counters)}` },
    };
  } catch (error) {
    return {
      ok: false,
      tableMissing: isFaultTableMissing(error),
      counters: EMPTY_FAULT_MEMORY_COUNTERS,
      report,
    };
  }
}
