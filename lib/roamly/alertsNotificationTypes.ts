/**
 * The info-notification types (conditional-acceptance round, item 2).
 *
 * Moved verbatim from app/notifications/page.tsx so the Alerts page
 * and the tab-bar badge share ONE definition of which notification
 * types render on the Alerts screen. Info reminders open the
 * single-event sheet (same info-type set the timeline card uses).
 * Pure data only — no imports, loadable from server and client code.
 */
export const INFO_NOTIFICATION_TYPES = new Set([
  "country_info",
  "document_check",
  "one_week_before",
  "packing_check",
  "one_day_before",
  "countdown_24h",
  "travel_day_started",
  "trip_predeparture_7d",
  "trip_predeparture_1d",
  "travel_day",
  "daily_trip_briefing",
  "daily_briefing",
  "final_day_briefing"
]);
