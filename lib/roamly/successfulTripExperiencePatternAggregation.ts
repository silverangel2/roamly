import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateSuccessfulTripExperiencePatterns, isPublishableSuccessfulTripPattern, type SuccessfulTripExperienceContextRecord } from "@/lib/roamly/successfulTripExperiencePatterns";
import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";
import { readItineraryLibraryExperienceRecords } from "@/lib/roamly/itineraryLibraryAggregation";
import { readIngesterLibraryRecords } from "@/lib/roamly/itineraryIngester";

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

export async function runSuccessfulTripExperiencePatternAggregation(admin: SupabaseClient) {
  const records: SuccessfulTripExperienceContextRecord[] = [];
  const latestFeedbackByTrip = new Map<string, { createdAt: string; experienceContext: SuccessfulTripExperienceContext }>();
  let feedbackRowsRead = 0;

  for (let page = 0; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin
      .from("trip_feedback")
      .select("trip_id,created_at,experience_context_json")
      .eq("feedback_type", "post_trip")
      .not("experience_context_json", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) return { ok: false as const, error: error.message, feedbackRowsRead, patternsWritten: 0 };

    const pageRows = data || [];
    feedbackRowsRead += pageRows.length;
    if (page === MAX_PAGES && pageRows.length) {
      return { ok: false as const, error: "FEEDBACK_SCAN_LIMIT_REACHED", feedbackRowsRead, patternsWritten: 0 };
    }
    const rows = pageRows.filter((row) => row.experience_context_json && typeof row.experience_context_json === "object" && !Array.isArray(row.experience_context_json));
    for (const row of rows) {
      const tripId = String(row.trip_id || "");
      const createdAt = String(row.created_at || "");
      if (!tripId) continue;
      const current = latestFeedbackByTrip.get(tripId);
      if (!current || createdAt >= current.createdAt) {
        latestFeedbackByTrip.set(tripId, {
          createdAt,
          experienceContext: row.experience_context_json as unknown as SuccessfulTripExperienceContext
        });
      }
    }
    if (pageRows.length < PAGE_SIZE) break;
  }

  records.push(...[...latestFeedbackByTrip.values()].map(({ experienceContext }) => ({ experienceContext })));

  // Itinerary Library lane: consenting traveler submissions with booking-proof
  // item verdicts enter the same patterns, weighted highest (weight 2).
  // Fail-soft: returns [] when the library tables do not exist yet.
  const libraryRecords = await readItineraryLibraryExperienceRecords(admin);
  records.push(...libraryRecords);

  // Itinerary Ingester lane: library records (eligible rows only — generated
  // plans are never pattern-eligible by the ingester's own gate). Fail-soft:
  // returns [] when the ingester tables do not exist yet.
  const ingesterRecords = await readIngesterLibraryRecords(admin);
  records.push(...ingesterRecords);

  const patterns = aggregateSuccessfulTripExperiencePatterns(records)
    .filter((pattern) => isPublishableSuccessfulTripPattern(pattern));
  if (!patterns.length) {
    return { ok: true as const, feedbackRowsRead: records.length, libraryRecordsRead: libraryRecords.length, qualifyingPatterns: 0, patternsWritten: 0 };
  }

  const baseRows = patterns.map((pattern) => ({
    pattern_key: pattern.patternKey,
    destination_key: pattern.destinationKey,
    travel_style: pattern.travelStyle,
    accommodation_preference: pattern.accommodationPreference,
    transportation_preference: pattern.transportationPreference,
    duration_bucket: pattern.durationBucket,
    travelers_bucket: pattern.travelersBucket,
    sample_count: pattern.sampleCount,
    average_satisfaction: pattern.averageSatisfaction,
    average_schedule_realism: pattern.averageScheduleRealism,
    average_budget_accuracy: pattern.averageBudgetAccuracy,
    average_hotel_location_satisfaction: pattern.averageHotelLocationSatisfaction,
    average_hotel_quality_satisfaction: pattern.averageHotelQualitySatisfaction,
    average_transportation_satisfaction: pattern.averageTransportationSatisfaction,
    updated_at: new Date().toISOString()
  }));
  const extendedRows = baseRows.map((row, index) => ({
    ...row,
    source_trip_count: patterns[index].sourceTripCount,
    budget_band: patterns[index].budgetBand
  }));

  // Graceful degradation: if migration 20261015000100 (budget_band,
  // source_trip_count) is not applied yet, the feedback lane must keep
  // writing — fall back to the base columns instead of failing the run.
  let { error } = await admin.from("successful_trip_experience_patterns").upsert(extendedRows, { onConflict: "pattern_key" });
  if (error && /budget_band|source_trip_count/i.test(error.message)) {
    ({ error } = await admin.from("successful_trip_experience_patterns").upsert(baseRows, { onConflict: "pattern_key" }));
  }
  if (error) return { ok: false as const, error: error.message, feedbackRowsRead: records.length, patternsWritten: 0 };
  return { ok: true as const, feedbackRowsRead: records.length, libraryRecordsRead: libraryRecords.length, qualifyingPatterns: patterns.length, patternsWritten: patterns.length };
}
