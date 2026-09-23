import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketSearchQuotaResult =
  | { ok: true; allowed: true; minuteRemaining: number; dayRemaining: number }
  | { ok: true; allowed: false; retryAfterSeconds: number }
  | { ok: false };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

export async function consumeMarketSearchQuota(supabase: SupabaseClient): Promise<MarketSearchQuotaResult> {
  const { data, error } = await supabase.rpc("roamly_consume_market_search_quota");
  if (error) return { ok: false };
  const first = Array.isArray(data) ? record(data[0]) : record(data);
  if (!first || typeof first.allowed !== "boolean") return { ok: false };

  if (!first.allowed) {
    return { ok: true, allowed: false, retryAfterSeconds: nonnegativeInteger(first.retry_after_seconds) ?? 60 };
  }

  const minuteRemaining = nonnegativeInteger(first.minute_remaining);
  const dayRemaining = nonnegativeInteger(first.day_remaining);
  if (minuteRemaining === null || dayRemaining === null) return { ok: false };
  return { ok: true, allowed: true, minuteRemaining, dayRemaining };
}
