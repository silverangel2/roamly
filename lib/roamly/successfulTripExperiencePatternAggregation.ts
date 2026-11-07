import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateSuccessfulTripExperiencePatterns, isPublishableSuccessfulTripPattern, type SuccessfulTripExperienceContextRecord } from "@/lib/roamly/successfulTripExperiencePatterns";
import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";
import { readItineraryLibraryExperienceRecords } from "@/lib/roamly/itineraryLibraryAggregation";
import { readIngesterLibraryRecords } from "@/lib/roamly/itineraryIngester";
import { readLibraryTripExperienceRecords } from "@/lib/roamly/libraryIngest";
import { recordAppEvent } from "@/lib/roamly/events";

const PAGE_SIZE = 500;
const MAX_PAGES = 100;

/**
 * GAP-CLOSURE 5b-2 (2026-11-02) — processed-watermark for the daily
 * feedback scan. Before this change every run paged ALL post_trip
 * trip_feedback rows (projected, but unbounded in count) to rebuild
 * latestFeedbackByTrip from scratch. The watermark persists the
 * scan position AND the latest-per-trip snapshot itself in the
 * EXISTING roamly_app_events store (recordAppEvent — the same store
 * cronHeartbeat uses; no new table): the latest event of type
 * SUCCESSFUL_TRIP_PATTERNS_CURSOR_EVENT_TYPE carries metadata
 * { cursorCreatedAt, cursorId, latestByTrip }.
 *
 * Run law:
 *  - No cursor event (first run ever, or the events read failed —
 *    fail-soft, matching recordAppEvent's own posture): full scan
 *    exactly as before, then write the cursor.
 *  - Cursor present: the snapshot seeds latestFeedbackByTrip and
 *    the feedback query reads ONLY rows strictly after the cursor
 *    in the run's own ordering (created_at asc, id asc) via the
 *    .or() predicate created_at > cursor OR (created_at = cursor
 *    AND id > cursorId); rows merge under the same latest-per-trip
 *    rule (createdAt >= current wins), so the aggregated output is
 *    identical to a full re-aggregation over the whole table.
 *  - The cursor advances ONLY on success: it is written after a
 *    successful patterns upsert, and also on the empty-patterns
 *    early return (the scan succeeded and the snapshot is current
 *    there — returning without advancing would re-read the same new
 *    rows every day forever). A failed scan or failed upsert writes
 *    nothing, so the next run re-reads from the old position.
 *  - A run that reads zero new rows does not rewrite the cursor:
 *    position and snapshot are unchanged, so there is nothing to
 *    advance (the write would be a byte-identical duplicate event).
 *  - The cursor position is the last row the QUERY returned (before
 *    the in-code experience_context object filter): rows the filter
 *    drops (non-object contexts) are dropped by a full scan too, so
 *    advancing past them preserves exact output equivalence.
 *  - A cursor WRITE failure never fails the run (recordAppEvent is
 *    best-effort): the cost is one re-scan next run, never wrong
 *    patterns.
 *
 * The three library lanes below are deliberately NOT watermarked:
 * they push whole record sets into the same aggregation each run
 * and have no created_at-ordered latest-per-key semantics here, so
 * watermarking them would alter outputs. Their read bounds, for the
 * record: readItineraryLibraryExperienceRecords — itinerary_
 * submissions .limit(2000) + item_verdicts .limit(20000);
 * readIngesterLibraryRecords — itinerary library records
 * .limit(2000); readLibraryTripExperienceRecords — library trips
 * .limit(2000). All bounded; the unbounded lane was this one.
 */
export const SUCCESSFUL_TRIP_PATTERNS_CURSOR_EVENT_TYPE = "successful_trip_patterns_cursor";

type LatestFeedbackEntry = { createdAt: string; experienceContext: SuccessfulTripExperienceContext };
type FeedbackCursor = {
  cursorCreatedAt: string | null;
  cursorId: string | null;
  latestFeedbackByTrip: Map<string, LatestFeedbackEntry>;
};

async function readFeedbackCursor(admin: SupabaseClient): Promise<FeedbackCursor | null> {
  try {
    // The getCronHeartbeatStatus read pattern: latest event of the
    // type, newest first, limit 1.
    const { data, error } = await admin
      .from("roamly_app_events")
      .select("created_at,metadata")
      .eq("event_type", SUCCESSFUL_TRIP_PATTERNS_CURSOR_EVENT_TYPE)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    const metadata = (data[0] as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    const record = metadata as Record<string, unknown>;
    const snapshot = record.latestByTrip;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
    const latestFeedbackByTrip = new Map<string, LatestFeedbackEntry>();
    for (const [tripId, entry] of Object.entries(snapshot as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const fields = entry as Record<string, unknown>;
      if (typeof fields.createdAt !== "string") continue;
      if (!fields.experienceContext || typeof fields.experienceContext !== "object" || Array.isArray(fields.experienceContext)) continue;
      latestFeedbackByTrip.set(tripId, {
        createdAt: fields.createdAt,
        experienceContext: fields.experienceContext as SuccessfulTripExperienceContext
      });
    }
    return {
      cursorCreatedAt: typeof record.cursorCreatedAt === "string" ? record.cursorCreatedAt : null,
      cursorId: record.cursorId == null ? null : String(record.cursorId),
      latestFeedbackByTrip
    };
  } catch {
    return null; // fail-soft: no readable cursor = full scan, as before
  }
}

async function writeFeedbackCursor(
  admin: SupabaseClient,
  cursorCreatedAt: string,
  cursorId: string,
  latestFeedbackByTrip: Map<string, LatestFeedbackEntry>
): Promise<void> {
  const latestByTrip: Record<string, LatestFeedbackEntry> = {};
  for (const [tripId, entry] of latestFeedbackByTrip) latestByTrip[tripId] = entry;
  try {
    await recordAppEvent(admin, {
      eventType: SUCCESSFUL_TRIP_PATTERNS_CURSOR_EVENT_TYPE,
      metadata: { cursorCreatedAt, cursorId, latestByTrip }
    });
  } catch {
    // Best-effort by law (see header): a lost cursor write costs a
    // re-scan next run, never a failed run.
  }
}

export async function runSuccessfulTripExperiencePatternAggregation(admin: SupabaseClient) {
  const records: SuccessfulTripExperienceContextRecord[] = [];
  const cursor = await readFeedbackCursor(admin);
  const latestFeedbackByTrip = cursor ? cursor.latestFeedbackByTrip : new Map<string, LatestFeedbackEntry>();
  let feedbackRowsRead = 0;
  // The cursor position after this run's scan: the last row the
  // query returned, in the run's own (created_at asc, id asc) order.
  let lastRowRead: { createdAt: string; id: string } | null = null;

  for (let page = 0; page <= MAX_PAGES; page += 1) {
    let query = admin
      .from("trip_feedback")
      .select("id,trip_id,created_at,experience_context_json")
      .eq("feedback_type", "post_trip")
      .not("experience_context_json", "is", null);
    if (cursor && cursor.cursorCreatedAt && cursor.cursorId) {
      // Strictly after the cursor in (created_at, id) order.
      query = query.or(
        `created_at.gt.${cursor.cursorCreatedAt},and(created_at.eq.${cursor.cursorCreatedAt},id.gt.${cursor.cursorId})`
      );
    }
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) return { ok: false as const, error: error.message, feedbackRowsRead, patternsWritten: 0 };

    const pageRows = data || [];
    feedbackRowsRead += pageRows.length;
    if (page === MAX_PAGES && pageRows.length) {
      return { ok: false as const, error: "FEEDBACK_SCAN_LIMIT_REACHED", feedbackRowsRead, patternsWritten: 0 };
    }
    if (pageRows.length) {
      const last = pageRows[pageRows.length - 1];
      lastRowRead = { createdAt: String(last.created_at || ""), id: String(last.id || "") };
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

  // Build 2 library lane (Phase 10): trips ingested by the post-trip
  // loop (outstanding + verified as-lived, M9) enter the same patterns
  // as weighted records, linked to their archived trips. Fail-soft:
  // returns [] when the library table does not exist yet.
  const libraryTripRecords = await readLibraryTripExperienceRecords(admin);
  records.push(...libraryTripRecords);

  const patterns = aggregateSuccessfulTripExperiencePatterns(records)
    .filter((pattern) => isPublishableSuccessfulTripPattern(pattern));
  if (!patterns.length) {
    // GAP-CLOSURE 5b-2 deliberate choice: the scan SUCCEEDED and the
    // snapshot is current, so the cursor still advances on this
    // early return — otherwise the same new rows would be re-read
    // every day for as long as no pattern qualifies.
    if (lastRowRead) await writeFeedbackCursor(admin, lastRowRead.createdAt, lastRowRead.id, latestFeedbackByTrip);
    return { ok: true as const, feedbackRowsRead: records.length, libraryRecordsRead: libraryRecords.length, libraryTripRecordsRead: libraryTripRecords.length, qualifyingPatterns: 0, patternsWritten: 0 };
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
  // GAP-CLOSURE 5b-2: the cursor is written ONLY here (and on the
  // empty-patterns early return above) — after the upsert succeeded.
  // Every failure return above leaves the old cursor in place.
  if (lastRowRead) await writeFeedbackCursor(admin, lastRowRead.createdAt, lastRowRead.id, latestFeedbackByTrip);
  return { ok: true as const, feedbackRowsRead: records.length, libraryRecordsRead: libraryRecords.length, libraryTripRecordsRead: libraryTripRecords.length, qualifyingPatterns: patterns.length, patternsWritten: patterns.length };
}
