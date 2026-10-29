// lib/roamly/liveItineraryFallback.ts — pure Live itinerary fallback
// (correction phase D5, 2026-10-28).
//
// When a trip's activities were never materialized into
// roamly_trip_activities (seeded trips, and any trip whose tracking
// rows are absent), Live's Full Itinerary tab was empty even though
// the itinerary JSON exists — the same source the trip page renders.
// This helper builds the fallback days from that JSON, with honest
// Planned labels (FACTUAL only when the row's timing_status says
// so). Rows carry no activity ids, so no tracking action can attach
// to them; the client renders them read-only. No times are invented:
// a row without a time field renders without a time.
//
// Pure function: no I/O, no mutation. Inputs are coerced defensively
// (unknown shapes) because itinerary JSON is user-shaped data.

export type LiveItineraryFallbackActivity = {
  title: string;
  timeLabel: string | null;
  status: string;
  mapQuery: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type LiveItineraryFallbackDay = {
  dayNumber: number;
  /** Same type as the tracked days' label: tripDayDateLabel returns
   *  null when the trip has no usable start date. */
  dateLabel: string | null;
  activities: LiveItineraryFallbackActivity[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function itineraryDaysFromDailyItinerary(
  dailyItinerary: ReadonlyArray<{ day_number: unknown; live_timeline?: readonly unknown[] | null }>,
  dateLabelForDay: (dayNumber: number) => string | null
): LiveItineraryFallbackDay[] {
  return dailyItinerary
    .map((day) => {
      const dayNumber = typeof day.day_number === "number" ? day.day_number : Number(day.day_number);
      return {
        dayNumber,
        dateLabel: dateLabelForDay(dayNumber),
        activities: (day.live_timeline || [])
          .map((seed) => {
            const record = (seed || {}) as Record<string, unknown>;
            const time = stringOrNull(record.time) || stringOrNull(record.time_label) || stringOrNull(record.startTime);
            const timing = typeof record.timing_status === "string" ? record.timing_status.toUpperCase() : "";
            return {
              title: typeof record.title === "string" ? record.title : "",
              timeLabel: time,
              status: timing === "FACTUAL" ? "FACTUAL" : "Planned",
              mapQuery: stringOrNull(record.map_query),
              latitude: numberOrNull(record.latitude),
              longitude: numberOrNull(record.longitude)
            };
          })
          .filter((activity) => activity.title)
      };
    })
    .filter((day) => Number.isFinite(day.dayNumber))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}
