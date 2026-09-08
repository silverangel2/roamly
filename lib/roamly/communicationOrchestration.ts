import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  boundedRetryDelaySeconds,
  communicationChannelForPurpose,
  communicationFingerprint,
  communicationLogicalKey,
  isCommunicationStale,
  sanitizeCommunicationMetadata,
  type CommunicationChannel,
  type CommunicationPurpose
} from "@/lib/roamly/communicationPolicy";

export type CommunicationClaimResult = {
  ok: boolean;
  claimed: boolean;
  status: string;
  claimToken: string | null;
  attemptCount: number;
  communicationId?: string | null;
  error?: string;
};

function runtimeContext() {
  return {
    environment: (process.env.VERCEL_ENV || process.env.NODE_ENV || "production").trim().slice(0, 32),
    deploymentId: (process.env.VERCEL_DEPLOYMENT_ID || "").trim().slice(0, 120) || null,
    commitSha: (process.env.VERCEL_GIT_COMMIT_SHA || "").trim().slice(0, 80) || null
  };
}

function writer(client?: SupabaseClient | null) {
  return createSupabaseAdminClient() || client || null;
}

export async function claimCommunication(params: {
  supabase?: SupabaseClient | null;
  userId: string;
  tripId?: string | null;
  purpose: CommunicationPurpose;
  occurrenceKey: string;
  scheduledFor?: string;
  usefulUntil?: string | null;
  metadata?: Record<string, unknown>;
  preferredChannel?: CommunicationChannel;
  now?: Date;
}): Promise<CommunicationClaimResult> {
  const db = writer(params.supabase);
  if (!db) return { ok: false, claimed: false, status: "unavailable", claimToken: null, attemptCount: 0, error: "COMMUNICATION_LEDGER_UNAVAILABLE" };
  const logicalKey = communicationLogicalKey(params);
  const now = params.now || new Date();
  if (isCommunicationStale({ now, usefulUntil: params.usefulUntil })) {
    return { ok: false, claimed: false, status: "suppressed", claimToken: null, attemptCount: 0, error: "COMMUNICATION_STALE" };
  }
  const context = runtimeContext();
  try {
    const result = await db.rpc("roamly_claim_communication", {
      p_user_id: params.userId,
      p_trip_id: params.tripId || null,
      p_purpose: params.purpose,
      p_occurrence_key: params.occurrenceKey,
      p_logical_key: logicalKey,
      p_preferred_channel: params.preferredChannel || communicationChannelForPurpose(params.purpose),
      p_scheduled_for: params.scheduledFor || now.toISOString(),
      p_useful_until: params.usefulUntil || null,
      p_metadata: sanitizeCommunicationMetadata(params.metadata),
      p_environment: context.environment,
      p_deployment_id: context.deploymentId,
      p_commit_sha: context.commitSha,
      p_now: now.toISOString()
    });
    if (result.error) return { ok: false, claimed: false, status: "failed", claimToken: null, attemptCount: 0, error: "COMMUNICATION_CLAIM_FAILED" };
    const row = (Array.isArray(result.data) ? result.data[0] : result.data) as Record<string, unknown> | null;
    return {
      ok: true,
      claimed: row?.claimed === true,
      status: typeof row?.status === "string" ? row.status : "unknown",
      claimToken: typeof row?.claim_token === "string" ? row.claim_token : null,
      attemptCount: typeof row?.attempt_count === "number" ? row.attempt_count : 0,
      communicationId: typeof row?.communication_id === "string" ? row.communication_id : null
    };
  } catch {
    return { ok: false, claimed: false, status: "failed", claimToken: null, attemptCount: 0, error: "COMMUNICATION_CLAIM_FAILED" };
  }
}

export async function completeCommunication(params: { supabase?: SupabaseClient | null; communicationId: string; claimToken: string; provider?: string | null; providerMessageId?: string | null }) {
  const db = writer(params.supabase);
  if (!db) return false;
  const result = await db.rpc("roamly_complete_communication", {
    p_communication_id: params.communicationId,
    p_claim_token: params.claimToken,
    p_provider: params.provider || null,
    p_provider_message_id: params.providerMessageId || null
  });
  return !result.error && result.data === true;
}

export async function failCommunication(params: { supabase?: SupabaseClient | null; communicationId: string; claimToken: string; errorCode: string; retryable: boolean; uncertainAcceptance?: boolean }) {
  const db = writer(params.supabase);
  if (!db) return false;
  const result = await db.rpc("roamly_fail_communication", {
    p_communication_id: params.communicationId,
    p_claim_token: params.claimToken,
    p_error_code: params.errorCode.slice(0, 80),
    p_retryable: params.retryable && params.uncertainAcceptance !== true,
    p_uncertain_acceptance: params.uncertainAcceptance === true
  });
  return !result.error && result.data === true;
}

export function communicationRetryDelaySeconds(attempt: number) {
  return boundedRetryDelaySeconds(attempt);
}

export { communicationFingerprint, communicationLogicalKey, sanitizeCommunicationMetadata };
