import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const OPERATIONAL_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const OPERATIONAL_SUBSYSTEMS = ["auth", "billing", "trip_generation", "gmail", "bookings", "providers", "customer_email", "live_companion", "background_jobs", "security"] as const;
type Severity = typeof OPERATIONAL_SEVERITIES[number];
type Subsystem = typeof OPERATIONAL_SUBSYSTEMS[number];

const SAFE_METADATA_KEYS = new Set([
  "failure_class", "endpoint", "job_type", "provider", "operation", "retryable",
  "attempt_count", "http_status", "stage", "recovery_reason", "source"
]);
const SECRET_KEY = /(password|authorization|cookie|token|secret|api[_-]?key|webhook|card|body|payload|prompt|gps|email)/i;

function boundedString(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

export function sanitizeOperationalMetadata(input: Record<string, unknown> | null | undefined) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input || {}).slice(0, 20)) {
    if (!SAFE_METADATA_KEYS.has(key) || SECRET_KEY.test(key) || key.length > 48) continue;
    if (typeof value === "boolean") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else {
      const safe = boundedString(value);
      if (safe) result[key] = safe;
    }
  }
  const serialized = JSON.stringify(result);
  if (serialized.length <= 2048) return result;
  const bounded: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(result)) {
    bounded[key] = value;
    if (JSON.stringify(bounded).length > 2048) delete bounded[key];
  }
  return bounded;
}

function normalizeFingerprintPart(value: unknown) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "<email>")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

export function operationalFingerprint(params: {
  environment?: string | null;
  subsystem: Subsystem;
  eventCode: string;
  fingerprintParts?: string[];
}) {
  const base = [params.environment || process.env.VERCEL_ENV || process.env.NODE_ENV || "production", params.subsystem, params.eventCode, ...(params.fingerprintParts || [])]
    .map(normalizeFingerprintPart)
    .join("|");
  return createHash("sha256").update(base).digest("hex");
}

export function operationalOpaqueId(parts: unknown[]) {
  return createHash("sha256").update(parts.map(normalizeFingerprintPart).join("|")).digest("hex");
}

function deploymentContext() {
  return {
    environment: boundedString(process.env.VERCEL_ENV || process.env.NODE_ENV || "production", 32),
    deploymentId: boundedString(process.env.VERCEL_DEPLOYMENT_ID, 120),
    commitSha: boundedString(process.env.VERCEL_GIT_COMMIT_SHA, 80)
  };
}

function validEventCode(value: string) {
  return /^[a-z][a-z0-9_.-]{1,79}$/.test(value);
}

export function safeOperationalError(error: unknown) {
  const value = error as { code?: unknown; name?: unknown } | null;
  const code = boundedString(value?.code, 64);
  const name = boundedString(value?.name, 64);
  return { failure_class: code || name || "unknown_error" };
}

export async function recordOperationalEvent(params: {
  supabase?: SupabaseClient | null;
  severity: Severity;
  subsystem: Subsystem;
  eventCode: string;
  fingerprintParts?: string[];
  eventKey?: string;
  occurredAt?: string;
  kind?: "failure" | "recovery";
  correlationId?: string | null;
  safeMetadata?: Record<string, unknown>;
  affectedAccountCount?: number | null;
  affectedTripCount?: number | null;
}) {
  if (!OPERATIONAL_SEVERITIES.includes(params.severity) || !OPERATIONAL_SUBSYSTEMS.includes(params.subsystem) || !validEventCode(params.eventCode)) {
    return { ok: false as const, error: "INVALID_OPERATIONAL_EVENT" };
  }
  const admin = createSupabaseAdminClient() || params.supabase;
  if (!admin) return { ok: false as const, error: "OPERATIONAL_RECORDER_UNAVAILABLE" };
  const context = deploymentContext();
  const eventKey = boundedString(params.eventKey, 180) || randomUUID();
  try {
    const result = await admin.rpc("roamly_record_operational_event", {
      p_event_key: eventKey,
      p_fingerprint: operationalFingerprint({ environment: context.environment, subsystem: params.subsystem, eventCode: params.eventCode, fingerprintParts: params.fingerprintParts }),
      p_environment: context.environment,
      p_severity: params.severity,
      p_subsystem: params.subsystem,
      p_event_code: params.eventCode,
      p_occurred_at: params.occurredAt || new Date().toISOString(),
      p_kind: params.kind || "failure",
      p_correlation_id: boundedString(params.correlationId, 120),
      p_deployment_environment: context.environment,
      p_deployment_id: context.deploymentId,
      p_commit_sha: context.commitSha,
      p_safe_metadata: sanitizeOperationalMetadata(params.safeMetadata),
      p_affected_account_count: Number.isInteger(params.affectedAccountCount) && (params.affectedAccountCount || 0) >= 0 ? params.affectedAccountCount : null,
      p_affected_trip_count: Number.isInteger(params.affectedTripCount) && (params.affectedTripCount || 0) >= 0 ? params.affectedTripCount : null
    });
    if (result.error) {
      console.warn("[Roamly operational] recorder unavailable", { subsystem: params.subsystem, eventCode: params.eventCode });
      return { ok: false as const, error: "OPERATIONAL_RECORD_FAILED" };
    }
    return { ok: true as const, data: Array.isArray(result.data) ? result.data[0] : result.data };
  } catch {
    console.warn("[Roamly operational] recorder unavailable", { subsystem: params.subsystem, eventCode: params.eventCode });
    return { ok: false as const, error: "OPERATIONAL_RECORD_FAILED" };
  }
}

export function recordOperationalRecovery(params: Omit<Parameters<typeof recordOperationalEvent>[0], "kind">) {
  return recordOperationalEvent({ ...params, kind: "recovery" });
}
