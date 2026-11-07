import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Quota client for the two senders the 2026-11-06 security pass found
 * unthrottled (Check 5): the trip itinerary email and the guest recovery
 * email. Mirrors lib/roamly/contactRequestQuota.ts; the backing tables and
 * RPCs live in supabase/migrations/20261106000200_roamly_email_send_rate_limits.sql
 * and are callable only by the service role, so every call here needs the
 * admin client. Actor identities are HMAC hashes -- no raw user id, IP, or
 * email address is ever stored in the quota tables.
 */

export type EmailSendQuota =
  | { ok: true; allowed: true; hourRemaining: number; dayRemaining: number }
  | { ok: true; allowed: false; retryAfterSeconds: number }
  | { ok: false };

export type EmailSendActorScope = "trip-email-user" | "trip-email-ip" | "recovery-email" | "recovery-ip";

export function emailSendActorHash(scope: EmailSendActorScope, value: string, secret: string | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized || !secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(`roamly-email-send-rate-v1:${scope}:${normalized}`).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

async function consumeEmailSendQuota(
  admin: SupabaseClient,
  rpcName: "roamly_consume_trip_email_quota" | "roamly_consume_recovery_email_quota",
  actorHash: string
): Promise<EmailSendQuota> {
  if (!/^[a-f0-9]{64}$/.test(actorHash)) return { ok: false };
  const { data, error } = await admin.rpc(rpcName, { p_actor_hash: actorHash });
  if (error) return { ok: false };
  const first = Array.isArray(data) ? record(data[0]) : record(data);
  if (!first || typeof first.allowed !== "boolean") return { ok: false };
  if (!first.allowed) {
    const retryAfterSeconds = nonnegativeInteger(first.retry_after_seconds);
    return retryAfterSeconds === null ? { ok: false } : { ok: true, allowed: false, retryAfterSeconds };
  }
  const hourRemaining = nonnegativeInteger(first.hour_remaining);
  const dayRemaining = nonnegativeInteger(first.day_remaining);
  if (hourRemaining === null || dayRemaining === null) return { ok: false };
  return { ok: true, allowed: true, hourRemaining, dayRemaining };
}

export function consumeTripEmailQuota(admin: SupabaseClient, actorHash: string): Promise<EmailSendQuota> {
  return consumeEmailSendQuota(admin, "roamly_consume_trip_email_quota", actorHash);
}

export function consumeRecoveryEmailQuota(admin: SupabaseClient, actorHash: string): Promise<EmailSendQuota> {
  return consumeEmailSendQuota(admin, "roamly_consume_recovery_email_quota", actorHash);
}
