import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateSuccessfulTripExperiencePatterns, isPublishableSuccessfulTripPattern } from "@/lib/roamly/successfulTripExperiencePatterns";
import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

export async function runSuccessfulTripExperiencePatternAggregation(admin: SupabaseClient) {
  const records: Array<{ experienceContext: SuccessfulTripExperienceContext | null }> = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await admin
      .from("trip_feedback")
      .select("experience_context_json")
      .eq("feedback_type", "post_trip")
      .not("experience_context_json", "is", null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) return { ok: false as const, error: error.message, feedbackRowsRead: records.length, patternsWritten: 0 };

    const rows = (data || []).filter((row) => row.experience_context_json && typeof row.experience_context_json === "object" && !Array.isArray(row.experience_context_json));
    records.push(...rows.map((row) => ({ experienceContext: row.experience_context_json as unknown as SuccessfulTripExperienceContext })));
    if (rows.length < PAGE_SIZE) break;
  }

  const patterns = aggregateSuccessfulTripExperiencePatterns(records)
    .filter((pattern) => isPublishableSuccessfulTripPattern(pattern));
  if (!patterns.length) {
    return { ok: true as const, feedbackRowsRead: records.length, qualifyingPatterns: 0, patternsWritten: 0 };
  }

  const { error } = await admin.from("successful_trip_experience_patterns").upsert(
    patterns.map((pattern) => ({
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
    })),
    { onConflict: "pattern_key" }
  );
  if (error) return { ok: false as const, error: error.message, feedbackRowsRead: records.length, patternsWritten: 0 };
  return { ok: true as const, feedbackRowsRead: records.length, qualifyingPatterns: patterns.length, patternsWritten: patterns.length };
}
