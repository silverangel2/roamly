import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RoamlyItineraryUnlockSource } from "@/lib/roamly/billing";

export type GenerationCostCategory =
  | "model_tokens"
  | "ai_call"
  | "map_call"
  | "transport_search"
  | "accommodation_search"
  | "activity_search"
  | "email"
  | "notification"
  | "worker_execution";

export type GenerationScalabilityConfig = {
  paidQueuePriority: number;
  freeQueuePriority: number;
  qaQueuePriority: number;
  freeUserDailyLimit: number;
  paidUserDailyLimit: number;
  openAiDailyTokenLimit: number;
  providerRateLimits: Record<string, number>;
  retryBudget: number;
  tripCostBudgetUsd: number;
};

function numberEnv(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function jsonEnv(key: string): Record<string, number> {
  try {
    const parsed = JSON.parse(process.env[key] || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([provider, value]) => [provider, typeof value === "number" && Number.isFinite(value) ? value : Number(value)])
        .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    );
  } catch {
    return {};
  }
}

export function getGenerationScalabilityConfig(): GenerationScalabilityConfig {
  return {
    paidQueuePriority: numberEnv("ROAMLY_PAID_QUEUE_PRIORITY", 100),
    freeQueuePriority: numberEnv("ROAMLY_FREE_QUEUE_PRIORITY", 10),
    qaQueuePriority: numberEnv("ROAMLY_QA_QUEUE_PRIORITY", 200),
    freeUserDailyLimit: numberEnv("ROAMLY_FREE_GENERATION_DAILY_LIMIT", 1),
    paidUserDailyLimit: numberEnv("ROAMLY_PAID_GENERATION_DAILY_LIMIT", 20),
    openAiDailyTokenLimit: numberEnv("ROAMLY_OPENAI_DAILY_TOKEN_LIMIT", 500_000),
    providerRateLimits: jsonEnv("ROAMLY_PROVIDER_RATE_LIMITS_JSON"),
    retryBudget: numberEnv("ROAMLY_GENERATION_RETRY_BUDGET", 3),
    tripCostBudgetUsd: numberEnv("ROAMLY_GENERATION_COST_BUDGET_USD", 1.5)
  };
}

export function generationPriorityForEntitlement(params: {
  unlockSource?: RoamlyItineraryUnlockSource | null;
  qaTester?: boolean;
  config?: GenerationScalabilityConfig;
}) {
  const config = params.config || getGenerationScalabilityConfig();
  if (params.qaTester) {
    return {
      priority: config.qaQueuePriority,
      userPlan: "qa",
      paidPriority: true,
      queuePriorityReason: "qa_priority"
    };
  }
  if (params.unlockSource === "paid" || params.unlockSource === "bundle" || params.unlockSource === "admin") {
    return {
      priority: config.paidQueuePriority,
      userPlan: params.unlockSource === "admin" ? "admin" : "paid",
      paidPriority: true,
      queuePriorityReason: "paid_customer_priority"
    };
  }
  return {
    priority: config.freeQueuePriority,
    userPlan: "free",
    paidPriority: false,
    queuePriorityReason: "free_customer_priority"
  };
}

export function duplicateGenerationRequestKey(params: {
  tripId: string;
  payloadFingerprint?: string | null;
  generationVersion: string;
}) {
  return [params.tripId, params.generationVersion, params.payloadFingerprint || "current"].join(":");
}

export async function recordGenerationCostEvent(params: {
  supabase?: SupabaseClient | null;
  tripId: string;
  jobId?: string | null;
  layerId?: string | null;
  userId: string;
  costCategory: GenerationCostCategory;
  provider?: string | null;
  model?: string | null;
  unitCount?: number | null;
  estimatedCostUsd?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseAdminClient() || params.supabase;
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const { data, error } = await supabase.rpc("roamly_record_generation_cost", {
    p_trip_id: params.tripId,
    p_job_id: params.jobId || null,
    p_layer_id: params.layerId || null,
    p_user_id: params.userId,
    p_cost_category: params.costCategory,
    p_provider: params.provider || null,
    p_model: params.model || null,
    p_unit_count: params.unitCount ?? null,
    p_estimated_cost_usd: params.estimatedCostUsd ?? null,
    p_metadata: params.metadata || {}
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, event: data };
}

export function estimateGenerationCostFromUsage(params: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerCalls?: Partial<Record<GenerationCostCategory, number>>;
}) {
  const inputTokens = Math.max(0, params.inputTokens || 0);
  const outputTokens = Math.max(0, params.outputTokens || 0);
  const aiTokensUsd =
    (inputTokens * numberEnv("ROAMLY_OPENAI_INPUT_PRICE_PER_1M", 0.4) + outputTokens * numberEnv("ROAMLY_OPENAI_OUTPUT_PRICE_PER_1M", 1.6)) /
    1_000_000;
  const providerCosts = Object.entries(params.providerCalls || {}).reduce((total, [category, count]) => {
    const perCall = numberEnv(`ROAMLY_${category.toUpperCase()}_ESTIMATED_COST_USD`, 0);
    return total + Math.max(0, count || 0) * perCall;
  }, 0);
  return Number((aiTokensUsd + providerCosts).toFixed(8));
}

export async function checkUserGenerationRateLimit(params: {
  supabase: SupabaseClient;
  userId: string;
  paid: boolean;
  config?: GenerationScalabilityConfig;
}) {
  const config = params.config || getGenerationScalabilityConfig();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error } = await params.supabase
    .from("roamly_trip_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .gte("created_at", since);
  if (error) return { ok: false as const, error: error.message, allowed: false };
  const limit = params.paid ? config.paidUserDailyLimit : config.freeUserDailyLimit;
  return {
    ok: true as const,
    allowed: (count || 0) < limit,
    count: count || 0,
    limit
  };
}

export async function getGenerationQueueHealth(supabase?: SupabaseClient | null) {
  const admin = createSupabaseAdminClient() || supabase;
  if (!admin) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", health: null };
  const { data, error } = await admin.rpc("roamly_generation_queue_health");
  if (error) return { ok: false as const, error: error.message, health: null };
  return { ok: true as const, health: data as Record<string, unknown> };
}

export async function listAdminGenerationQueue(params: {
  supabase?: SupabaseClient | null;
  limit?: number;
}) {
  const admin = createSupabaseAdminClient() || params.supabase;
  if (!admin) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", jobs: [] };
  const { data, error } = await admin
    .from("roamly_generation_queue_admin")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, params.limit || 50)));
  if (error) return { ok: false as const, error: error.message, jobs: [] };
  return { ok: true as const, jobs: data || [] };
}

export async function adminRetryGenerationJob(params: {
  supabase?: SupabaseClient | null;
  jobId: string;
  reason?: string;
}) {
  const admin = createSupabaseAdminClient() || params.supabase;
  if (!admin) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", job: null };
  const { data, error } = await admin.rpc("roamly_retry_generation_job_admin", {
    p_job_id: params.jobId,
    p_reason: params.reason || "admin_retry"
  });
  if (error) return { ok: false as const, error: error.message, job: null };
  return { ok: true as const, job: data };
}

export async function adminCancelGenerationJob(params: {
  supabase?: SupabaseClient | null;
  jobId: string;
  reason?: string;
}) {
  const admin = createSupabaseAdminClient() || params.supabase;
  if (!admin) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", job: null };
  const { data, error } = await admin.rpc("roamly_cancel_generation_job_admin", {
    p_job_id: params.jobId,
    p_reason: params.reason || "admin_cancelled"
  });
  if (error) return { ok: false as const, error: error.message, job: null };
  return { ok: true as const, job: data };
}
