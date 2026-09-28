import { createHash } from "node:crypto";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { adrianTriage, type AdrianDecision } from "./adrianLucaOrchestration.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { OperationsScheduler, type AutonomyLevel, type OperationsPriority, type OperationsRisk } from "./opsControlPlane.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { routeSpecialistSignal, type SpecialistId, type SpecialistSignalSource } from "./specialistOrganization.ts";

export const SIGNAL_SOURCES: readonly SpecialistSignalSource[] = ["deterministic_check", "operational_incident", "failed_job", "schedule"];
export const SIGNAL_COOLDOWN_CLASSES = {
  deterministic_failure: 300,
  operational_incident: 900,
  scheduled_sweep: 86_400,
  recovery: 300
} as const;
export const SIGNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SIGNAL_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type SignalEnvelope = {
  signalId: string;
  signalType: string;
  source: SpecialistSignalSource;
  observedAt: string;
  subsystem: string;
  severity: OperationsRisk;
  safeMetadata: Record<string, string | number | boolean>;
  dedupeKey: string;
  cooldownClass: keyof typeof SIGNAL_COOLDOWN_CLASSES;
  suggestedSpecialist: SpecialistId | null;
  requiredAuthority: AutonomyLevel;
  evidenceReference: string | null;
  expiresAt: string;
  correlationKey: string | null;
  priority: OperationsPriority;
};

type RawSignal = Partial<Omit<SignalEnvelope, "suggestedSpecialist">> & {
  suggestedSpecialist?: string | null;
};

export type SignalNormalizationResult =
  | { ok: true; signal: SignalEnvelope }
  | { ok: false; error: string };

const SAFE_SIGNAL_KEYS = new Set(["failure_class", "endpoint", "job_type", "provider", "operation", "retryable", "attempt_count", "http_status", "stage", "source", "check_id", "release_sha"]);
const SENSITIVE_SIGNAL_KEY = /(body|content|cookie|credential|email|gps|latitude|longitude|password|payment|prompt|secret|token|authorization|api[_-]?key|screenshot|location|customer|trip_id|user_id)/i;
const SAFE_CODE = /^[a-z][a-z0-9_.-]{1,79}$/;

function bounded(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

function safeMetadata(input: unknown): { ok: true; value: Record<string, string | number | boolean> } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "SIGNAL_METADATA_OBJECT_REQUIRED" };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 12) return { ok: false, error: "SIGNAL_METADATA_TOO_LARGE" };
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!SAFE_SIGNAL_KEYS.has(key) || SENSITIVE_SIGNAL_KEY.test(key) || key.length > 40) return { ok: false, error: "SIGNAL_METADATA_KEY_REJECTED" };
    if (typeof value === "string" && value.length <= 120) output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean") output[key] = value;
    else return { ok: false, error: "SIGNAL_METADATA_VALUE_REJECTED" };
  }
  if (JSON.stringify(output).length > 1200) return { ok: false, error: "SIGNAL_METADATA_TOO_LARGE" };
  return { ok: true, value: output };
}

function parseTime(value: unknown) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function digest(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function normalizeOperationsSignal(input: RawSignal, now = Date.now()): SignalNormalizationResult {
  const signalId = bounded(input.signalId, 120);
  const signalType = bounded(input.signalType, 80);
  const source = input.source;
  const subsystem = bounded(input.subsystem, 80);
  const observedAt = parseTime(input.observedAt);
  const requiredAuthority = input.requiredAuthority || "LEVEL_1_OBSERVE";
  const cooldownClass = input.cooldownClass || "deterministic_failure";
  const priority = input.priority || "normal";
  const severity = input.severity || "low";
  if (!signalId || !signalType || !subsystem || !observedAt || !source || !SIGNAL_SOURCES.includes(source) || !SAFE_CODE.test(signalType)) return { ok: false, error: "SIGNAL_SHAPE_INVALID" };
  if (observedAt > now + SIGNAL_MAX_FUTURE_SKEW_MS || observedAt < now - SIGNAL_MAX_AGE_MS) return { ok: false, error: "SIGNAL_STALE" };
  if (!["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE"].includes(requiredAuthority)) return { ok: false, error: "SIGNAL_AUTHORITY_INVALID" };
  if (!(cooldownClass in SIGNAL_COOLDOWN_CLASSES) || !["low", "medium", "high", "critical"].includes(severity) || !["critical", "high", "normal", "low"].includes(priority)) return { ok: false, error: "SIGNAL_POLICY_INVALID" };
  const metadata = safeMetadata(input.safeMetadata);
  if (!metadata.ok) return metadata;
  const correlationKey = input.correlationKey === null || input.correlationKey === undefined ? null : bounded(input.correlationKey, 120);
  const evidenceReference = input.evidenceReference === null || input.evidenceReference === undefined ? null : bounded(input.evidenceReference, 160);
  if (input.correlationKey !== undefined && input.correlationKey !== null && !correlationKey) return { ok: false, error: "SIGNAL_CORRELATION_INVALID" };
  if (input.evidenceReference !== undefined && input.evidenceReference !== null && !evidenceReference) return { ok: false, error: "SIGNAL_EVIDENCE_REFERENCE_INVALID" };
  const suggested = routeSpecialistSignal({ code: signalType, subsystem });
  if (input.suggestedSpecialist !== undefined && input.suggestedSpecialist !== null && input.suggestedSpecialist !== suggested) return { ok: false, error: "SIGNAL_SPECIALIST_MISMATCH" };
  const dedupeKey = normalizeKey(input.dedupeKey || `signal:${source}:${signalType}:${subsystem}:${correlationKey || signalId}`);
  if (!dedupeKey || /[@<>]/.test(dedupeKey)) return { ok: false, error: "SIGNAL_DEDUPE_KEY_INVALID" };
  const expiresAt = parseTime(input.expiresAt) || now + SIGNAL_MAX_AGE_MS;
  if (expiresAt <= now || expiresAt > now + SIGNAL_MAX_AGE_MS * 2) return { ok: false, error: "SIGNAL_EXPIRATION_INVALID" };
  return {
    ok: true,
    signal: {
      signalId, signalType, source, observedAt: new Date(observedAt).toISOString(), subsystem,
      severity, safeMetadata: metadata.value, dedupeKey, cooldownClass, suggestedSpecialist: suggested,
      requiredAuthority, evidenceReference, expiresAt: new Date(expiresAt).toISOString(), correlationKey,
      priority
    }
  };
}

export function signalToAdrianInput(signal: SignalEnvelope) {
  return {
    signalId: signal.signalId,
    source: signal.source,
    code: signal.signalType,
    objective: `Process bounded operational signal ${signal.signalType}`,
    subsystem: signal.subsystem,
    specialist: signal.suggestedSpecialist || "",
    requestedAuthority: signal.requiredAuthority,
    priority: signal.priority,
    risk: signal.severity,
    tokenBudget: 0,
    financialBudgetUsd: 0,
    attemptCeiling: 1,
    dependencies: [] as string[],
    dedupeKey: signal.dedupeKey,
    cooldownSeconds: SIGNAL_COOLDOWN_CLASSES[signal.cooldownClass],
    safeMetadata: signal.safeMetadata,
    evidenceReference: signal.evidenceReference,
    correlationKey: signal.correlationKey,
    observedAt: signal.observedAt,
    cooldownClass: signal.cooldownClass,
    expiresAt: signal.expiresAt
  } as const;
}

export function triageOperationsSignal(signal: SignalEnvelope, scheduler = new OperationsScheduler(), now = Date.now(), productionObservationOnly = false): { signal: SignalEnvelope; decision: AdrianDecision; suppressed: boolean; reason: string } {
  if (Date.parse(signal.expiresAt) <= now) return { signal, decision: { accepted: false, reason: "SIGNAL_EXPIRED", specialist: null, authorityCeiling: null, ownerApprovalRequired: false, job: null }, suppressed: true, reason: "SIGNAL_EXPIRED" };
  if (!signal.suggestedSpecialist) return { signal, decision: { accepted: false, reason: "AMBIGUOUS_SIGNAL_REQUIRES_REVIEW", specialist: null, authorityCeiling: null, ownerApprovalRequired: false, job: null }, suppressed: true, reason: "AMBIGUOUS_SIGNAL_REQUIRES_REVIEW" };
  if (productionObservationOnly && signal.requiredAuthority !== "LEVEL_1_OBSERVE") return { signal, decision: { accepted: false, reason: "PRODUCTION_OBSERVATION_ONLY", specialist: signal.suggestedSpecialist, authorityCeiling: "LEVEL_1_OBSERVE", ownerApprovalRequired: false, job: null }, suppressed: true, reason: "PRODUCTION_OBSERVATION_ONLY" };
  const decision = adrianTriage(signalToAdrianInput(signal), scheduler, now);
  return { signal, decision, suppressed: !decision.accepted, reason: decision.reason };
}

export const PHASE6_SCHEDULES = [
  { id: "gap_audit_daily", cadence: "17 3 * * *", specialist: "GAP_AUDIT_QA_RELIABILITY", signalType: "schedule.gap_audit.daily", subsystem: "reliability", enabled: false },
  { id: "seo_weekly", cadence: "17 4 * * 1", specialist: "SEO", signalType: "schedule.seo.weekly", subsystem: "seo", enabled: false },
  { id: "security_weekly", cadence: "17 5 * * 0", specialist: "SECURITY_PRIVACY", signalType: "schedule.security.weekly", subsystem: "security", enabled: false }
] as const;

export function scheduleSignal(scheduleId: string, now = Date.now()): SignalNormalizationResult {
  const schedule = PHASE6_SCHEDULES.find((candidate) => candidate.id === scheduleId);
  if (!schedule) return { ok: false, error: "SCHEDULE_NOT_REGISTERED" };
  return normalizeOperationsSignal({
    signalId: `${schedule.id}:${new Date(now).toISOString().slice(0, 10)}`,
    signalType: schedule.signalType,
    source: "schedule",
    observedAt: new Date(now).toISOString(),
    subsystem: schedule.subsystem,
    severity: "low",
    cooldownClass: "scheduled_sweep",
    requiredAuthority: "LEVEL_1_OBSERVE",
    dedupeKey: `schedule:${schedule.id}:${new Date(now).toISOString().slice(0, 10)}`,
    safeMetadata: { source: "phase6_schedule" },
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString()
  }, now);
}

export function signalCorrelationId(signal: SignalEnvelope) {
  return digest([signal.source, signal.signalType, signal.subsystem, signal.correlationKey || signal.dedupeKey]);
}

export function safeSignalSummary(scope: unknown) {
  const signal = (scope as { signal?: Record<string, unknown> } | null)?.signal;
  if (!signal || typeof signal !== "object") return null;
  return {
    observedAt: typeof signal.observedAt === "string" ? signal.observedAt : "Unknown",
    cooldownClass: typeof signal.cooldownClass === "string" ? signal.cooldownClass : "Unknown",
    expiresAt: typeof signal.expiresAt === "string" ? signal.expiresAt : "Unknown",
    dedupeKey: typeof signal.dedupeKey === "string" ? signal.dedupeKey.slice(0, 180) : "Unknown"
  };
}
