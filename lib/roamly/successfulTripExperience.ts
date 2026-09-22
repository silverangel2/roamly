import type { TripFeedbackInput } from "@/lib/roamly/tripFeedback";

type TripExperienceSource = {
  destination?: unknown;
  destination_city?: unknown;
  destination_country?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  travelers_count?: unknown;
  travel_style?: unknown;
  accommodation_preference?: unknown;
  transportation_preference?: unknown;
  metadata?: unknown;
};

type ItineraryExperienceSource = {
  daily_itinerary?: unknown;
  estimated_budget_breakdown?: unknown;
};

export type SuccessfulTripExperienceContext = {
  schemaVersion: 1;
  destinationKey: string | null;
  durationDays: number | null;
  travelersCount: number | null;
  travelStyle: string | null;
  accommodationPreference: string | null;
  transportationPreference: string | null;
  dayCount: number;
  plannedItemCount: number;
  flexibleItemCount: number;
  estimatedBudgetCategoryCount: number;
  feedbackSignals: {
    overallSatisfaction: number | null;
    itineraryPace: string | null;
    scheduleRealism: number | null;
    budgetAccuracy: number | null;
    hotelLocationSatisfaction: number | null;
    hotelQualitySatisfaction: number | null;
    transportationSatisfaction: number | null;
    wouldUseRoamlyAgain: boolean | null;
  };
};

function text(value: unknown, limit = 120): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, limit) : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function durationDays(start: unknown, end: unknown): number | null {
  const startDate = typeof start === "string" ? new Date(`${start}T00:00:00Z`) : null;
  const endDate = typeof end === "string" ? new Date(`${end}T00:00:00Z`) : null;
  if (!startDate || !endDate || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return null;
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  return days >= 0 && days <= 90 ? days + 1 : null;
}

function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

export function buildSuccessfulTripExperienceContext(
  trip: TripExperienceSource,
  itinerary: ItineraryExperienceSource,
  feedback: TripFeedbackInput
): SuccessfulTripExperienceContext {
  const days = list(itinerary.daily_itinerary);
  const items = days.flatMap((day) => [
    ...list(day.live_timeline),
    ...list(day.activities),
    ...list(day.items)
  ]);
  const metadata = trip.metadata && typeof trip.metadata === "object" && !Array.isArray(trip.metadata)
    ? trip.metadata as Record<string, unknown>
    : {};
  const planning = metadata.planning && typeof metadata.planning === "object" && !Array.isArray(metadata.planning)
    ? metadata.planning as Record<string, unknown>
    : {};
  const destination = text(trip.destination_city) || text(trip.destination) || text(planning.destinationCity) || text(planning.destination);
  const country = text(trip.destination_country) || text(planning.destinationCountry);
  const destinationKey = destination ? [destination.toLowerCase(), country?.toLowerCase()].filter(Boolean).join(",") : null;
  const categoryCount = itinerary.estimated_budget_breakdown && typeof itinerary.estimated_budget_breakdown === "object" && !Array.isArray(itinerary.estimated_budget_breakdown)
    ? Object.keys(itinerary.estimated_budget_breakdown as Record<string, unknown>).length
    : 0;

  return {
    schemaVersion: 1,
    destinationKey,
    durationDays: durationDays(trip.start_date, trip.end_date),
    travelersCount: positiveInteger(trip.travelers_count),
    travelStyle: text(trip.travel_style) || text(planning.travelStyle),
    accommodationPreference: text(trip.accommodation_preference) || text(planning.accommodationPreference),
    transportationPreference: text(trip.transportation_preference) || text(planning.transportationPreference),
    dayCount: days.length,
    plannedItemCount: items.filter((item) => item.status !== "flexible" && item.authority !== "flexible").length,
    flexibleItemCount: items.filter((item) => item.status === "flexible" || item.authority === "flexible").length,
    estimatedBudgetCategoryCount: categoryCount,
    feedbackSignals: {
      overallSatisfaction: feedback.overallSatisfaction ?? null,
      itineraryPace: text(feedback.itineraryPace, 40),
      scheduleRealism: feedback.scheduleRealism ?? null,
      budgetAccuracy: feedback.budgetAccuracy ?? null,
      hotelLocationSatisfaction: feedback.hotelLocationSatisfaction ?? null,
      hotelQualitySatisfaction: feedback.hotelQualitySatisfaction ?? null,
      transportationSatisfaction: feedback.transportationSatisfaction ?? null,
      wouldUseRoamlyAgain: feedback.wouldUseRoamlyAgain ?? null
    }
  };
}

export function qualifiesAsSuccessfulTripExperience(context: SuccessfulTripExperienceContext): boolean {
  return context.feedbackSignals.overallSatisfaction !== null
    && context.feedbackSignals.overallSatisfaction >= 4
    && context.feedbackSignals.wouldUseRoamlyAgain === true;
}
