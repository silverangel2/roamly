import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PublicMarketSearchQuota =
  | { ok: true; allowed: true; minuteRemaining: number; dayRemaining: number }
  | { ok: true; allowed: false; retryAfterSeconds: number }
  | { ok: false };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

export function trustedPublicMarketClientIp(forwardedFor: string | null) {
  if (typeof forwardedFor !== "string" || forwardedFor.length > 256) return null;
  const candidate = forwardedFor.split(",", 1)[0].trim();
  return isIP(candidate) ? candidate : null;
}

export function publicMarketActorHash(ip: string, secret: string | undefined) {
  if (!isIP(ip) || !secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(`roamly-public-market-rate-v1:${ip}`).digest("hex");
}

export async function consumePublicMarketSearchQuota(admin: SupabaseClient, actorHash: string): Promise<PublicMarketSearchQuota> {
  if (!/^[a-f0-9]{64}$/.test(actorHash)) return { ok: false };
  const { data, error } = await admin.rpc("roamly_consume_public_market_search_quota", { p_actor_hash: actorHash });
  if (error) return { ok: false };
  const first = Array.isArray(data) ? record(data[0]) : record(data);
  if (!first || typeof first.allowed !== "boolean") return { ok: false };
  if (!first.allowed) {
    const retryAfterSeconds = nonnegativeInteger(first.retry_after_seconds);
    return retryAfterSeconds === null ? { ok: false } : { ok: true, allowed: false, retryAfterSeconds };
  }
  const minuteRemaining = nonnegativeInteger(first.minute_remaining);
  const dayRemaining = nonnegativeInteger(first.day_remaining);
  if (minuteRemaining === null || dayRemaining === null) return { ok: false };
  return { ok: true, allowed: true, minuteRemaining, dayRemaining };
}

export function publicMarketSearchAdminClient() {
  return createSupabaseAdminClient();
}
