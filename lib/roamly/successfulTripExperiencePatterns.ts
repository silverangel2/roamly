import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";

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
