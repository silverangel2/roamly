/**
 * Roamly AI model router (Lift 1, 2026-11-08).
 *
 * Lands at: lib/ai/modelRouter.ts
 *
 * ONE place decides which model an AI call uses. Call sites declare a task
 * class and a lane; they never read model env vars directly again.
 *
 * Task classes (see the Lift 1 investigation):
 * - "routine"   mechanical transforms on supplied data (extraction,
 *               translation, drafting) -> cheap tier
 * - "diagnosis" a model reviews a computed result and advises -> mid tier
 * - "decision"  the model's output IS the paid product -> strong tier
 * Bot lanes (keeper, ops worker, Sophie command door) are tier-0: no model,
 * ever, without a new commission. They do not import this module.
 *
 * Resolution precedence (highest first):
 * 1. The lane's own override env (e.g. OPENAI_BOOKING_EXTRACTION_MODEL) —
 *    existing lane envs keep winning for their lane, so no Vercel env
 *    change is needed to ship this router.
 * 2. The tier env: AI_MODEL_CHEAP / AI_MODEL_MID / AI_MODEL_STRONG.
 * 3. The call site's legacy env chain — the exact env fallback order the
 *    site used before the router (e.g. ["OPENAI_MODEL"] for translation),
 *    so under today's production env every site resolves to the model it
 *    already uses. Tier envs unset => zero behaviour change.
 * 4. Code default "gpt-4o-mini" (today's hardcoded fallback everywhere).
 *
 * OPENAI_FALLBACK_MODEL is deliberately NOT read here: it keeps its
 * existing role as the staged generation path's attempt-2 swap.
 */

export type AiTaskClass = "routine" | "diagnosis" | "decision";
export type AiTier = "cheap" | "mid" | "strong";

export const AI_TASK_CLASSES = ["routine", "diagnosis", "decision"] as const;

export const TASK_CLASS_TIER: Record<AiTaskClass, AiTier> = {
  routine: "cheap",
  diagnosis: "mid",
  decision: "strong"
};

const TIER_ENV: Record<AiTier, string> = {
  cheap: "AI_MODEL_CHEAP",
  mid: "AI_MODEL_MID",
  strong: "AI_MODEL_STRONG"
};

const TIER_DOWN: Record<AiTier, AiTier | null> = {
  strong: "mid",
  mid: "cheap",
  cheap: null
};

export const DEFAULT_AI_MODEL = "gpt-4o-mini";

/**
 * Accounting prices (USD per 1M tokens) used for cost traces. The
 * gpt-4o-mini row intentionally matches the tree's existing accounting
 * defaults (stagedItineraryGeneration's ROAMLY_OPENAI_*_PRICE_PER_1M env
 * defaults, 0.4 / 1.6) so day-one cost traces do not move. Other rows are
 * list-price placeholders: CONFIRM before promoting a tier to them
 * (Lift 1 investigation, risk #4). The two env vars override any row.
 */
export const MODEL_ACCOUNTING_PRICES: Record<string, { inputPricePer1M: number; outputPricePer1M: number }> = {
  "gpt-4o-mini": { inputPricePer1M: 0.4, outputPricePer1M: 1.6 },
  "gpt-4o": { inputPricePer1M: 2.5, outputPricePer1M: 10 }
};

const FALLBACK_PRICES = { inputPricePer1M: 0.4, outputPricePer1M: 1.6 };

function envValue(name: string): string | undefined {
  const value = (process.env[name] || "").trim();
  return value || undefined;
}

export type AiModelResolutionSource = "lane_override" | "tier_env" | "legacy_env" | "default";

export type AiModelResolution = {
  provider: string;
  model: string;
  taskClass: AiTaskClass;
  tier: AiTier;
  lane: string | null;
  source: AiModelResolutionSource;
  /** Env var that produced the model, when one did. */
  sourceEnv: string | null;
  inputPricePer1M: number;
  outputPricePer1M: number;
  /** True when this resolution is a degraded retry of an earlier one. */
  degraded: boolean;
  degradedFromTier: AiTier | null;
};

export type ResolveModelOptions = {
  taskClass: AiTaskClass;
  lane?: string;
  /** The lane's dedicated override env, e.g. "OPENAI_BOOKING_EXTRACTION_MODEL". */
  laneOverrideEnv?: string;
  /** The site's pre-router env fallback order, e.g. ["OPENAI_MODEL"]. */
  legacyEnvChain?: string[];
};

function accountingPrices(model: string): { inputPricePer1M: number; outputPricePer1M: number } {
  const row = MODEL_ACCOUNTING_PRICES[model] || FALLBACK_PRICES;
  return {
    inputPricePer1M: Number(envValue("ROAMLY_OPENAI_INPUT_PRICE_PER_1M") || row.inputPricePer1M),
    outputPricePer1M: Number(envValue("ROAMLY_OPENAI_OUTPUT_PRICE_PER_1M") || row.outputPricePer1M)
  };
}

function resolveAtTier(tier: AiTier, options: ResolveModelOptions): AiModelResolution {
  const provider = envValue("ROAMLY_PRIMARY_AI_PROVIDER") || "openai";
  let model: string | undefined;
  let source: AiModelResolutionSource = "default";
  let sourceEnv: string | null = null;

  if (options.laneOverrideEnv) {
    const laneModel = envValue(options.laneOverrideEnv);
    if (laneModel) {
      model = laneModel;
      source = "lane_override";
      sourceEnv = options.laneOverrideEnv;
    }
  }
  if (!model) {
    const tierModel = envValue(TIER_ENV[tier]);
    if (tierModel) {
      model = tierModel;
      source = "tier_env";
      sourceEnv = TIER_ENV[tier];
    }
  }
  if (!model) {
    for (const name of options.legacyEnvChain || []) {
      const legacyModel = envValue(name);
      if (legacyModel) {
        model = legacyModel;
        source = "legacy_env";
        sourceEnv = name;
        break;
      }
    }
  }
  if (!model) model = DEFAULT_AI_MODEL;

  const prices = accountingPrices(model);
  return {
    provider,
    model,
    taskClass: options.taskClass,
    tier,
    lane: options.lane || null,
    source,
    sourceEnv,
    inputPricePer1M: prices.inputPricePer1M,
    outputPricePer1M: prices.outputPricePer1M,
    degraded: false,
    degradedFromTier: null
  };
}

/** The one model-resolution entry point for every AI call site. */
export function resolveModel(options: ResolveModelOptions): AiModelResolution {
  return resolveAtTier(TASK_CLASS_TIER[options.taskClass], options);
}

/** Current tier configuration, for status surfaces (Sophie World station). */
export function resolveTierConfig(): Record<AiTaskClass, AiModelResolution> {
  return {
    routine: resolveModel({ taskClass: "routine" }),
    diagnosis: resolveModel({ taskClass: "diagnosis" }),
    decision: resolveModel({ taskClass: "decision" })
  };
}

/**
 * One tier down from a resolution, or null when no degrade is allowed:
 * already at the cheap tier, or the model was pinned by a lane override
 * (a pinned lane model is the floor its lane chose — never degrade past it).
 * OPENAI_FALLBACK_MODEL, when set and different, is the degrade target at
 * every step, mirroring the staged path's attempt-2 swap.
 */
export function degradeResolution(resolution: AiModelResolution, options: ResolveModelOptions): AiModelResolution | null {
  if (resolution.source === "lane_override") return null;
  const fallbackModel = envValue("OPENAI_FALLBACK_MODEL");
  if (fallbackModel && fallbackModel !== resolution.model) {
    const prices = accountingPrices(fallbackModel);
    return {
      ...resolution,
      model: fallbackModel,
      source: "legacy_env",
      sourceEnv: "OPENAI_FALLBACK_MODEL",
      inputPricePer1M: prices.inputPricePer1M,
      outputPricePer1M: prices.outputPricePer1M,
      degraded: true,
      degradedFromTier: resolution.tier
    };
  }
  const down = TIER_DOWN[resolution.tier];
  if (!down) return null;
  const next = resolveAtTier(down, options);
  if (next.model === resolution.model && next.source !== "tier_env") {
    // Degrading the tier would land on the same model via the legacy chain;
    // that is a retry of the same model, not a degrade. The staged path may
    // still retry same-model under its own attempt law; the router does not.
    return null;
  }
  return { ...next, degraded: true, degradedFromTier: resolution.tier };
}

/**
 * Error categories, mirroring the tree's safeAiError categorisation
 * (stagedItineraryGeneration.ts / lib/ai/roamly-itinerary.ts — the same
 * logic duplicated in both; this module is the third copy by necessity
 * until those call sites adopt it, after which they can import this one).
 */
export function categorizeAiError(error: unknown): string {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = typeof record?.status === "number" ? record.status : null;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code =
    typeof record?.code === "string"
      ? record.code
      : typeof record?.type === "string"
        ? record.type
        : error instanceof Error
          ? error.name
          : "UNKNOWN_AI_ERROR";
  const normalizedCode = String(code).toLowerCase();
  if (
    normalizedCode.includes("credit_balance_exhausted") ||
    normalizedCode.includes("insufficient_quota") ||
    message.includes("credit_balance_exhausted") ||
    message.includes("insufficient quota")
  ) {
    return "quota_exhausted";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_or_endpoint";
  if (status === 429) return "rate_limit";
  if (status != null && status >= 500) return "provider_server_error";
  if (/timeout|timed out|abort|aborted/.test(message)) return "timeout";
  if (/network|connection|fetch|econnreset|enotfound|eai_again/.test(message)) return "connection";
  return "unknown";
}

/**
 * Retryable = the same set lib/ai's shouldTryNextAiModel already uses:
 * timeout, connection, provider 5xx, unknown. Never on malformed output,
 * validation, auth, quota or rate-limit errors.
 */
export function shouldDegradeTier(errorCategory: unknown): boolean {
  return (
    errorCategory === "timeout" ||
    errorCategory === "connection" ||
    errorCategory === "provider_server_error" ||
    errorCategory === "unknown"
  );
}

/**
 * Standard per-call cost trace. Field-for-field the record the staged path
 * already emits (staged_ai_call_result) plus taskClass, lane, tier and the
 * degradation stamp — one record per attempt, success or failure.
 */
export type AiCallTraceRecord = {
  provider: string;
  model: string;
  taskClass: AiTaskClass;
  lane: string | null;
  tier: AiTier;
  status: "success" | "failed";
  attempt: number;
  degraded: boolean;
  degradedFromTier: AiTier | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number;
  finishReason: string | null;
  usageSource: "provider" | "estimate";
  errorCategory: string | null;
};

function estimateTokensFromCharacters(characters: number): number {
  return Math.max(1, Math.ceil(characters / 4));
}

function estimateCostUsd(inputTokens: number, outputTokens: number, resolution: AiModelResolution): number {
  return (inputTokens * resolution.inputPricePer1M + outputTokens * resolution.outputPricePer1M) / 1_000_000;
}

/** Minimal structural shape of an OpenAI-style chat completion (mockable). */
export type RoutedChatCompletion = {
  choices: Array<{ message?: { content?: string | null } | null; finish_reason?: string | null } | null>;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null; total_tokens?: number | null } | null;
  model?: string;
};

export type RoutedChatClient = {
  chat: {
    completions: {
      // `never` params on purpose: the real OpenAI SDK client's create()
      // takes its own narrower params type, so no concrete params type is
      // assignable from every client. The router is the one place that
      // knows the call shape, so it invokes create() through the locally
      // typed alias below — the single cast lives at this adapter
      // boundary, never at call sites.
      create: (...args: never[]) => Promise<RoutedChatCompletion>;
    };
  };
};

type RoutedCreateFn = (
  params: Record<string, unknown>,
  options?: Record<string, unknown>
) => Promise<RoutedChatCompletion>;

export type RoutedCompletionResult = {
  completion: RoutedChatCompletion;
  resolution: AiModelResolution;
  trace: AiCallTraceRecord;
  attempts: number;
};

/**
 * Execute one chat completion through the router: resolve the model, call,
 * trace; on a retryable failure degrade exactly one tier and retry once;
 * on a non-retryable failure (or no degrade available) rethrow the original
 * error after tracing the failed attempt. Every attempt emits one trace
 * record through onTrace.
 */
export async function executeRoutedChatCompletion(params: {
  client: RoutedChatClient;
  taskClass: AiTaskClass;
  lane?: string;
  laneOverrideEnv?: string;
  legacyEnvChain?: string[];
  /** Completion params WITHOUT `model` — the router owns the model field. */
  createParams: Record<string, unknown>;
  createOptions?: Record<string, unknown>;
  onTrace?: (trace: AiCallTraceRecord) => void;
}): Promise<RoutedCompletionResult> {
  const resolveOptions: ResolveModelOptions = {
    taskClass: params.taskClass,
    lane: params.lane,
    laneOverrideEnv: params.laneOverrideEnv,
    legacyEnvChain: params.legacyEnvChain
  };
  const inputCharacters = JSON.stringify(params.createParams.messages || "").length;
  let resolution = resolveModel(resolveOptions);
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const started = Date.now();
    try {
      const create = params.client.chat.completions.create as RoutedCreateFn;
      const completion = await create(
        { ...params.createParams, model: resolution.model },
        params.createOptions
      );
      const durationMs = Date.now() - started;
      const output = completion.choices?.[0]?.message?.content || "";
      const hasUsage = typeof completion.usage?.prompt_tokens === "number" || typeof completion.usage?.completion_tokens === "number";
      const inputTokens = completion.usage?.prompt_tokens ?? estimateTokensFromCharacters(inputCharacters);
      const outputTokens = completion.usage?.completion_tokens ?? estimateTokensFromCharacters(output.length);
      const trace: AiCallTraceRecord = {
        provider: resolution.provider,
        model: resolution.model,
        taskClass: resolution.taskClass,
        lane: resolution.lane,
        tier: resolution.tier,
        status: "success",
        attempt,
        degraded: resolution.degraded,
        degradedFromTier: resolution.degradedFromTier,
        durationMs,
        inputTokens,
        outputTokens,
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
        totalTokens: completion.usage?.total_tokens ?? null,
        estimatedCostUsd: Number(estimateCostUsd(inputTokens, outputTokens, resolution).toFixed(8)),
        finishReason: completion.choices?.[0]?.finish_reason || null,
        usageSource: hasUsage ? "provider" : "estimate",
        errorCategory: null
      };
      params.onTrace?.(trace);
      return { completion, resolution, trace, attempts: attempt };
    } catch (error) {
      const durationMs = Date.now() - started;
      const errorCategory = categorizeAiError(error);
      const trace: AiCallTraceRecord = {
        provider: resolution.provider,
        model: resolution.model,
        taskClass: resolution.taskClass,
        lane: resolution.lane,
        tier: resolution.tier,
        status: "failed",
        attempt,
        degraded: resolution.degraded,
        degradedFromTier: resolution.degradedFromTier,
        durationMs,
        inputTokens: estimateTokensFromCharacters(inputCharacters),
        outputTokens: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        estimatedCostUsd: 0,
        finishReason: null,
        usageSource: "estimate",
        errorCategory
      };
      params.onTrace?.(trace);
      if (attempt === 1 && shouldDegradeTier(errorCategory)) {
        const degraded = degradeResolution(resolution, resolveOptions);
        if (degraded) {
          resolution = degraded;
          continue;
        }
      }
      throw error;
    }
  }
}

/**
 * Roll a trace record into the input shape of finops'
 * createTokenCostAccounting (lib/roamly/finops.ts) so admin operations can
 * show spend BY CLASS. Structural on purpose: this module stays import-free
 * and the finops factory remains the validating constructor at the call
 * site that persists the record.
 */
export function toFinOpsAccountingInput(
  trace: AiCallTraceRecord,
  ids: { jobId: string; attemptId: string; specialist: string; subsystem: string; businessPurpose: string }
): Record<string, unknown> {
  return {
    jobId: ids.jobId,
    attemptId: ids.attemptId,
    specialist: ids.specialist,
    subsystem: ids.subsystem,
    provider: trace.provider === "openai" ? "openai" : "approved_model",
    modelOrWorkerClass: trace.model,
    executionClass: "model",
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    cachedTokens: null,
    financialCostUsd: trace.estimatedCostUsd,
    durationMs: trace.durationMs,
    retryCount: trace.attempt - 1,
    outcome: trace.status === "success" ? "completed" : "failed",
    evidenceQuality: trace.usageSource === "provider" ? "acceptable" : "insufficient",
    businessPurpose: ids.businessPurpose,
    authoritativeCost: trace.usageSource === "provider"
  };
}
