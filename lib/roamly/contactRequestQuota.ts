import type { SupabaseClient } from "@supabase/supabase-js";

export type ContactRequestQuota =
  | { ok: true; allowed: true; hourRemaining: number; dayRemaining: number }
  | { ok: true; allowed: false; retryAfterSeconds: number }
  | { ok: false };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

export async function consumeContactRequestQuota(admin: SupabaseClient, actorHash: string): Promise<ContactRequestQuota> {
  if (!/^[a-f0-9]{64}$/.test(actorHash)) return { ok: false };
  const { data, error } = await admin.rpc("roamly_consume_contact_request_quota", { p_actor_hash: actorHash });
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
