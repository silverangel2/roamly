import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SuccessfulTripExperiencePattern = {
  patternKey: string;
  destinationKey: string | null;
  travelStyle: string | null;
  accommodationPreference: string | null;
  transportationPreference: string | null;
  durationBucket: string;
  travelersBucket: string;
  sampleCount: number;
  /**
   * Distinct source trips behind this pattern. Weighted sampleCount can exceed
   * this (booking-proven library records weigh 2); publishability requires
   * BOTH thresholds so a couple of reviews never crown a "best".
   */
  sourceTripCount: number;
  /**
   * "solid" once >= 5 distinct trips back the pattern, else "limited".
   * Surfaced to the generator so low-evidence guidance stays anecdotal.
   */
  evidenceStrength: "limited" | "solid";
  /** Majority budget band of the source trips (null when unknown/tied). */
  budgetBand: string | null;
  /** Row recency for weighting; null when the column is unavailable. */
  updatedAt: string | null;
  averageSatisfaction: number | null;
  averageScheduleRealism: number | null;
  averageBudgetAccuracy: number | null;
  averageHotelLocationSatisfaction: number | null;
  averageHotelQualitySatisfaction: number | null;
  averageTransportationSatisfaction: number | null;
};

export type AggregatePatternPlanningInput = {
  destination?: string | null;
  destinationCity?: string | null;
  destinationCountry?: string | null;
  daysCount?: number | null;
  travelersCount?: number | null;
  travelStyle?: string | null;
  accommodationPreference?: string | null;
  transportationPreference?: string | null;
  /** Total trip budget (same currency convention as the trip row; default CAD). */
  budgetAmount?: number | null;
};

const MAX_PLANNING_PATTERNS = 5;
const MIN_PUBLISHED_SAMPLES = 3;
const SOLID_EVIDENCE_TRIPS = 5;

/**
 * Budget bands, CAD-anchored (matches roamly_trips.budget_currency default).
 * v1 heuristic for soft guidance matching only — never a price claim.
 */
const BUDGET_BAND_LIMITS: Array<[number, string]> = [
  [1500, "budget"],
  [4000, "midrange"],
  [10000, "premium"]
];

export function budgetBandForAmount(amount: unknown): string | null {
  const number = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : NaN;
  if (!Number.isFinite(number) || number < 0) return null;
  for (const [limit, band] of BUDGET_BAND_LIMITS) {
    if (number < limit) return band;
  }
  return "luxury";
}

function cleanText(value: unknown, limit = 120) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function cleanNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function destinationKey(input: AggregatePatternPlanningInput) {
  const city = cleanText(input.destinationCity) || cleanText(input.destination);
  const country = cleanText(input.destinationCountry);
  return city ? [city.toLowerCase(), country.toLowerCase()].filter(Boolean).join(",") : "";
}

function durationBucketForPlanning(days: number | null | undefined) {
  if (!Number.isFinite(days) || !days || days <= 0) return "unknown";
  if (days <= 3) return "1-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

function travelersBucketForPlanning(count: number | null | undefined) {
  if (!Number.isFinite(count) || !count || count <= 0) return "unknown";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count <= 4) return "3-4";
  return "5+";
}

function normalizedPlanningValue(value: unknown) {
  return cleanText(value, 80).toLowerCase() || "unknown";
}

function matchesDimension(patternValue: unknown, currentValue: unknown) {
  const pattern = normalizedPlanningValue(patternValue);
  return pattern === "unknown" || pattern === normalizedPlanningValue(currentValue);
}

/**
 * Budget-band soft matching rank: exact band first, unknown band neutral,
 * mismatched band last. No trip budget → no reordering (rank 0 for all).
 * This is guidance ranking only — never a hard filter.
 */
function budgetBandRank(patternBand: string | null, currentBand: string | null) {
  if (!currentBand) return 0;
  if (!patternBand) return 1;
  return patternBand === currentBand ? 0 : 2;
}

function compareUpdatedAtDesc(left: string | null, right: string | null) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? 1 : -1;
}

function evidenceStrengthFor(sourceTripCount: number): "limited" | "solid" {
  return sourceTripCount >= SOLID_EVIDENCE_TRIPS ? "solid" : "limited";
}

function safePattern(row: unknown): SuccessfulTripExperiencePattern | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  // Accept both DB rows (snake_case, from readRelevantSuccessfulTripPatterns)
  // and in-memory patterns (camelCase, from stored generation state).
  const patternKey = cleanText(value.pattern_key ?? value.patternKey, 240);
  const sampleCount = cleanNumber(value.sample_count ?? value.sampleCount);
  const durationBucket = cleanText(value.duration_bucket ?? value.durationBucket, 20);
  const travelersBucket = cleanText(value.travelers_bucket ?? value.travelersBucket, 20);
  if (!patternKey || sampleCount === null || sampleCount < MIN_PUBLISHED_SAMPLES || !durationBucket || !travelersBucket) return null;
  // Small-sample caution: source_trip_count may be absent (migration not yet
  // applied) — then it falls back to sample_count, which is exact for the
  // feedback-sourced rows that dominate the table today.
  const sourceTripCountRaw = cleanNumber(value.source_trip_count ?? value.sourceTripCount);
  const sourceTripCount = sourceTripCountRaw == null ? Math.floor(sampleCount) : Math.floor(sourceTripCountRaw);
  if (sourceTripCount < MIN_PUBLISHED_SAMPLES) return null;
  const evidenceStrength = typeof value.evidenceStrength === "string" && value.evidenceStrength === "solid"
    ? "solid"
    : evidenceStrengthFor(sourceTripCount);
  return {
    patternKey,
    destinationKey: cleanText(value.destination_key ?? value.destinationKey, 160) || null,
    travelStyle: cleanText(value.travel_style ?? value.travelStyle, 80) || null,
    accommodationPreference: cleanText(value.accommodation_preference ?? value.accommodationPreference, 120) || null,
    transportationPreference: cleanText(value.transportation_preference ?? value.transportationPreference, 120) || null,
    durationBucket,
    travelersBucket,
    sampleCount: Math.floor(sampleCount),
    sourceTripCount,
    evidenceStrength,
    budgetBand: cleanText(value.budget_band ?? value.budgetBand, 40).toLowerCase() || null,
    updatedAt: typeof (value.updated_at ?? value.updatedAt) === "string" ? (value.updated_at ?? value.updatedAt) as string : null,
    averageSatisfaction: cleanNumber(value.average_satisfaction ?? value.averageSatisfaction),
    averageScheduleRealism: cleanNumber(value.average_schedule_realism ?? value.averageScheduleRealism),
    averageBudgetAccuracy: cleanNumber(value.average_budget_accuracy ?? value.averageBudgetAccuracy),
    averageHotelLocationSatisfaction: cleanNumber(value.average_hotel_location_satisfaction ?? value.averageHotelLocationSatisfaction),
    averageHotelQualitySatisfaction: cleanNumber(value.average_hotel_quality_satisfaction ?? value.averageHotelQualitySatisfaction),
    averageTransportationSatisfaction: cleanNumber(value.average_transportation_satisfaction ?? value.averageTransportationSatisfaction)
  };
}

export function selectRelevantSuccessfulTripPatterns(
  rows: unknown[],
  input: AggregatePatternPlanningInput,
  limit = MAX_PLANNING_PATTERNS
) {
  const currentDestination = destinationKey(input);
  if (!currentDestination) return [] as SuccessfulTripExperiencePattern[];
  const currentDuration = durationBucketForPlanning(input.daysCount);
  const currentTravelers = travelersBucketForPlanning(input.travelersCount);
  const currentBudgetBand = budgetBandForAmount(input.budgetAmount);
  return rows
    .map(safePattern)
    .filter((pattern): pattern is SuccessfulTripExperiencePattern => Boolean(pattern))
    .filter((pattern) => (pattern.destinationKey || "").toLowerCase() === currentDestination)
    .filter((pattern) => matchesDimension(pattern.durationBucket, currentDuration))
    .filter((pattern) => matchesDimension(pattern.travelersBucket, currentTravelers))
    .filter((pattern) => matchesDimension(pattern.travelStyle, input.travelStyle))
    .filter((pattern) => matchesDimension(pattern.accommodationPreference, input.accommodationPreference))
    .filter((pattern) => matchesDimension(pattern.transportationPreference, input.transportationPreference))
    .sort((left, right) => budgetBandRank(left.budgetBand, currentBudgetBand) - budgetBandRank(right.budgetBand, currentBudgetBand) ||
      right.sampleCount - left.sampleCount ||
      compareUpdatedAtDesc(left.updatedAt, right.updatedAt) ||
      (right.averageSatisfaction || 0) - (left.averageSatisfaction || 0) ||
      left.patternKey.localeCompare(right.patternKey))
    .slice(0, Math.max(0, Math.min(limit, MAX_PLANNING_PATTERNS)));
}

const PATTERN_BASE_COLUMNS = "pattern_key,destination_key,travel_style,accommodation_preference,transportation_preference,duration_bucket,travelers_bucket,sample_count,average_satisfaction,average_schedule_realism,average_budget_accuracy,average_hotel_location_satisfaction,average_hotel_quality_satisfaction,average_transportation_satisfaction";
const PATTERN_EXTENDED_COLUMNS = `${PATTERN_BASE_COLUMNS},budget_band,source_trip_count,updated_at`;

async function queryPatternRows(supabase: SupabaseClient, columns: string, currentDestination: string) {
  return supabase
    .from("successful_trip_experience_patterns")
    .select(columns)
    .eq("destination_key", currentDestination)
    .gte("sample_count", MIN_PUBLISHED_SAMPLES)
    .order("sample_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("pattern_key", { ascending: true })
    .limit(MAX_PLANNING_PATTERNS * 4);
}

export async function readRelevantSuccessfulTripPatterns(params: {
  supabase: SupabaseClient;
  input: AggregatePatternPlanningInput;
}) {
  const currentDestination = destinationKey(params.input);
  if (!currentDestination) return [] as SuccessfulTripExperiencePattern[];
  try {
    let result = await queryPatternRows(params.supabase, PATTERN_EXTENDED_COLUMNS, currentDestination);
    if (result.error && /budget_band|source_trip_count/i.test(result.error.message)) {
      // Migration 20261015000100 not applied yet: fall back to the base
      // columns. safePattern treats the missing columns as unknown.
      result = await queryPatternRows(params.supabase, PATTERN_BASE_COLUMNS, currentDestination);
    }
    if (result.error) return [] as SuccessfulTripExperiencePattern[];
    return selectRelevantSuccessfulTripPatterns((result.data || []) as unknown[], params.input);
  } catch {
    return [] as SuccessfulTripExperiencePattern[];
  }
}

export type SuccessfulTripExperienceContextRecord = {
  experienceContext: SuccessfulTripExperienceContext | null;
  /**
   * Source weight for aggregation. Booking-proven itinerary-library records
   * weigh 2 (highest); feedback-sourced records weigh 1 (default).
   */
  weight?: number;
  /** Budget band of the source trip; null when unknown. */
  budgetBand?: string | null;
};

function recordWeight(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function qualifiesAsSuccessfulTripExperience(context: SuccessfulTripExperienceContext) {
  return context.feedbackSignals.overallSatisfaction !== null
    && context.feedbackSignals.overallSatisfaction >= 4
    && context.feedbackSignals.wouldUseRoamlyAgain === true;
}

function normalized(value: string | null) {
  return value?.trim().toLowerCase() || "unknown";
}

function durationBucket(days: number | null) {
  if (days == null) return "unknown";
  if (days <= 3) return "1-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

function travelersBucket(count: number | null) {
  if (count == null) return "unknown";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count <= 4) return "3-4";
  return "5+";
}

function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function weightedAverage(values: Array<number | null>, weights: number[]) {
  let weightedSum = 0;
  let weightTotal = 0;
  values.forEach((value, index) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      const weight = weights[index] ?? 1;
      weightedSum += value * weight;
      weightTotal += weight;
    }
  });
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

function majorityBudgetBand(records: SuccessfulTripExperienceContextRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const record of records) {
    const band = typeof record.budgetBand === "string" && record.budgetBand ? record.budgetBand.toLowerCase() : null;
    if (!band) continue;
    counts.set(band, (counts.get(band) || 0) + recordWeight(record.weight));
  }
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [band, count] of counts) {
    if (count > bestCount) {
      best = band;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export function aggregateSuccessfulTripExperiencePatterns(records: SuccessfulTripExperienceContextRecord[]): SuccessfulTripExperiencePattern[] {
  const groups = new Map<string, SuccessfulTripExperienceContextRecord[]>();

  for (const record of records) {
    const context = record.experienceContext;
    if (!context || !qualifiesAsSuccessfulTripExperience(context)) continue;
    const duration = durationBucket(context.durationDays);
    const travelers = travelersBucket(context.travelersCount);
    const key = [
      normalized(context.destinationKey),
      normalized(context.travelStyle),
      normalized(context.accommodationPreference),
      normalized(context.transportationPreference),
      duration,
      travelers
    ].join("|");
    groups.set(key, [...(groups.get(key) || []), record]);
  }

  return [...groups.entries()].map(([patternKey, groupRecords]) => {
    const contexts = groupRecords.map((record) => record.experienceContext as SuccessfulTripExperienceContext);
    const weights = groupRecords.map((record) => recordWeight(record.weight));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const sourceTripCount = groupRecords.length;
    const first = contexts[0];
    return {
      patternKey,
      destinationKey: first.destinationKey,
      travelStyle: first.travelStyle,
      accommodationPreference: first.accommodationPreference,
      transportationPreference: first.transportationPreference,
      durationBucket: durationBucket(first.durationDays),
      travelersBucket: travelersBucket(first.travelersCount),
      sampleCount: Math.max(1, Math.round(totalWeight)),
      sourceTripCount,
      evidenceStrength: evidenceStrengthFor(sourceTripCount),
      budgetBand: majorityBudgetBand(groupRecords),
      updatedAt: null,
      averageSatisfaction: weightedAverage(contexts.map((context) => context.feedbackSignals.overallSatisfaction), weights),
      averageScheduleRealism: weightedAverage(contexts.map((context) => context.feedbackSignals.scheduleRealism), weights),
      averageBudgetAccuracy: weightedAverage(contexts.map((context) => context.feedbackSignals.budgetAccuracy), weights),
      averageHotelLocationSatisfaction: weightedAverage(contexts.map((context) => context.feedbackSignals.hotelLocationSatisfaction), weights),
      averageHotelQualitySatisfaction: weightedAverage(contexts.map((context) => context.feedbackSignals.hotelQualitySatisfaction), weights),
      averageTransportationSatisfaction: weightedAverage(contexts.map((context) => context.feedbackSignals.transportationSatisfaction), weights)
    };
  }).sort((left, right) => right.sampleCount - left.sampleCount || left.patternKey.localeCompare(right.patternKey));
}

export function isPublishableSuccessfulTripPattern(pattern: SuccessfulTripExperiencePattern, minimumSamples = 3) {
  // Small-sample caution: weighted sampleCount alone must not publish —
  // the distinct trip count has to clear the bar too, so a couple of
  // booking-proven reviews can never crown a "best".
  const distinctTrips = Number.isFinite(pattern.sourceTripCount) ? pattern.sourceTripCount : pattern.sampleCount;
  return pattern.sampleCount >= minimumSamples && distinctTrips >= minimumSamples;
}
