import type { SupabaseClient } from "@supabase/supabase-js";
import { getRoamlySupportEmail, sendRoamlyEmail, type SendRoamlyEmailResult } from "@/lib/roamly/email";
import { renderEmailBodyCopy, renderRoamlyEmailShell } from "@/lib/roamly/emailTemplates";

type OwnerAlertIncident = {
  id: string;
  severity: string;
  subsystem: string;
  event_code: string;
  status: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  deployment_id?: string | null;
  commit_sha?: string | null;
  latest_safe_metadata?: Record<string, unknown> | null;
  owner_alert_generation: number;
};

const OWNER_ALERT_SEVERITIES = new Set(["critical", "high"]);
const SAFE_RENDER_KEYS = new Set(["failure_class", "endpoint", "job_type", "provider", "operation", "retryable", "attempt_count", "http_status", "stage", "recovery_reason", "source"]);

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeMetadata(metadata: Record<string, unknown> | null | undefined) {
  return Object.entries(metadata || {})
    .filter(([key]) => SAFE_RENDER_KEYS.has(key))
    .map(([key, value]) => `${key}: ${clean(value, 120)}`)
    .filter((value) => !value.endsWith(": "))
    .slice(0, 6);
}

export function ownerAlertSeverityEligible(severity: string, status: string) {
  return status === "open" && OWNER_ALERT_SEVERITIES.has(severity);
}

export function ownerAlertDestination() {
  const destination = clean(process.env.ROAMLY_OWNER_ALERT_EMAIL, 254);
  return destination && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination) ? destination : null;
}

export function buildOwnerAlertEmail(incident: OwnerAlertIncident) {
  const severity = clean(incident.severity, 16).toUpperCase();
  const subsystem = clean(incident.subsystem, 40);
  const eventCode = clean(incident.event_code, 80);
  const metadata = safeMetadata(incident.latest_safe_metadata);
  const body = [
    `Severity: ${severity}`,
    `Subsystem: ${subsystem}`,
    `Issue: ${eventCode}`,
    `First seen: ${clean(incident.first_seen_at, 40)}`,
    `Last seen: ${clean(incident.last_seen_at, 40)}`,
    `Occurrences: ${Number.isFinite(incident.occurrence_count) ? incident.occurrence_count : 0}`,
    incident.deployment_id ? `Deployment: ${clean(incident.deployment_id, 120)}` : "",
    incident.commit_sha ? `Commit: ${clean(incident.commit_sha, 80)}` : "",
    `Incident ID: ${clean(incident.id, 80)}`,
    metadata.length ? `Safe context: ${metadata.join("; ")}` : "",
    "What Roamly did: Recorded the incident and reserved one alert for this occurrence.",
    "Owner action: Review the incident if the failure persists."
  ].filter(Boolean).join("\n\n");
  return renderRoamlyEmailShell({
    subject: `[Roamly ${severity}] ${subsystem} ${eventCode}`,
    preheader: `${severity} operational incident requires review.`,
    eyebrow: "Operational alert",
    title: `Roamly ${severity} incident`,
    intro: "A production incident has been recorded.",
    bodyHtml: renderEmailBodyCopy(body),
    bodyText: body,
    supportEmail: getRoamlySupportEmail()
  });
}

export async function deliverOwnerOperationalAlert(params: {
  supabase: SupabaseClient;
  incident: OwnerAlertIncident;
  sendEmail?: typeof sendRoamlyEmail;
}) {
  if (!ownerAlertSeverityEligible(params.incident.severity, params.incident.status)) return { ok: true as const, sent: false as const, reason: "NOT_ELIGIBLE" as const };
  const destination = ownerAlertDestination();
  if (!destination) {
    console.warn("[Roamly owner alert] destination is not configured");
    return { ok: true as const, sent: false as const, reason: "DESTINATION_UNAVAILABLE" as const };
  }

  let claimResult: { data: unknown; error: { message: string } | null };
  try {
    claimResult = await params.supabase.rpc("roamly_claim_operational_incident_owner_alert", {
      p_incident_id: params.incident.id,
      p_expected_generation: params.incident.owner_alert_generation
    });
  } catch {
    claimResult = { data: null, error: { message: "claim_failed" } };
  }
  const claim = Array.isArray(claimResult.data) ? claimResult.data[0] : claimResult.data;
  if (claimResult.error || !claim?.claimed || !claim.claim_token) return { ok: true as const, sent: false as const, reason: claimResult.error ? "CLAIM_FAILED" as const : "NOT_CLAIMED" as const };

  const rendered = buildOwnerAlertEmail(params.incident);
  let sent: SendRoamlyEmailResult;
  try {
    sent = await (params.sendEmail || sendRoamlyEmail)({
      to: destination,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `owner-alert:${params.incident.id}:${params.incident.owner_alert_generation}`,
      metadata: { purpose: "operational_owner_alert", subsystem: params.incident.subsystem, severity: params.incident.severity }
    });
  } catch {
    console.warn("[Roamly owner alert] delivery failed", { incidentId: params.incident.id, generation: params.incident.owner_alert_generation });
    return { ok: true as const, sent: false as const, reason: "DELIVERY_FAILED" as const };
  }
  if (!sent.ok) {
    console.warn("[Roamly owner alert] delivery was not accepted", { incidentId: params.incident.id, generation: params.incident.owner_alert_generation, provider: sent.provider });
    return { ok: true as const, sent: false as const, reason: sent.provider === "smtp" ? "UNCERTAIN_ACCEPTANCE" as const : "DELIVERY_FAILED" as const };
  }

  const marked = await params.supabase
    .from("roamly_operational_incidents")
    .update({ owner_alert_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", params.incident.id)
    .eq("status", "open")
    .eq("owner_alert_generation", params.incident.owner_alert_generation)
    .eq("owner_alert_claimed_generation", params.incident.owner_alert_generation)
    .eq("owner_alert_claim_token", claim.claim_token)
    .is("owner_alert_sent_at", null)
    .select("id")
    .maybeSingle();
  if (marked.error || !marked.data) {
    console.warn("[Roamly owner alert] sent state could not be persisted", { incidentId: params.incident.id, generation: params.incident.owner_alert_generation });
    return { ok: true as const, sent: true as const, reason: "SENT_STATE_UNAVAILABLE" as const };
  }
  return { ok: true as const, sent: true as const, reason: "SENT" as const };
}
