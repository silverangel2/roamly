import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStarterItinerary,
  repairItineraryForTravelRequirements,
  validateItineraryForProduction,
  type RoamlyActivitySeed,
  type RoamlyDayPlan,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { normalizeLocale } from "@/lib/i18n";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import { markFreeItineraryUsed, lockGeneratedItinerary } from "@/lib/roamly/billing";
import { unlockLiveCompanion } from "@/lib/roamly/tripCompanion";
import { recordTripEvent } from "@/lib/roamly/events";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import { buildBudgetConstraintForItinerary, discoverTripPrices, savePriceDiscovery } from "@/lib/roamly/priceDiscovery";
import { getConfirmedBookingCostCents, getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { searchTripMarketPrices } from "@/lib/roamly/travelMarketSearch";
import {
  finalizeStagedGenerationNotification,
  getGenerationEmailStatus,
} from "@/lib/roamly/itineraryGenerationEmail";
import { syncGeneratedItinerary, type RoamlyTripRecord } from "@/lib/trips";
import {
  getPublicSupabaseHost,
  classifyGenerationValidationErrors,
  logGenerationDiagnostic,
  summarizeItineraryShape
} from "@/lib/roamly/generationDiagnostics";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type StagedGenerationStatus =
  | "queued"
  | "validating_input"
  | "generating_outline"
  | "generating_day"
  | "validating_day"
  | "enriching_transport"
  | "enriching_affiliates"
  | "complete"
  | "partially_failed"
  | "failed";

export type StagedDayStatus = "queued" | "generating" | "validating" | "complete" | "failed";

export type StagedGenerationDayState = {
  dayNumber: number;
  date?: string;
  status: StagedDayStatus;
  attemptCount: number;
  lastError?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

export type StagedGenerationBatchState = {
  id: string;
  dayNumbers: number[];
  status: StagedDayStatus;
  attemptCount: number;
  lastError?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostUsd?: number | null;
};

export type StagedTripOutlineDay = {
  id: string;
  dayNumber: number;
  date?: string;
  theme: string;
  geographicArea: string;
  priorityActivities: string[];
  arrivalRequirements?: string[];
  departureRequirements?: string[];
  nextStartRequirement?: string;
};

export type StagedTripOutline = {
  tripSummary: string;
  hotelAreaRecommendation: string;
  importantConstraints: string[];
  days: StagedTripOutlineDay[];
};

export type StagedGenerationStageRun = {
  id: string;
  stage: "outline" | "day_batch";
  batchId?: string | null;
  dayNumbers?: number[] | null;
  provider?: string | null;
  model?: string | null;
  attemptNumber: number;
  status: "success" | "failed";
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
  failureCategory?: string | null;
  errorCode?: string | null;
  createdAt: string;
};

export type StagedGenerationState = {
  version: 2;
  status: StagedGenerationStatus;
  currentStage: StagedGenerationStatus;
  totalDayCount: number;
  completedDayCount: number;
  outline?: StagedTripOutline | null;
  days: Record<string, StagedGenerationDayState>;
  batches: Record<string, StagedGenerationBatchState>;
  generatedDays: Record<string, RoamlyDayPlan>;
  payload: TripPlannerPayload;
  priceDiscovery?: Record<string, unknown> | null;
  priceDiscoveryId?: string | null;
  budgetConstraint?: string | null;
  confirmedBookings?: TripPlannerPayload["confirmedBookings"] | null;
  unlockSource?: "free" | "paid" | "bundle" | "admin";
  qaTester?: boolean;
  model?: string | null;
  provider?: string | null;
  outlineAttemptCount?: number;
  aiCallCount?: number;
  estimatedAiCostUsd?: number;
  aiInputTokens?: number;
  aiOutputTokens?: number;
  stageRuns?: StagedGenerationStageRun[];
  finalValidationErrors?: string[];
  finalValidationAttemptCount?: number;
  finalValidationRepairedAt?: string | null;
  lastError?: string | null;
  lastErrorCode?: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  worker?: {
    leaseId: string;
    leaseExpiresAt: string;
  } | null;
  trace?: {
    requestId?: string;
  };
};

type StageTrace = {
  requestId?: string;
  tripId?: string;
  route?: string;
};

type StageAiResult = {
  parsed: unknown;
  provider: string;
  model: string;
  inputCharacters: number;
  outputCharacters: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  attemptNumber: number;
};

export class StagedGenerationError extends Error {
  code: string;
  status: number;
  permanent: boolean;
  failureCategory: string;
  provider?: string | null;
  model?: string | null;

  constructor(
    message: string,
    code: string,
    status = 502,
    permanent = false,
    options: { failureCategory?: string; provider?: string | null; model?: string | null } = {}
  ) {
    super(message);
    this.name = "StagedGenerationError";
    this.code = code;
    this.status = status;
    this.permanent = permanent;
    this.failureCategory = options.failureCategory || "unknown";
    this.provider = options.provider || null;
    this.model = options.model || null;
  }
}

const OUTLINE_TIMEOUT_MS = Number(process.env.OPENAI_OUTLINE_TIMEOUT_MS || 25_000);
const DAY_TIMEOUT_MS = Number(process.env.OPENAI_DAY_TIMEOUT_MS || 35_000);
const OUTLINE_MAX_TOKENS = Number(process.env.OPENAI_OUTLINE_MAX_TOKENS || 1200);
const DAY_MAX_TOKENS = Number(process.env.OPENAI_DAY_BATCH_MAX_TOKENS || 3200);
const BATCH_ATTEMPT_LIMIT = Number(process.env.ROAMLY_STAGED_BATCH_ATTEMPT_LIMIT || 2);
const MAX_AI_COST_USD = Number(process.env.ROAMLY_STAGED_MAX_AI_COST_USD || 0.05);
const DEFAULT_INPUT_PRICE_PER_1M = Number(process.env.ROAMLY_OPENAI_INPUT_PRICE_PER_1M || 0.4);
const DEFAULT_OUTPUT_PRICE_PER_1M = Number(process.env.ROAMLY_OPENAI_OUTPUT_PRICE_PER_1M || 1.6);
const STAGE_LEASE_MS = Number(process.env.ROAMLY_STAGED_GENERATION_LEASE_MS || 4 * 60_000);

function nowIso() {
  return new Date().toISOString();
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

function getPositiveNumber(value: unknown, fallback = 0) {
  return Math.max(0, getNumber(value, fallback));
}

function getStringList(value: unknown, fallback: string[] = [], limit = 8) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items.slice(0, limit) : fallback;
}

export function getStagedGenerationState(metadata: unknown): StagedGenerationState | null {
  const record = getRecord(metadata);
  const generation = getRecord(record?.generation);
  if (!generation || generation.version !== 2) return null;
  const payload = getRecord(generation.payload) as TripPlannerPayload | null;
  if (!payload) return null;
  return {
    version: 2,
    status: generation.status as StagedGenerationStatus,
    currentStage: generation.currentStage as StagedGenerationStatus,
    totalDayCount: getPositiveNumber(generation.totalDayCount, 0),
    completedDayCount: getPositiveNumber(generation.completedDayCount, 0),
    outline: (getRecord(generation.outline) as StagedTripOutline | null) || null,
    days: (getRecord(generation.days) as Record<string, StagedGenerationDayState> | null) || {},
    batches: (getRecord(generation.batches) as Record<string, StagedGenerationBatchState> | null) || {},
    generatedDays: (getRecord(generation.generatedDays) as Record<string, RoamlyDayPlan> | null) || {},
    payload,
    priceDiscovery: getRecord(generation.priceDiscovery),
    priceDiscoveryId: getString(generation.priceDiscoveryId, "") || null,
    budgetConstraint: getString(generation.budgetConstraint, "") || null,
    confirmedBookings: Array.isArray(generation.confirmedBookings)
      ? generation.confirmedBookings as TripPlannerPayload["confirmedBookings"]
      : [],
    unlockSource: generation.unlockSource as StagedGenerationState["unlockSource"],
    qaTester: generation.qaTester === true,
    model: getString(generation.model, "") || null,
    provider: getString(generation.provider, "") || null,
    outlineAttemptCount: getPositiveNumber(generation.outlineAttemptCount, 0),
    aiCallCount: getPositiveNumber(generation.aiCallCount, 0),
    estimatedAiCostUsd: typeof generation.estimatedAiCostUsd === "number" ? generation.estimatedAiCostUsd : 0,
    aiInputTokens: getPositiveNumber(generation.aiInputTokens, 0),
    aiOutputTokens: getPositiveNumber(generation.aiOutputTokens, 0),
    stageRuns: Array.isArray(generation.stageRuns)
      ? (generation.stageRuns as StagedGenerationStageRun[]).slice(-40)
      : [],
    finalValidationErrors: Array.isArray(generation.finalValidationErrors)
      ? generation.finalValidationErrors.filter((item): item is string => typeof item === "string")
      : [],
    finalValidationAttemptCount: getPositiveNumber(generation.finalValidationAttemptCount, 0),
    finalValidationRepairedAt: getString(generation.finalValidationRepairedAt, "") || null,
    lastError: getString(generation.lastError, "") || null,
    lastErrorCode: getString(generation.lastErrorCode, "") || null,
    startedAt: getString(generation.startedAt, nowIso()),
    updatedAt: getString(generation.updatedAt, nowIso()),
    completedAt: getString(generation.completedAt, "") || null,
    worker: (getRecord(generation.worker) as StagedGenerationState["worker"]) || null,
    trace: getRecord(generation.trace) as StagedGenerationState["trace"]
  };
}

function generationMetadata(metadata: unknown, state: StagedGenerationState) {
  const current = (getRecord(metadata) || {}) as Record<string, unknown>;
  const currentEmail = getGenerationEmailStatus(current);
  return {
    ...current,
    generationEmail: {
      ...currentEmail,
      email_me_when_ready: currentEmail.email_me_when_ready !== false
    },
    generation: state
  };
}

function dateForDay(payload: TripPlannerPayload, dayNumber: number) {
  if (!payload.startDate) return "";
  const date = new Date(`${payload.startDate}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

function buildInitialDayStates(payload: TripPlannerPayload, totalDayCount: number) {
  return Object.fromEntries(
    Array.from({ length: totalDayCount }, (_, index) => {
      const dayNumber = index + 1;
      return [
        String(dayNumber),
        {
          dayNumber,
          date: dateForDay(payload, dayNumber),
          status: "queued" as const,
          attemptCount: 0,
          lastError: null,
          updatedAt: nowIso()
        }
      ];
    })
  );
}

function plannedDayBatches(totalDayCount: number) {
  if (totalDayCount <= 3) return [[1, 2, 3].filter((day) => day <= totalDayCount)];
  if (totalDayCount === 4) return [[1, 2], [3, 4]];
  if (totalDayCount === 5) return [[1, 2, 3], [4, 5]];
  if (totalDayCount === 6) return [[1, 2, 3], [4, 5, 6]];
  if (totalDayCount === 7) return [[1, 2, 3], [4, 5], [6, 7]];
  if (totalDayCount === 8) return [[1, 2, 3], [4, 5, 6], [7, 8]];
  if (totalDayCount === 9) return [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  if (totalDayCount === 10) return [[1, 2, 3], [4, 5, 6], [7, 8], [9, 10]];

  const batches: number[][] = [];
  for (let day = 1; day <= totalDayCount; day += 3) {
    batches.push(Array.from({ length: Math.min(3, totalDayCount - day + 1) }, (_, index) => day + index));
  }
  return batches;
}

function buildInitialBatchStates(totalDayCount: number) {
  return Object.fromEntries(
    plannedDayBatches(totalDayCount).map((dayNumbers, index) => {
      const id = `batch-${index + 1}`;
      return [
        id,
        {
          id,
          dayNumbers,
          status: "queued" as const,
          attemptCount: 0,
          lastError: null,
          updatedAt: nowIso(),
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null
        }
      ];
    })
  );
}

function safePayloadForState(payload: TripPlannerPayload): TripPlannerPayload {
  return {
    ...payload,
    language: normalizeLocale(payload.language),
    interests: (payload.interests || []).slice(0, 16),
    priceDiscovery: undefined,
    confirmedBookings: undefined
  };
}

type AiProviderConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
};

function primaryAiProvider(): AiProviderConfig | null {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;
  return {
    provider: (process.env.ROAMLY_PRIMARY_AI_PROVIDER || "openai").trim() || "openai",
    apiKey,
    model: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini",
    baseURL: (process.env.ROAMLY_OPENAI_BASE_URL || "").trim() || undefined,
    inputPricePer1M: DEFAULT_INPUT_PRICE_PER_1M,
    outputPricePer1M: DEFAULT_OUTPUT_PRICE_PER_1M
  };
}

function providerForAttempt(): AiProviderConfig {
  const primary = primaryAiProvider();
  if (!primary) {
    throw new StagedGenerationError("Roamly AI generation is not configured.", "OPENAI_API_KEY_MISSING", 503, true, {
      failureCategory: "configuration"
    });
  }
  return primary;
}

function estimateTokensFromCharacters(characters: number) {
  return Math.max(1, Math.ceil(characters / 4));
}

function estimateCostUsd(inputTokens: number, outputTokens: number, provider: Pick<AiProviderConfig, "inputPricePer1M" | "outputPricePer1M">) {
  return (inputTokens * provider.inputPricePer1M + outputTokens * provider.outputPricePer1M) / 1_000_000;
}

function estimatedStageCost(prompt: string, maxOutputTokens: number, provider: AiProviderConfig) {
  const inputTokens = estimateTokensFromCharacters(prompt.length);
  return {
    inputTokens,
    outputTokens: maxOutputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, maxOutputTokens, provider)
  };
}

function assertCostBudget(state: StagedGenerationState, prompt: string, maxOutputTokens: number, provider: AiProviderConfig) {
  const estimate = estimatedStageCost(prompt, maxOutputTokens, provider);
  const current = state.estimatedAiCostUsd || 0;
  if (current + estimate.estimatedCostUsd > MAX_AI_COST_USD) {
    throw new StagedGenerationError(
      "Roamly stopped generation before exceeding the AI cost ceiling.",
      "AI_COST_CEILING_REACHED",
      402,
      true,
      { failureCategory: "cost_ceiling", provider: provider.provider, model: provider.model }
    );
  }
  return estimate;
}

function addAiUsage(state: StagedGenerationState, result: StageAiResult) {
  return {
    ...state,
    aiCallCount: (state.aiCallCount || 0) + 1,
    estimatedAiCostUsd: Number(((state.estimatedAiCostUsd || 0) + result.estimatedCostUsd).toFixed(8)),
    aiInputTokens: (state.aiInputTokens || 0) + result.inputTokens,
    aiOutputTokens: (state.aiOutputTokens || 0) + result.outputTokens
  };
}

function appendStageRun(state: StagedGenerationState, run: Omit<StagedGenerationStageRun, "id" | "createdAt">) {
  const stageRuns = [
    ...(state.stageRuns || []),
    {
      ...run,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: nowIso()
    }
  ].slice(-40);
  return {
    ...state,
    stageRuns
  };
}

function openAiClient(provider: AiProviderConfig) {
  return new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
}

function safeAiError(error: unknown) {
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
  const category =
    status === 401 || status === 403
      ? "auth"
      : status === 404
        ? "model_or_endpoint"
        : status === 429
          ? "rate_limit"
          : status != null && status >= 500
            ? "provider_server_error"
            : /timeout|timed out|abort|aborted/.test(message)
              ? "timeout"
              : /network|connection|fetch|econnreset|enotfound|eai_again/.test(message)
                ? "connection"
                : "unknown";
  return {
    errorCode: String(code),
    errorName: error instanceof Error ? error.name : "UnknownError",
    httpStatus: status,
    errorCategory: category
  };
}

function traceStage(trace: StageTrace | undefined, event: string, details: Record<string, unknown> = {}) {
  logGenerationDiagnostic(event, {
    requestId: trace?.requestId,
    tripId: trace?.tripId,
    route: trace?.route,
    supabaseHost: getPublicSupabaseHost(),
    ...details
  });
}

async function sendGenerationEmailSafely(params: {
  tripId: string;
  kind: "completion" | "failure";
  requestId?: string;
}) {
  const result = await finalizeStagedGenerationNotification({ tripId: params.tripId, kind: params.kind }).catch((error) => ({
    ok: false,
    status: "failed" as const,
    error: error instanceof Error ? error.message : "Generation email failed."
  }));
  traceStage({ requestId: params.requestId, tripId: params.tripId, route: "stagedItineraryGeneration" }, "staged_generation_email_result", {
    kind: params.kind,
    ok: result.ok,
    status: result.status,
    errorPresent: Boolean("error" in result && result.error)
  });
  return result;
}

async function callJsonStage(params: {
  stage: "outline" | "day_batch";
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  attemptNumber: number;
  provider: AiProviderConfig;
  trace?: StageTrace;
}): Promise<StageAiResult> {
  const client = openAiClient(params.provider);
  const model = params.provider.model;
  const started = Date.now();
  traceStage(params.trace, "staged_ai_call_start", {
    stage: params.stage,
    provider: params.provider.provider,
    model,
    attempt: params.attemptNumber,
    inputCharacters: params.prompt.length,
    estimatedInputTokens: estimateTokensFromCharacters(params.prompt.length),
    maxOutputTokens: params.maxTokens,
    estimatedMaxCostUsd: Number(estimatedStageCost(params.prompt, params.maxTokens, params.provider).estimatedCostUsd.toFixed(8)),
    timeoutMs: params.timeoutMs
  });

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: params.stage === "outline" ? 0.25 : 0.35,
        max_completion_tokens: params.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Roamly's staged travel-planning model. Return strict JSON only. Keep content concise, chronological, practical, and safe."
          },
          {
            role: "user",
            content: params.prompt
          }
        ]
      },
      {
        maxRetries: 0,
        timeout: params.timeoutMs
      }
    );
    const output = completion.choices[0]?.message?.content || "";
    const durationMs = Date.now() - started;
    if (!output) {
      throw new StagedGenerationError("AI returned an empty response.", "AI_EMPTY_RESPONSE", 502, false, {
        failureCategory: "malformed_output"
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(output) as unknown;
    } catch {
      throw new StagedGenerationError("AI returned malformed JSON.", "AI_RESPONSE_PARSE_FAILED", 502, false, {
        failureCategory: "malformed_output"
      });
    }
    const inputTokens = completion.usage?.prompt_tokens ?? estimateTokensFromCharacters(params.prompt.length);
    const outputTokens = completion.usage?.completion_tokens ?? estimateTokensFromCharacters(output.length);
    const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens, params.provider);
    traceStage(params.trace, "staged_ai_call_result", {
      stage: params.stage,
      provider: params.provider.provider,
      model,
      status: "success",
      durationMs,
      inputCharacters: params.prompt.length,
      outputCharacters: output.length,
      inputTokens,
      outputTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      attempt: params.attemptNumber,
      finishReason: completion.choices[0]?.finish_reason || null,
      promptTokens: completion.usage?.prompt_tokens ?? null,
      completionTokens: completion.usage?.completion_tokens ?? null,
      totalTokens: completion.usage?.total_tokens ?? null
    });
    return {
      parsed,
      provider: params.provider.provider,
      model,
      inputCharacters: params.prompt.length,
      outputCharacters: output.length,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      durationMs,
      attemptNumber: params.attemptNumber
    };
  } catch (error) {
    const safe = error instanceof StagedGenerationError
      ? {
          errorCode: error.code,
          errorName: error.name,
          httpStatus: error.status,
          errorCategory: error.code === "AI_RESPONSE_PARSE_FAILED" ? "malformed_output" : error.failureCategory || "unknown"
        }
      : safeAiError(error);
    traceStage(params.trace, "staged_ai_call_failed", {
      stage: params.stage,
      provider: params.provider.provider,
      model,
      attempt: params.attemptNumber,
      status: "failed",
      ...safe
    });
    const code =
      safe.errorCategory === "timeout"
        ? "AI_PROVIDER_TIMEOUT"
        : safe.errorCategory === "rate_limit"
          ? "AI_RATE_LIMITED"
          : safe.errorCategory === "provider_server_error"
            ? "AI_PROVIDER_SERVER_ERROR"
            : safe.errorCode || "AI_PROVIDER_FAILED";
    const permanent = safe.errorCategory === "auth" || safe.errorCategory === "model_or_endpoint";
    throw new StagedGenerationError("Roamly AI could not complete this generation stage. No template itinerary was saved.", code, 502, permanent, {
      failureCategory: safe.errorCategory,
      provider: params.provider.provider,
      model
    });
  }
}

function routeText(payload: TripPlannerPayload) {
  const stops = payload.tripType === "multi_city" ? payload.destinationStops?.map((stop) => stop.value) || [] : [payload.destination];
  const route = [payload.origin || "Origin", ...stops].filter(Boolean);
  if (payload.tripType === "multi_city" && payload.returnToOrigin !== false && payload.origin) route.push(payload.origin);
  return route.join(" -> ");
}

function compactPriceSummary(value: Record<string, unknown> | null | undefined) {
  if (!value) return {};
  return {
    totalEstimateCents: value.totalEstimateCents,
    remainingBudgetCents: value.remainingBudgetCents,
    budgetStatus: value.budgetStatus,
    priceCoverage: value.priceCoverage,
    recommendedTransportOption: value.recommendedTransportOption,
    selectedTransportEstimateCents: value.selectedTransportEstimateCents,
    transportOptions: Array.isArray(value.transportOptions) ? value.transportOptions.slice(0, 4) : [],
    cityEstimates: Array.isArray(value.cityEstimates) ? value.cityEstimates.slice(0, 5) : [],
    budgetCategoryConfidence: Array.isArray(value.budgetCategoryConfidence) ? value.budgetCategoryConfidence.slice(0, 6) : [],
    cross_border: value.cross_border,
    crossBorderWarnings: Array.isArray(value.crossBorderWarnings) ? value.crossBorderWarnings.slice(0, 4) : [],
    currencyChange: value.currencyChange,
    originCurrency: value.originCurrency,
    destinationCurrency: value.destinationCurrency
  };
}

function outlinePrompt(payload: TripPlannerPayload, state: StagedGenerationState) {
  return `Create only a compact structured outline for a Roamly trip. Do not create timeline items, descriptions, prices, or URLs.

Trip:
- Route: ${routeText(payload)}
- Dates: ${payload.startDate} to ${payload.endDate}
- Days: ${state.totalDayCount}
- Return to origin: ${payload.returnToOrigin !== false ? "yes" : "no"}
- Travelers: ${payload.travelersCount || 1}
- Budget: ${payload.budgetCurrency || "CAD"} ${payload.budgetAmount ?? "not set"}
- Style: ${payload.travelStyle}; pace: ${payload.pace}; walking: ${payload.walkingTolerance}
- Interests: ${(payload.interests || []).join(", ") || "balanced"}
- Accommodation: ${payload.accommodationPreference}; transport: ${payload.transportationPreference}
- Accessibility/diet: ${payload.accessibilityNeeds || "none"}; ${payload.dietaryPreference || "none"}
- Price summary: ${JSON.stringify(compactPriceSummary(state.priceDiscovery))}

Return strict JSON:
{
  "tripSummary": "one concise sentence",
  "hotelAreaRecommendation": "area/base recommendation",
  "importantConstraints": ["constraint"],
  "days": [
    {
      "id": "day-1",
      "dayNumber": 1,
      "date": "YYYY-MM-DD",
      "theme": "short theme",
      "geographicArea": "specific area",
      "priorityActivities": ["two to four specific activities"],
      "arrivalRequirements": ["only for arrival day"],
      "departureRequirements": ["only for final day"],
      "nextStartRequirement": "where next day should start"
    }
  ]
}

Rules:
- Return exactly ${state.totalDayCount} days.
- Day 1 must reserve the beginning for origin-to-destination travel when origin differs from destination.
- Final day must reserve checkout and return travel when return_to_origin is yes.
- Keep every field concise.`;
}

function dayBatchPrompt(params: {
  payload: TripPlannerPayload;
  outline: StagedTripOutline;
  days: StagedTripOutlineDay[];
  previousEndingLocation: string;
  nextStartRequirement: string;
  usedAttractions: string[];
  state: StagedGenerationState;
}) {
  const { payload, outline, days, previousEndingLocation, nextStartRequirement, usedAttractions, state } = params;
  const dayNumbers = days.map((day) => day.dayNumber);
  return `Return compact JSON for this Roamly day batch. No URLs, markdown, prices-as-text, or extra prose.

Trip: ${outline.tripSummary}
Route: ${routeText(payload)}
Base: ${outline.hotelAreaRecommendation}
Days: ${JSON.stringify(days)}
Prev end: ${previousEndingLocation || outline.hotelAreaRecommendation}
Next start: ${nextStartRequirement || "hotel/base by evening when practical"}
Avoid repeats: ${usedAttractions.slice(0, 12).join(" | ") || "none"}
Prefs: ${payload.travelStyle}; ${payload.pace}; ${payload.walkingTolerance}; ${(payload.interests || []).join(", ") || "balanced"}
Budget cues: ${JSON.stringify(compactPriceSummary(state.priceDiscovery))}

JSON shape:
{
  "days": [
    {
      "id": "day-${dayNumbers[0]}",
      "dayNumber": ${dayNumbers[0]},
      "date": "YYYY-MM-DD",
      "title": "short title",
      "city": "city or area",
      "morning": "short summary",
      "afternoon": "short summary",
      "evening": "short summary",
      "food": ["meal idea"],
      "estimated_cost": 0,
      "map_queries": ["map search"],
      "items": [
        {
          "id": "day-${dayNumbers[0]}-item-1",
          "time_label": "09:00",
          "startTime": "09:00",
          "endTime": "10:30",
          "title": "specific stop",
          "description": "one short sentence",
          "location_name": "specific place or area",
          "estimated_cost": 0,
          "category": "Activity",
          "item_type": "activity",
          "travel_mode": "",
          "transportMode": "",
          "duration": "90 min",
          "durationMinutes": 90,
          "travelTimeMinutes": 0,
          "origin": "",
          "destination": "",
          "map_query": "map search"
        }
      ]
    }
  ]
}

Rules:
- Generate exactly these day numbers only: ${dayNumbers.join(", ")}.
- Return exactly ${days.length} day objects.
- Use 4 to 6 ordered items per day.
- Include meals or rest when realistic.
- Include startTime/endTime in HH:mm, chronological and non-overlapping.
- Titles and descriptions must be concise.
- Use item_type only: travel, transfer, hotel, activity, meal, rest, booking, reminder.
- Do not repeat already-used attractions.
- For Day 1, local activities happen only after arrival/check-in.
- For final day, keep local sightseeing brief before checkout/return travel.`;
}

function cleanOutline(raw: unknown, payload: TripPlannerPayload, totalDays: number): StagedTripOutline {
  const record = getRecord(raw) || {};
  const daysRaw = Array.isArray(record.days) ? record.days : [];
  const days = daysRaw.slice(0, totalDays).map((item, index) => {
    const day = getRecord(item) || {};
    const dayNumber = getPositiveNumber(day.dayNumber ?? day.day_number, index + 1) || index + 1;
    return {
      id: getString(day.id, `day-${dayNumber}`),
      dayNumber,
      date: getString(day.date, dateForDay(payload, dayNumber)),
      theme: getString(day.theme, `Day ${dayNumber}`),
      geographicArea: getString(day.geographicArea ?? day.geographic_area, payload.destination),
      priorityActivities: getStringList(day.priorityActivities ?? day.priority_activities, [], 4),
      arrivalRequirements: getStringList(day.arrivalRequirements ?? day.arrival_requirements, [], 5),
      departureRequirements: getStringList(day.departureRequirements ?? day.departure_requirements, [], 5),
      nextStartRequirement: getString(day.nextStartRequirement ?? day.next_start_requirement, "")
    };
  });

  if (days.length !== totalDays) {
    throw new StagedGenerationError(`Outline returned ${days.length} days for a ${totalDays}-day trip.`, "OUTLINE_DAY_COUNT_INVALID", 502, false, {
      failureCategory: "malformed_output"
    });
  }
  const seen = new Set<number>();
  for (const day of days) {
    if (day.dayNumber < 1 || day.dayNumber > totalDays || seen.has(day.dayNumber)) {
      throw new StagedGenerationError("Outline returned invalid or duplicate day numbers.", "OUTLINE_DAY_NUMBER_INVALID", 502, false, {
        failureCategory: "malformed_output"
      });
    }
    seen.add(day.dayNumber);
    if (!day.theme || !day.geographicArea) {
      throw new StagedGenerationError("Outline returned an empty day theme or area.", "OUTLINE_DAY_EMPTY", 502, false, {
        failureCategory: "malformed_output"
      });
    }
  }

  return {
    tripSummary: getString(record.tripSummary ?? record.trip_summary, `${payload.destination} itinerary`),
    hotelAreaRecommendation: getString(record.hotelAreaRecommendation ?? record.hotel_area_recommendation, payload.destination),
    importantConstraints: getStringList(record.importantConstraints ?? record.important_constraints, [], 8),
    days: days.sort((a, b) => a.dayNumber - b.dayNumber)
  };
}

function cleanItem(raw: unknown, fallbackTitle: string): RoamlyActivitySeed {
  const item = getRecord(raw) || {};
  const type = getString(item.item_type ?? item.itemType, getString(item.category, "activity")).toLowerCase();
  const itemType = (
    ["travel", "transfer", "hotel", "activity", "meal", "rest", "booking", "reminder"].includes(type)
      ? type
      : "activity"
  ) as NonNullable<RoamlyActivitySeed["item_type"]>;
  return {
    time_label: getString(item.time_label ?? item.timeLabel, getString(item.startTime ?? item.start_time, "09:00")),
    startTime: getString(item.startTime ?? item.start_time, ""),
    endTime: getString(item.endTime ?? item.end_time, ""),
    title: getString(item.title, fallbackTitle),
    description: getString(item.description, "Planned stop."),
    location_name: getString(item.location_name ?? item.locationName, ""),
    estimated_cost: getPositiveNumber(item.estimated_cost ?? item.estimatedCost, 0),
    category: getString(item.category, itemType),
    map_query: getString(item.map_query ?? item.mapQuery, getString(item.location_name ?? item.title, fallbackTitle)),
    item_type: itemType,
    travel_mode: getString(item.travel_mode ?? item.travelMode, ""),
    transportMode: getString(item.transportMode ?? item.transport_mode ?? item.travel_mode, ""),
    duration: getString(item.duration, ""),
    durationMinutes: getPositiveNumber(item.durationMinutes ?? item.duration_minutes, 0) || undefined,
    travelTimeMinutes: getPositiveNumber(item.travelTimeMinutes ?? item.travel_time_minutes, 0) || undefined,
    origin: getString(item.origin, ""),
    destination: getString(item.destination, ""),
    booking_label: getString(item.booking_label ?? item.bookingLabel, "") || undefined,
    affiliate_category: undefined,
    booking: undefined
  };
}

function cleanDay(raw: unknown, outlineDay: StagedTripOutlineDay, payload: TripPlannerPayload): RoamlyDayPlan {
  const record = getRecord(raw) || {};
  const dayNumber = getPositiveNumber(record.dayNumber ?? record.day_number, outlineDay.dayNumber) || outlineDay.dayNumber;
  const timelineRaw = Array.isArray(record.live_timeline) ? record.live_timeline : Array.isArray(record.items) ? record.items : [];
  const title = getString(record.title, outlineDay.theme);
  return {
    day_number: dayNumber,
    date: getString(record.date, outlineDay.date || dateForDay(payload, dayNumber)),
    city: getString(record.city, outlineDay.geographicArea),
    title,
    morning: getString(record.morning, outlineDay.priorityActivities.slice(0, 2).join(" and ") || title),
    afternoon: getString(record.afternoon, outlineDay.priorityActivities.slice(1, 3).join(" and ") || title),
    evening: getString(record.evening, "Easy evening near the hotel base."),
    food: getStringList(record.food, [], 4),
    estimated_cost: getPositiveNumber(record.estimated_cost ?? record.estimatedCost, 0),
    map_queries: getStringList(record.map_queries ?? record.mapQueries, [outlineDay.geographicArea], 6),
    live_timeline: timelineRaw.slice(0, 9).map((item, index) => cleanItem(item, `${title} stop ${index + 1}`))
  };
}

function cleanBatchDays(raw: unknown, outlineDays: StagedTripOutlineDay[], payload: TripPlannerPayload) {
  const record = getRecord(raw) || {};
  const rawDays = Array.isArray(record.days)
    ? record.days
    : Array.isArray(record.daily_itinerary)
      ? record.daily_itinerary
      : [];
  const daysByNumber = new Map(
    rawDays.map((item) => {
      const day = getRecord(item) || {};
      return [getPositiveNumber(day.dayNumber ?? day.day_number, 0), item] as const;
    })
  );
  return outlineDays.map((outlineDay) => cleanDay(daysByNumber.get(outlineDay.dayNumber), outlineDay, payload));
}

function parseTime(value?: string | null) {
  const raw = getString(value, "");
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function validateDay(day: RoamlyDayPlan, expectedDayNumber: number) {
  const errors: string[] = [];
  if (day.day_number !== expectedDayNumber) errors.push("Wrong day number.");
  if (!day.title.trim()) errors.push("Missing day title.");
  if (!day.live_timeline.length) errors.push("Timeline is empty.");
  let previousEnd: number | null = null;
  const seenTitles = new Set<string>();
  for (const item of day.live_timeline) {
    const titleKey = item.title.trim().toLowerCase();
    if (!titleKey) errors.push("Timeline item is missing a title.");
    if (seenTitles.has(titleKey)) errors.push(`Duplicate activity: ${item.title}.`);
    seenTitles.add(titleKey);
    const start = parseTime(item.startTime);
    const end = parseTime(item.endTime);
    if (start == null || end == null) errors.push(`${item.title} is missing valid HH:mm start/end time.`);
    if (start != null && end != null && end <= start) errors.push(`${item.title} ends before it starts.`);
    if (start != null && previousEnd != null && start < previousEnd) errors.push(`${item.title} overlaps the previous item.`);
    if (end != null) previousEnd = Math.max(previousEnd ?? 0, end);
  }
  return errors;
}

function completedDays(state: StagedGenerationState) {
  return Object.values(state.generatedDays).sort((a, b) => a.day_number - b.day_number);
}

function lastCompletedLocation(state: StagedGenerationState, beforeDay: number) {
  const previous = completedDays(state)
    .filter((day) => day.day_number < beforeDay)
    .at(-1);
  const lastItem = previous?.live_timeline.at(-1);
  return lastItem?.destination || lastItem?.location_name || previous?.city || "";
}

function usedAttractions(state: StagedGenerationState) {
  return completedDays(state).flatMap((day) =>
    day.live_timeline
      .filter((item) => item.item_type === "activity" || /activity|tour|ticket|museum|park|walk/i.test(item.category))
      .map((item) => item.title)
  );
}

function assembleItinerary(state: StagedGenerationState): RoamlyItinerary {
  const payload: TripPlannerPayload = {
    ...state.payload,
    priceDiscoveryId: state.priceDiscoveryId || state.payload.priceDiscoveryId || null,
    priceDiscovery: state.priceDiscovery || undefined,
    budgetConstraint: state.budgetConstraint || state.payload.budgetConstraint,
    confirmedBookings: state.confirmedBookings || undefined
  };
  const baseline = buildStarterItinerary(payload);
  const days = completedDays(state);
  const outline = state.outline;
  const raw: RoamlyItinerary = {
    ...baseline,
    trip_title: outline?.tripSummary ? baseline.trip_title : baseline.trip_title,
    destination_summary: outline?.tripSummary || baseline.destination_summary,
    route_reasoning: outline?.importantConstraints?.length
      ? `${baseline.route_reasoning} ${outline.importantConstraints.slice(0, 3).join(" ")}`
      : baseline.route_reasoning,
    hotel_area_suggestions: outline?.hotelAreaRecommendation
      ? [outline.hotelAreaRecommendation, ...baseline.hotel_area_suggestions].slice(0, 6)
      : baseline.hotel_area_suggestions,
    daily_itinerary: days,
    generation_note: state.status === "complete"
      ? "Generated through Roamly staged AI generation."
      : "Generation is in progress. Completed days are shown as they pass validation."
  };
  return enrichItineraryBookingSuggestions(repairItineraryForTravelRequirements(raw, payload), payload);
}

async function persistState(params: {
  supabase: SupabaseClient;
  trip: RoamlyTripRecord;
  state: StagedGenerationState;
}) {
  const state = {
    ...params.state,
    updatedAt: nowIso()
  };
  const current = await params.supabase
    .from("roamly_trips")
    .select("metadata")
    .eq("id", params.trip.id)
    .eq("user_id", params.trip.user_id)
    .maybeSingle();
  if (current.error) throw new StagedGenerationError(current.error.message, "GENERATION_STATE_LOAD_FAILED", 500);
  const metadataBase = getRecord(current.data?.metadata) || getRecord(params.trip.metadata) || {};
  const update = await params.supabase
    .from("roamly_trips")
    .update({
      metadata: generationMetadata(metadataBase, state),
      status: state.status === "complete" ? "generated" : state.status === "failed" ? "draft" : "generating",
      itinerary_status: state.status === "complete" ? "generated" : state.status === "failed" ? "draft" : "generating"
    })
    .eq("id", params.trip.id)
    .eq("user_id", params.trip.user_id);
  if (update.error) throw new StagedGenerationError(update.error.message, "GENERATION_STATE_SAVE_FAILED", 500);
  return state;
}

async function persistItinerary(params: {
  supabase: SupabaseClient;
  trip: RoamlyTripRecord;
  state: StagedGenerationState;
  final: boolean;
  requestId?: string;
}) {
  const itinerary = assembleItinerary(params.state);
  const sync = await syncGeneratedItinerary(params.supabase, {
    tripId: params.trip.id,
    userId: params.trip.user_id,
    itinerary,
    status: params.final ? "generated" : "preview",
    diagnostic: { requestId: params.requestId }
  });
  if (sync.error) throw new StagedGenerationError(sync.error, "ITINERARY_STORAGE_FAILED", 500);
  logGenerationDiagnostic(params.final ? "staged_generation_final_itinerary_saved" : "staged_generation_partial_itinerary_saved", {
    requestId: params.requestId,
    route: "stagedItineraryGeneration",
    tripId: params.trip.id,
    supabaseHost: getPublicSupabaseHost(),
    final: params.final,
    completedDayCount: params.state.completedDayCount,
    totalDayCount: params.state.totalDayCount,
    ...summarizeItineraryShape(itinerary)
  });
  return itinerary;
}

async function loadTrip(supabase: SupabaseClient, tripId: string, userId?: string) {
  let query = supabase.from("roamly_trips").select("*").eq("id", tripId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new StagedGenerationError(error.message, "TRIP_LOAD_FAILED", 500);
  if (!data) throw new StagedGenerationError("Trip not found.", "TRIP_NOT_FOUND", 404, true);
  return data as RoamlyTripRecord;
}

async function claimTrip(supabase: SupabaseClient, trip: RoamlyTripRecord, state: StagedGenerationState, requestId: string) {
  const leaseUntil = new Date(Date.now() + STAGE_LEASE_MS).toISOString();
  const existingLeaseUntil = state.worker?.leaseExpiresAt ? new Date(state.worker.leaseExpiresAt).getTime() : 0;
  if (existingLeaseUntil > Date.now() && state.worker?.leaseId !== requestId) {
    return null;
  }
  const claimedState = {
    ...state,
    worker: {
      leaseId: requestId,
      leaseExpiresAt: leaseUntil
    },
    updatedAt: nowIso()
  };
  const { data, error } = await supabase
    .from("roamly_trips")
    .update({ metadata: generationMetadata(trip.metadata, claimedState) })
    .eq("id", trip.id)
    .eq("user_id", trip.user_id)
    .eq("updated_at", trip.updated_at)
    .select("*")
    .maybeSingle();
  if (error) throw new StagedGenerationError(error.message, "GENERATION_CLAIM_FAILED", 500);
  return data ? (data as RoamlyTripRecord) : null;
}

function releaseLease(state: StagedGenerationState) {
  return {
    ...state,
    worker: null,
    updatedAt: nowIso()
  };
}

export async function prepareStagedGenerationContext(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  payload: TripPlannerPayload;
}) {
  const [committed, confirmedBookings] = await Promise.all([
    getConfirmedBookingCostCents(params.supabase, params.userId, params.tripId),
    getConfirmedBookingsForItinerary(params.supabase, params.userId, params.tripId)
  ]);
  const marketSearch = await searchTripMarketPrices(params.payload, {
    supabase: params.supabase,
    store: true
  });
  const discovery = await discoverTripPrices({
    userId: params.userId,
    tripId: params.tripId,
    ...params.payload,
    committedBudgetCents: committed.amountCents,
    confirmedBookings: confirmedBookings.bookings,
    marketResults: marketSearch.results
  });
  const savedDiscovery = await savePriceDiscovery(
    params.supabase,
    { userId: params.userId, tripId: params.tripId, ...params.payload },
    discovery
  );
  return {
    priceDiscovery: discovery as unknown as Record<string, unknown>,
    priceDiscoveryId: savedDiscovery.id || params.payload.priceDiscoveryId || null,
    budgetConstraint: buildBudgetConstraintForItinerary(discovery),
    confirmedBookings: confirmedBookings.bookings
  };
}

export async function startStagedItineraryGeneration(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
  payload: TripPlannerPayload;
  requestId: string;
  unlockSource: "free" | "paid" | "bundle" | "admin";
  qaTester?: boolean;
  context: Awaited<ReturnType<typeof prepareStagedGenerationContext>>;
}) {
  const dateRange = calculateTripDateRange(params.payload.startDate, params.payload.endDate);
  if (!dateRange.ok) throw new StagedGenerationError("Trip dates are invalid.", "INVALID_TRIP_DATES", 400, true);
  const totalDayCount = dateRange.days || params.payload.daysCount || 1;
  const payload = safePayloadForState({
    ...params.payload,
    daysCount: totalDayCount,
    priceDiscoveryId: params.context.priceDiscoveryId,
    budgetConstraint: params.context.budgetConstraint
  });
  const state: StagedGenerationState = {
    version: 2,
    status: "queued",
    currentStage: "generating_outline",
    totalDayCount,
    completedDayCount: 0,
    outline: null,
    days: buildInitialDayStates(payload, totalDayCount),
    batches: buildInitialBatchStates(totalDayCount),
    generatedDays: {},
    payload,
    priceDiscovery: params.context.priceDiscovery,
    priceDiscoveryId: params.context.priceDiscoveryId,
    budgetConstraint: params.context.budgetConstraint,
    confirmedBookings: params.context.confirmedBookings,
    unlockSource: params.unlockSource,
    qaTester: params.qaTester === true,
    outlineAttemptCount: 0,
    aiCallCount: 0,
    estimatedAiCostUsd: 0,
    aiInputTokens: 0,
    aiOutputTokens: 0,
    lastError: null,
    lastErrorCode: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    worker: null,
    trace: { requestId: params.requestId }
  };
  const trip = await loadTrip(params.supabase, params.tripId, params.userId);
  await persistState({ supabase: params.supabase, trip, state });
  await recordTripEvent(params.supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventType: "itinerary_generation_queued",
    eventTitle: "Itinerary generation queued",
    metadata: {
      staged: true,
      totalDayCount,
      destination: payload.destination
    }
  });
  logGenerationDiagnostic("staged_generation_queued", {
    requestId: params.requestId,
    route: "/api/trips/generate",
    tripId: params.tripId,
    supabaseHost: getPublicSupabaseHost(),
    totalDayCount
  });
  return state;
}

function nextBatchToGenerate(state: StagedGenerationState) {
  return Object.values(state.batches)
    .sort((a, b) => a.dayNumbers[0] - b.dayNumbers[0])
    .find((batch) => batch.status !== "complete" && batch.attemptCount < BATCH_ATTEMPT_LIMIT) || null;
}

function allResolved(state: StagedGenerationState) {
  return Object.values(state.batches).every((batch) => batch.status === "complete" || batch.status === "failed");
}

function finalValidationFailureState(
  state: StagedGenerationState,
  validationErrors: string[],
  attemptCount: number
): StagedGenerationState {
  return releaseLease({
    ...state,
    status: "failed",
    currentStage: "failed",
    finalValidationErrors: validationErrors,
    finalValidationAttemptCount: attemptCount,
    finalValidationRepairedAt: attemptCount > 1 ? nowIso() : state.finalValidationRepairedAt || null,
    lastError: validationErrors.join(" | "),
    lastErrorCode: "FINAL_VALIDATION_FAILED"
  });
}

async function completeGeneration(params: {
  supabase: SupabaseClient;
  trip: RoamlyTripRecord;
  state: StagedGenerationState;
  requestId: string;
}) {
  let state = {
    ...params.state,
    status: "enriching_transport" as StagedGenerationStatus,
    currentStage: "enriching_transport" as StagedGenerationStatus,
    updatedAt: nowIso()
  };
  await persistState({ supabase: params.supabase, trip: params.trip, state });
  state = {
    ...state,
    status: "enriching_affiliates",
    currentStage: "enriching_affiliates",
    updatedAt: nowIso()
  };
  await persistState({ supabase: params.supabase, trip: params.trip, state });
  const payload: TripPlannerPayload = {
    ...state.payload,
    priceDiscoveryId: state.priceDiscoveryId || null,
    priceDiscovery: state.priceDiscovery || undefined,
    budgetConstraint: state.budgetConstraint || undefined,
    confirmedBookings: state.confirmedBookings || undefined
  };
  let itinerary = assembleItinerary(state);
  let validation = validateItineraryForProduction(itinerary, payload);
  let validationAttemptCount = 1;
  if (!validation.ok) {
    itinerary = enrichItineraryBookingSuggestions(repairItineraryForTravelRequirements(itinerary, payload), payload);
    validation = validateItineraryForProduction(itinerary, payload);
    validationAttemptCount = 2;
    logGenerationDiagnostic("staged_generation_final_validation_repaired", {
      requestId: params.requestId,
      route: "stagedItineraryGeneration",
      tripId: params.trip.id,
      supabaseHost: getPublicSupabaseHost(),
      validationAttemptCount,
      finalValidationStillFailing: !validation.ok,
      failedCategories: classifyGenerationValidationErrors(validation.errors)
    });
  }
  if (!validation.ok) {
    const failed = finalValidationFailureState(state, validation.errors, validationAttemptCount);
    await persistItinerary({ supabase: params.supabase, trip: params.trip, state: failed, final: false, requestId: params.requestId });
    await persistState({ supabase: params.supabase, trip: params.trip, state: failed });
    logGenerationDiagnostic("staged_generation_final_validation_failed", {
      requestId: params.requestId,
      route: "stagedItineraryGeneration",
      tripId: params.trip.id,
      supabaseHost: getPublicSupabaseHost(),
      validationAttemptCount,
      failedRuleCount: validation.errors.length,
      failedCategories: classifyGenerationValidationErrors(validation.errors)
    });
    await sendGenerationEmailSafely({ tripId: params.trip.id, kind: "failure", requestId: params.requestId });
    return { state: failed, itinerary, validationFailed: true as const, validationErrors: validation.errors };
  }

  const completed = releaseLease({
    ...state,
    status: "complete",
    currentStage: "complete",
    completedDayCount: state.totalDayCount,
    completedAt: nowIso(),
    finalValidationErrors: [],
    finalValidationAttemptCount: validationAttemptCount,
    finalValidationRepairedAt: validationAttemptCount > 1 ? nowIso() : state.finalValidationRepairedAt || null,
    lastError: null,
    lastErrorCode: null
  });
  await persistItinerary({ supabase: params.supabase, trip: params.trip, state: completed, final: true, requestId: params.requestId });

  if (completed.unlockSource === "free") {
    const marked = await markFreeItineraryUsed(params.supabase, params.trip.user_id, params.trip.id);
    if (!marked.ok) {
      const failed = {
        ...completed,
        status: "failed" as StagedGenerationStatus,
        currentStage: "failed" as StagedGenerationStatus,
        lastError: "Free itinerary was already used.",
        lastErrorCode: "PAYMENT_REQUIRED"
      };
      await persistState({ supabase: params.supabase, trip: params.trip, state: failed });
      throw new StagedGenerationError("Your free itinerary was already used. Unlock this itinerary to continue.", "PAYMENT_REQUIRED", 402, true);
    }
  }

  const lock = await lockGeneratedItinerary(params.supabase, params.trip.user_id, params.trip.id, completed.unlockSource || "paid");
  if (lock.error) throw new StagedGenerationError(lock.error.message, "ITINERARY_LOCK_FAILED", 500);
  if (completed.qaTester) await unlockLiveCompanion(params.supabase, params.trip.id, "admin");
  await persistState({ supabase: params.supabase, trip: params.trip, state: completed });
  await recordTripEvent(params.supabase, {
    userId: params.trip.user_id,
    tripId: params.trip.id,
    eventType: "itinerary_generation_completed",
    eventTitle: "Itinerary generated and locked",
    metadata: {
      staged: true,
      totalDayCount: completed.totalDayCount,
      completedDayCount: completed.completedDayCount,
      model: completed.model || null
    }
  });
  await sendGenerationEmailSafely({ tripId: params.trip.id, kind: "completion", requestId: params.requestId });
  return { state: completed, itinerary, validationFailed: false as const, validationErrors: [] };
}

export async function advanceStagedItineraryGeneration(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId?: string;
  requestId: string;
}) {
  const initialTrip = await loadTrip(params.supabase, params.tripId, params.userId);
  const initialState = getStagedGenerationState(initialTrip.metadata);
  if (!initialState) throw new StagedGenerationError("No staged generation job exists for this trip.", "GENERATION_JOB_NOT_FOUND", 404, true);
  if (initialState.status === "complete" || initialState.status === "failed" || initialState.status === "partially_failed") {
    await sendGenerationEmailSafely({
      tripId: params.tripId,
      kind: initialState.status === "complete" ? "completion" : "failure",
      requestId: params.requestId
    });
    return { ok: true, status: initialState.status, state: initialState, advanced: false };
  }

  const claimedTrip = await claimTrip(params.supabase, initialTrip, initialState, params.requestId);
  if (!claimedTrip) {
    return { ok: true, status: initialState.status, state: initialState, advanced: false, busy: true };
  }
  let state = getStagedGenerationState(claimedTrip.metadata) || initialState;
  const trace = { requestId: params.requestId, tripId: params.tripId, route: "stagedItineraryGeneration" };

  try {
    if (!state.outline) {
      state = {
        ...state,
        status: "generating_outline",
        currentStage: "generating_outline",
        updatedAt: nowIso()
      };
      await persistState({ supabase: params.supabase, trip: claimedTrip, state });
      const outlineAttemptCount = (state.outlineAttemptCount || 0) + 1;
      state = {
        ...state,
        outlineAttemptCount
      };
      const prompt = outlinePrompt(state.payload, state);
      const provider = providerForAttempt();
      assertCostBudget(state, prompt, OUTLINE_MAX_TOKENS, provider);
      const ai = await callJsonStage({
        stage: "outline",
        prompt,
        maxTokens: OUTLINE_MAX_TOKENS,
        timeoutMs: OUTLINE_TIMEOUT_MS,
        attemptNumber: outlineAttemptCount,
        provider,
        trace
      });
      state = addAiUsage(appendStageRun({ ...state, provider: ai.provider, model: ai.model }, {
        stage: "outline",
        batchId: null,
        dayNumbers: null,
        provider: ai.provider,
        model: ai.model,
        attemptNumber: outlineAttemptCount,
        status: "success",
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        estimatedCostUsd: Number(ai.estimatedCostUsd.toFixed(8)),
        durationMs: ai.durationMs,
        failureCategory: null,
        errorCode: null
      }), ai);
      const outline = cleanOutline(ai.parsed, state.payload, state.totalDayCount);
      state = releaseLease({
        ...state,
        status: "generating_day",
        currentStage: "generating_day",
        outline,
        outlineAttemptCount,
        provider: ai.provider,
        model: ai.model,
        lastError: null,
        lastErrorCode: null
      });
      await persistState({ supabase: params.supabase, trip: claimedTrip, state });
      logGenerationDiagnostic("staged_outline_completed", {
        requestId: params.requestId,
        route: "stagedItineraryGeneration",
        tripId: params.tripId,
        supabaseHost: getPublicSupabaseHost(),
        totalDayCount: state.totalDayCount,
        inputCharacters: ai.inputCharacters,
        outputCharacters: ai.outputCharacters,
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        estimatedCostUsd: Number(ai.estimatedCostUsd.toFixed(8)),
        cumulativeCostUsd: state.estimatedAiCostUsd,
        aiCallCount: state.aiCallCount,
        durationMs: ai.durationMs,
        provider: ai.provider,
        model: ai.model
      });
      return { ok: true, status: state.status, state, advanced: true, stage: "outline" };
    }

    const nextBatch = nextBatchToGenerate(state);
    if (nextBatch) {
      const outlineDays = nextBatch.dayNumbers
        .map((dayNumber) => state.outline?.days.find((day) => day.dayNumber === dayNumber))
        .filter((day): day is StagedTripOutlineDay => Boolean(day));
      const outline = state.outline;
      if (!outline) throw new StagedGenerationError("Outline is missing.", "OUTLINE_MISSING", 502);
      if (outlineDays.length !== nextBatch.dayNumbers.length) {
        throw new StagedGenerationError("Outline is missing one or more requested batch days.", "OUTLINE_DAY_NOT_FOUND", 502);
      }
      const attemptCount = nextBatch.attemptCount + 1;
      state = {
        ...state,
        status: "generating_day",
        currentStage: "generating_day",
        batches: {
          ...state.batches,
          [nextBatch.id]: {
            ...nextBatch,
            status: "generating",
            attemptCount,
            startedAt: nextBatch.startedAt || nowIso(),
            updatedAt: nowIso(),
            lastError: null
          }
        },
        days: {
          ...state.days,
          ...Object.fromEntries(nextBatch.dayNumbers.map((dayNumber) => [
            String(dayNumber),
            {
              ...state.days[String(dayNumber)],
              dayNumber,
              status: "generating" as StagedDayStatus,
              attemptCount,
              startedAt: state.days[String(dayNumber)]?.startedAt || nowIso(),
              updatedAt: nowIso(),
              lastError: null
            }
          ]))
        }
      };
      await persistState({ supabase: params.supabase, trip: claimedTrip, state });
      const prompt = dayBatchPrompt({
        payload: state.payload,
        outline,
        days: outlineDays,
        previousEndingLocation: lastCompletedLocation(state, nextBatch.dayNumbers[0]),
        nextStartRequirement:
          outline.days.find((day) => day.dayNumber === nextBatch.dayNumbers[nextBatch.dayNumbers.length - 1] + 1)?.nextStartRequirement || "",
        usedAttractions: usedAttractions(state),
        state
      });
      const provider = providerForAttempt();
      assertCostBudget(state, prompt, DAY_MAX_TOKENS, provider);
      const ai = await callJsonStage({
        stage: "day_batch",
        prompt,
        maxTokens: DAY_MAX_TOKENS,
        timeoutMs: DAY_TIMEOUT_MS,
        attemptNumber: attemptCount,
        provider,
        trace
      });
      state = addAiUsage(appendStageRun({ ...state, provider: ai.provider, model: ai.model }, {
        stage: "day_batch",
        batchId: nextBatch.id,
        dayNumbers: nextBatch.dayNumbers,
        provider: ai.provider,
        model: ai.model,
        attemptNumber: attemptCount,
        status: "success",
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        estimatedCostUsd: Number(ai.estimatedCostUsd.toFixed(8)),
        durationMs: ai.durationMs,
        failureCategory: null,
        errorCode: null
      }), ai);
      const batchDays = cleanBatchDays(ai.parsed, outlineDays, state.payload);
      const batchErrors = batchDays.flatMap((day) => validateDay(day, day.day_number));
      for (const dayNumber of nextBatch.dayNumbers) {
        if (!batchDays.some((day) => day.day_number === dayNumber)) {
          batchErrors.push(`Batch missing Day ${dayNumber}.`);
        }
      }
      if (batchErrors.length) {
        throw new StagedGenerationError(batchErrors.slice(0, 4).join(" | "), "DAY_BATCH_VALIDATION_FAILED", 502, false, {
          failureCategory: "malformed_output",
          provider: ai.provider,
          model: ai.model
        });
      }
      const completedAt = nowIso();
      const completedDayStates = Object.fromEntries(nextBatch.dayNumbers.map((dayNumber) => [
        String(dayNumber),
        {
          ...state.days[String(dayNumber)],
          dayNumber,
          status: "complete" as StagedDayStatus,
          attemptCount,
          updatedAt: completedAt,
          completedAt,
          lastError: null
        }
      ]));
      state = releaseLease({
        ...state,
        status: "generating_day",
        currentStage: "generating_day",
        completedDayCount: Object.values(state.days).filter((item) => item.status === "complete").length + batchDays.length,
        provider: ai.provider,
        model: ai.model,
        generatedDays: {
          ...state.generatedDays,
          ...Object.fromEntries(batchDays.map((day) => [String(day.day_number), day]))
        },
        batches: {
          ...state.batches,
          [nextBatch.id]: {
            ...state.batches[nextBatch.id],
            status: "complete",
            attemptCount,
            provider: ai.provider,
            model: ai.model,
            inputTokens: ai.inputTokens,
            outputTokens: ai.outputTokens,
            estimatedCostUsd: Number(ai.estimatedCostUsd.toFixed(8)),
            completedAt,
            updatedAt: completedAt,
            lastError: null
          }
        },
        days: {
          ...state.days,
          ...completedDayStates
        },
        lastError: null,
        lastErrorCode: null
      });
      await persistItinerary({ supabase: params.supabase, trip: claimedTrip, state, final: false, requestId: params.requestId });
      await persistState({ supabase: params.supabase, trip: claimedTrip, state });
      logGenerationDiagnostic("staged_day_batch_completed", {
        requestId: params.requestId,
        route: "stagedItineraryGeneration",
        tripId: params.tripId,
        supabaseHost: getPublicSupabaseHost(),
        batchId: nextBatch.id,
        dayNumbers: nextBatch.dayNumbers,
        completedDayCount: state.completedDayCount,
        totalDayCount: state.totalDayCount,
        inputCharacters: ai.inputCharacters,
        outputCharacters: ai.outputCharacters,
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        estimatedCostUsd: Number(ai.estimatedCostUsd.toFixed(8)),
        cumulativeCostUsd: state.estimatedAiCostUsd,
        aiCallCount: state.aiCallCount,
        durationMs: ai.durationMs,
        provider: ai.provider,
        model: ai.model
      });
      return { ok: true, status: state.status, state, advanced: true, stage: "day_batch", batchId: nextBatch.id, dayNumbers: nextBatch.dayNumbers };
    }

    if (allResolved(state) && Object.values(state.batches).some((batch) => batch.status === "failed")) {
      const partial = releaseLease({
        ...state,
        status: "partially_failed",
        currentStage: "partially_failed",
        lastError: "One or more days failed after bounded retries.",
        lastErrorCode: "DAY_PARTIAL_FAILURE"
      });
      await persistState({ supabase: params.supabase, trip: claimedTrip, state: partial });
      await sendGenerationEmailSafely({ tripId: params.tripId, kind: "failure", requestId: params.requestId });
      return { ok: true, status: partial.status, state: partial, advanced: false };
    }

    const completed = await completeGeneration({ supabase: params.supabase, trip: claimedTrip, state, requestId: params.requestId });
    if (completed.validationFailed) {
      return {
        ok: false,
        status: completed.state.status,
        state: completed.state,
        advanced: false,
        stage: "complete",
        error: "FINAL_VALIDATION_FAILED"
      };
    }
    return { ok: true, status: completed.state.status, state: completed.state, advanced: true, stage: "complete" };
  } catch (error) {
    const generationError = error instanceof StagedGenerationError
      ? error
      : new StagedGenerationError("Generation stage failed.", "GENERATION_STAGE_FAILED", 502);

    if (!state.outline) {
      const exhausted = generationError.permanent || (state.outlineAttemptCount || 0) >= BATCH_ATTEMPT_LIMIT;
      const updatedState = releaseLease(appendStageRun({
        ...state,
        status: exhausted ? "failed" : "generating_outline",
        currentStage: exhausted ? "failed" : "generating_outline",
        lastError: generationError.message,
        lastErrorCode: generationError.code
      }, {
        stage: "outline",
        batchId: null,
        dayNumbers: null,
        provider: generationError.provider || state.provider || null,
        model: generationError.model || state.model || null,
        attemptNumber: state.outlineAttemptCount || 1,
        status: "failed",
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        durationMs: null,
        failureCategory: generationError.failureCategory,
        errorCode: generationError.code
      }));
      await persistState({ supabase: params.supabase, trip: claimedTrip, state: updatedState });
      logGenerationDiagnostic("staged_generation_stage_failed", {
        requestId: params.requestId,
        route: "stagedItineraryGeneration",
        tripId: params.tripId,
        supabaseHost: getPublicSupabaseHost(),
        status: generationError.status,
        errorCode: generationError.code,
        stage: "outline",
        permanent: generationError.permanent,
        exhausted
      });
      if (updatedState.status === "failed") {
        await sendGenerationEmailSafely({ tripId: params.tripId, kind: "failure", requestId: params.requestId });
      }
      if (generationError.permanent || exhausted) throw generationError;
      return { ok: false, status: updatedState.status, state: updatedState, advanced: false, error: generationError.code };
    }

    const failedBatch =
      Object.values(state.batches).find((batch) => batch.status === "generating") ||
      Object.values(state.batches).find((batch) => batch.status !== "complete");
    const exhausted = generationError.permanent || Boolean(failedBatch && failedBatch.attemptCount >= BATCH_ATTEMPT_LIMIT);
    const failedBatchState = failedBatch
      ? {
          ...failedBatch,
          status: exhausted ? "failed" as StagedDayStatus : "queued" as StagedDayStatus,
          lastError: generationError.code,
          updatedAt: nowIso()
        }
      : null;
    const failedDayStates = failedBatchState
      ? Object.fromEntries(failedBatchState.dayNumbers.map((dayNumber) => [
          String(dayNumber),
          {
            ...state.days[String(dayNumber)],
            dayNumber,
            status: failedBatchState.status,
            lastError: generationError.code,
            updatedAt: nowIso()
          }
        ]))
      : {};
    const updatedState = releaseLease(appendStageRun({
      ...state,
      status: exhausted && failedBatchState ? "generating_day" : state.status,
      currentStage: failedBatchState ? "generating_day" : "failed",
      batches: failedBatchState
        ? {
            ...state.batches,
            [failedBatchState.id]: failedBatchState
          }
        : state.batches,
      days: {
        ...state.days,
        ...failedDayStates
      },
      lastError: generationError.message,
      lastErrorCode: generationError.code
    }, {
      stage: "day_batch",
      batchId: failedBatch?.id || null,
      dayNumbers: failedBatch?.dayNumbers || null,
      provider: generationError.provider || state.provider || failedBatch?.provider || null,
      model: generationError.model || state.model || failedBatch?.model || null,
      attemptNumber: failedBatch?.attemptCount || 1,
      status: "failed",
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      durationMs: null,
      failureCategory: generationError.failureCategory,
      errorCode: generationError.code
    }));
    await persistState({ supabase: params.supabase, trip: claimedTrip, state: updatedState });
    logGenerationDiagnostic("staged_generation_stage_failed", {
      requestId: params.requestId,
      route: "stagedItineraryGeneration",
      tripId: params.tripId,
      supabaseHost: getPublicSupabaseHost(),
      status: generationError.status,
      errorCode: generationError.code,
      batchId: failedBatch?.id || null,
      dayNumbers: failedBatch?.dayNumbers || null,
      permanent: generationError.permanent
    });
    if (generationError.permanent || !failedBatch) throw generationError;
    return { ok: false, status: updatedState.status, state: updatedState, advanced: false, error: generationError.code };
  }
}

export async function resetFailedStagedBatch(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
  batchId: string;
}) {
  const trip = await loadTrip(params.supabase, params.tripId, params.userId);
  const state = getStagedGenerationState(trip.metadata);
  if (!state) throw new StagedGenerationError("No staged generation job exists for this trip.", "GENERATION_JOB_NOT_FOUND", 404, true);
  const batch = state.batches[params.batchId];
  if (!batch) throw new StagedGenerationError("Generation batch not found.", "GENERATION_BATCH_NOT_FOUND", 404, true);
  if (batch.attemptCount >= BATCH_ATTEMPT_LIMIT) {
    throw new StagedGenerationError("This batch has reached the retry ceiling.", "BATCH_RETRY_LIMIT_REACHED", 429, true);
  }
  const nextState = {
    ...state,
    status: "generating_day" as StagedGenerationStatus,
    currentStage: "generating_day" as StagedGenerationStatus,
    batches: {
      ...state.batches,
      [params.batchId]: {
        ...batch,
        status: "queued" as StagedDayStatus,
        lastError: null,
        updatedAt: nowIso()
      }
    },
    days: {
      ...state.days,
      ...Object.fromEntries(batch.dayNumbers.map((dayNumber) => [
        String(dayNumber),
        {
          ...state.days[String(dayNumber)],
          dayNumber,
          status: "queued" as StagedDayStatus,
          lastError: null,
          updatedAt: nowIso()
        }
      ]))
    },
    lastError: null,
    lastErrorCode: null,
    worker: null,
    updatedAt: nowIso()
  };
  await persistState({ supabase: params.supabase, trip, state: nextState });
  return nextState;
}

export function publicStagedGenerationProgress(metadata: unknown) {
  const state = getStagedGenerationState(metadata);
  if (!state) return null;
  const days = Object.values(state.days)
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date || null,
      status: day.status,
      attemptCount: day.attemptCount,
      lastError: day.lastError || null
    }));
  const batches = Object.values(state.batches)
    .sort((a, b) => a.dayNumbers[0] - b.dayNumbers[0])
    .map((batch) => ({
      id: batch.id,
      dayNumbers: batch.dayNumbers,
      status: batch.status,
      attemptCount: batch.attemptCount,
      lastError: batch.lastError || null,
      estimatedCostUsd: batch.estimatedCostUsd || null,
      inputTokens: batch.inputTokens || null,
      outputTokens: batch.outputTokens || null,
      model: batch.model || null
    }));
  return {
    status: state.status,
    currentStage: state.currentStage,
    completedDayCount: state.completedDayCount,
    totalDayCount: state.totalDayCount,
    days,
    batches,
    aiCallCount: state.aiCallCount || 0,
    estimatedAiCostUsd: state.estimatedAiCostUsd || 0,
    aiInputTokens: state.aiInputTokens || 0,
    aiOutputTokens: state.aiOutputTokens || 0,
    lastErrorCode: state.lastErrorCode || null,
    finalValidationErrors: state.finalValidationErrors || [],
    finalValidationAttemptCount: state.finalValidationAttemptCount || 0,
    provider: state.provider || null,
    model: state.model || null,
    stageRuns: (state.stageRuns || []).map((run) => ({
      id: run.id,
      stage: run.stage,
      batchId: run.batchId || null,
      dayNumbers: run.dayNumbers || null,
      provider: run.provider || null,
      model: run.model || null,
      attemptNumber: run.attemptNumber,
      status: run.status,
      inputTokens: run.inputTokens || null,
      outputTokens: run.outputTokens || null,
      estimatedCostUsd: run.estimatedCostUsd || null,
      durationMs: run.durationMs || null,
      failureCategory: run.failureCategory || null,
      errorCode: run.errorCode || null,
      createdAt: run.createdAt
    })),
    retryLimit: BATCH_ATTEMPT_LIMIT,
    emailNotification: getGenerationEmailStatus(metadata),
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt || null
  };
}
