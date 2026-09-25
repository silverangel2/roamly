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
};

const MAX_PLANNING_PATTERNS = 5;
const MIN_PUBLISHED_SAMPLES = 3;

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

function safePattern(row: unknown): SuccessfulTripExperiencePattern | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  const patternKey = cleanText(value.pattern_key, 240);
  const sampleCount = cleanNumber(value.sample_count);
  const durationBucket = cleanText(value.duration_bucket, 20);
  const travelersBucket = cleanText(value.travelers_bucket, 20);
  if (!patternKey || sampleCount === null || sampleCount < MIN_PUBLISHED_SAMPLES || !durationBucket || !travelersBucket) return null;
  return {
    patternKey,
    destinationKey: cleanText(value.destination_key, 160) || null,
    travelStyle: cleanText(value.travel_style, 80) || null,
    accommodationPreference: cleanText(value.accommodation_preference, 120) || null,
    transportationPreference: cleanText(value.transportation_preference, 120) || null,
    durationBucket,
    travelersBucket,
    sampleCount: Math.floor(sampleCount),
    averageSatisfaction: cleanNumber(value.average_satisfaction),
    averageScheduleRealism: cleanNumber(value.average_schedule_realism),
    averageBudgetAccuracy: cleanNumber(value.average_budget_accuracy),
    averageHotelLocationSatisfaction: cleanNumber(value.average_hotel_location_satisfaction),
    averageHotelQualitySatisfaction: cleanNumber(value.average_hotel_quality_satisfaction),
    averageTransportationSatisfaction: cleanNumber(value.average_transportation_satisfaction)
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
  return rows
    .map(safePattern)
    .filter((pattern): pattern is SuccessfulTripExperiencePattern => Boolean(pattern))
    .filter((pattern) => (pattern.destinationKey || "").toLowerCase() === currentDestination)
    .filter((pattern) => matchesDimension(pattern.durationBucket, currentDuration))
    .filter((pattern) => matchesDimension(pattern.travelersBucket, currentTravelers))
    .filter((pattern) => matchesDimension(pattern.travelStyle, input.travelStyle))
    .filter((pattern) => matchesDimension(pattern.accommodationPreference, input.accommodationPreference))
    .filter((pattern) => matchesDimension(pattern.transportationPreference, input.transportationPreference))
    .sort((left, right) => right.sampleCount - left.sampleCount ||
      (right.averageSatisfaction || 0) - (left.averageSatisfaction || 0) ||
      left.patternKey.localeCompare(right.patternKey))
    .slice(0, Math.max(0, Math.min(limit, MAX_PLANNING_PATTERNS)));
}

export async function readRelevantSuccessfulTripPatterns(params: {
  supabase: SupabaseClient;
  input: AggregatePatternPlanningInput;
}) {
  const currentDestination = destinationKey(params.input);
  if (!currentDestination) return [] as SuccessfulTripExperiencePattern[];
  try {
    const result = await params.supabase
      .from("successful_trip_experience_patterns")
      .select("pattern_key,destination_key,travel_style,accommodation_preference,transportation_preference,duration_bucket,travelers_bucket,sample_count,average_satisfaction,average_schedule_realism,average_budget_accuracy,average_hotel_location_satisfaction,average_hotel_quality_satisfaction,average_transportation_satisfaction")
      .eq("destination_key", currentDestination)
      .gte("sample_count", MIN_PUBLISHED_SAMPLES)
      .order("sample_count", { ascending: false })
      .order("updated_at", { ascending: false })
      .order("pattern_key", { ascending: true })
      .limit(MAX_PLANNING_PATTERNS * 4);
    if (result.error) return [] as SuccessfulTripExperiencePattern[];
    return selectRelevantSuccessfulTripPatterns((result.data || []) as unknown[], params.input);
  } catch {
    return [] as SuccessfulTripExperiencePattern[];
  }
}

type ContextRecord = {
  experienceContext: SuccessfulTripExperienceContext | null;
};

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

export function aggregateSuccessfulTripExperiencePatterns(records: ContextRecord[]): SuccessfulTripExperiencePattern[] {
  const groups = new Map<string, SuccessfulTripExperienceContext[]>();

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
    groups.set(key, [...(groups.get(key) || []), context]);
  }

  return [...groups.entries()].map(([patternKey, contexts]) => {
    const first = contexts[0];
    return {
      patternKey,
      destinationKey: first.destinationKey,
      travelStyle: first.travelStyle,
      accommodationPreference: first.accommodationPreference,
      transportationPreference: first.transportationPreference,
      durationBucket: durationBucket(first.durationDays),
      travelersBucket: travelersBucket(first.travelersCount),
      sampleCount: contexts.length,
      averageSatisfaction: average(contexts.map((context) => context.feedbackSignals.overallSatisfaction)),
      averageScheduleRealism: average(contexts.map((context) => context.feedbackSignals.scheduleRealism)),
      averageBudgetAccuracy: average(contexts.map((context) => context.feedbackSignals.budgetAccuracy)),
      averageHotelLocationSatisfaction: average(contexts.map((context) => context.feedbackSignals.hotelLocationSatisfaction)),
      averageHotelQualitySatisfaction: average(contexts.map((context) => context.feedbackSignals.hotelQualitySatisfaction)),
      averageTransportationSatisfaction: average(contexts.map((context) => context.feedbackSignals.transportationSatisfaction))
    };
  }).sort((left, right) => right.sampleCount - left.sampleCount || left.patternKey.localeCompare(right.patternKey));
}

export function isPublishableSuccessfulTripPattern(pattern: SuccessfulTripExperiencePattern, minimumSamples = 3) {
  return pattern.sampleCount >= minimumSamples;
}
