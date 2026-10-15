import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";
import {
  budgetBandForAmount,
  type SuccessfulTripExperienceContextRecord
} from "@/lib/roamly/successfulTripExperiencePatterns";

/**
 * Itinerary Library → pattern aggregation bridge.
 *
 * Converts consenting itinerary submissions (+ their booking-proof item
 * verdicts) into SuccessfulTripExperienceContext records that the shared
 * aggregateSuccessfulTripExperiencePatterns() understands.
 *
 * Weighting: every record produced here is booking-proven (each verdict ties
 * to the traveler's own booking wallet), so these records carry weight 2 —
 * the highest source weight. Feedback-sourced records keep weight 1.
 *
 * Qualification mirrors the feedback lane: only trips the traveler rates
 * highly (average item rating >= 4) feed the *successful-trip* patterns.
 * Lower-rated submissions stay in the library for display and future
 * item-level learning but do not crown "successful" patterns.
 *
 * Consent gate: only submissions with consent_anonymized_reuse = true are
 * read. Fail-soft: missing tables (migration not yet applied) → [].
 */

export const ITINERARY_LIBRARY_RECORD_WEIGHT = 2;
const MIN_AVERAGE_RATING_FOR_SUCCESS = 4;

function cleanText(value: unknown, limit = 120): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, limit) : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function durationDays(start: unknown, end: unknown): number | null {
  const startDate = typeof start === "string" ? new Date(`${start.slice(0, 10)}T00:00:00Z`) : null;
  const endDate = typeof end === "string" ? new Date(`${end.slice(0, 10)}T00:00:00Z`) : null;
  if (!startDate || !endDate || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return null;
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  return days >= 0 && days <= 90 ? days + 1 : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function isMissingTableError(message: string) {
  return /schema cache|could not find the table|relation .* does not exist|42P01/i.test(message || "");
}

type SubmissionRow = {
  id: string;
  trip_id: string;
  destination: string | null;
  destination_city: string | null;
  destination_country: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

type VerdictRow = {
  submission_id: string;
  item_type: string | null;
  rating: number | null;
};

type TripRow = {
  id: string;
  travelers_count: number | null;
  travel_style: string | null;
  accommodation_preference: string | null;
  transportation_preference: string | null;
  budget_amount: number | null;
};

function buildContext(
  submission: SubmissionRow,
  verdicts: VerdictRow[],
  trip: TripRow | null
): SuccessfulTripExperienceContext | null {
  const destination = cleanText(submission.destination_city) || cleanText(submission.destination);
  const country = cleanText(submission.destination_country);
  const destinationKey = destination ? [destination.toLowerCase(), country?.toLowerCase()].filter(Boolean).join(",") : null;
  if (!destinationKey) return null;

  const ratings = verdicts.map((verdict) => verdict.rating).filter((rating): rating is number => typeof rating === "number");
  const overallSatisfaction = ratings.length ? Math.round(average(ratings) || 0) : null;
  // Successful-trip gate: a submission only feeds "successful" patterns when the
  // traveler rates the trip highly overall.
  if (overallSatisfaction == null || overallSatisfaction < MIN_AVERAGE_RATING_FOR_SUCCESS) return null;

  const hotelRatings = verdicts.filter((verdict) => verdict.item_type === "hotel").map((verdict) => verdict.rating);
  const flightRatings = verdicts.filter((verdict) => verdict.item_type === "flight").map((verdict) => verdict.rating);

  return {
    schemaVersion: 1,
    destinationKey,
    durationDays: durationDays(submission.start_date, submission.end_date),
    travelersCount: positiveInteger(trip?.travelers_count),
    travelStyle: cleanText(trip?.travel_style),
    accommodationPreference: cleanText(trip?.accommodation_preference),
    transportationPreference: cleanText(trip?.transportation_preference),
    dayCount: 0,
    plannedItemCount: verdicts.length,
    flexibleItemCount: 0,
    estimatedBudgetCategoryCount: 0,
    feedbackSignals: {
      overallSatisfaction,
      itineraryPace: null,
      scheduleRealism: null,
      budgetAccuracy: null,
      hotelLocationSatisfaction: average(hotelRatings) != null ? Math.round(average(hotelRatings) || 0) : null,
      hotelQualitySatisfaction: average(hotelRatings) != null ? Math.round(average(hotelRatings) || 0) : null,
      transportationSatisfaction: average(flightRatings) != null ? Math.round(average(flightRatings) || 0) : null,
      // Sharing a trip as "proven" is itself the would-use-again signal.
      wouldUseRoamlyAgain: true
    }
  };
}

/**
 * Read consenting itinerary submissions as weighted experience records.
 * Returns [] when the library tables do not exist yet or on any read error.
 */
export async function readItineraryLibraryExperienceRecords(
  admin: SupabaseClient
): Promise<SuccessfulTripExperienceContextRecord[]> {
  try {
    const { data: submissions, error: submissionsError } = await admin
      .from("itinerary_submissions")
      .select("id,trip_id,destination,destination_city,destination_country,start_date,end_date,created_at")
      .eq("consent_anonymized_reuse", true)
      .eq("status", "received")
      .order("created_at", { ascending: true })
      .limit(2000);
    if (submissionsError) {
      if (isMissingTableError(submissionsError.message)) return [];
      return [];
    }
    const submissionRows = (submissions || []) as SubmissionRow[];
    if (!submissionRows.length) return [];

    const submissionIds = submissionRows.map((row) => row.id);
    const tripIds = [...new Set(submissionRows.map((row) => row.trip_id).filter(Boolean))];

    const [verdictsResult, tripsResult] = await Promise.all([
      admin
        .from("item_verdicts")
        .select("submission_id,item_type,rating")
        .in("submission_id", submissionIds)
        .limit(20000),
      tripIds.length
        ? admin
          .from("roamly_trips")
          .select("id,travelers_count,travel_style,accommodation_preference,transportation_preference,budget_amount")
          .in("id", tripIds)
        : Promise.resolve({ data: [] as TripRow[], error: null })
    ]);
    if (verdictsResult.error) return [];
    if (tripsResult.error) return [];

    const verdictsBySubmission = new Map<string, VerdictRow[]>();
    for (const verdict of (verdictsResult.data || []) as VerdictRow[]) {
      const list = verdictsBySubmission.get(verdict.submission_id) || [];
      list.push(verdict);
      verdictsBySubmission.set(verdict.submission_id, list);
    }
    const tripsById = new Map<string, TripRow>();
    for (const trip of (tripsResult.data || []) as TripRow[]) tripsById.set(trip.id, trip);

    const records: SuccessfulTripExperienceContextRecord[] = [];
    for (const submission of submissionRows) {
      const trip = tripsById.get(submission.trip_id) || null;
      const context = buildContext(submission, verdictsBySubmission.get(submission.id) || [], trip);
      if (!context) continue;
      records.push({
        experienceContext: context,
        weight: ITINERARY_LIBRARY_RECORD_WEIGHT,
        budgetBand: budgetBandForAmount(trip?.budget_amount)
      });
    }
    return records;
  } catch {
    return [];
  }
}
