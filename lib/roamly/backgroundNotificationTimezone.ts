/**
 * Background notification-scheduling timezone resolution
 * (notification-timezone round, 2026-10-27).
 *
 * SERVER-ONLY: this module imports lib/roamly/tripTimezoneServer.ts,
 * which pulls node:crypto through the destination-seed registry. It
 * must never be imported by a client component. Background jobs import
 * it; day surfaces resolve through the same tripTimezone.ts core.
 *
 * THE RESIDUAL IT CLOSES: until this round, background
 * notification-scheduling code resolved the trip zone from stored
 * trip metadata alone (`timezoneFromTripMetadata`, silent "UTC"
 * fallback). Neither tester trip records a zone in metadata, so every
 * send-time computation ran in UTC while Live, Alerts, and Country
 * info already ran in the destination zone. A 9:00 destination-local
 * trip start was computed as 09:00 UTC (05:00 EDT) instead of
 * 13:00 UTC, and a reminder near destination-local midnight could
 * land on the wrong destination-local day.
 *
 * RESOLUTION ORDER — identical to every user-visible surface:
 *   1. stored trip metadata (valid IANA zone wins),
 *   2. the verified destination registry, EXACT match only
 *      (metadata + seeds + recommended places, via
 *      resolveTripTimezoneServer),
 *   3. UNKNOWN — never a silent UTC guess.
 *
 * UNKNOWN = HELD (DECISION POINT, owner-redirectable): a scheduling
 * row whose trip zone cannot be resolved is NOT scheduled in UTC.
 * Schedulers return the TIMEZONE_UNKNOWN_HELD suppression (or, after
 * a claim, fail the claim retryable with the same code) and record
 * the trip in the cron result, so the hold is visible in the run
 * output instead of silently sending at a guessed time. A held trip
 * schedules normally on a later run once its destination is recorded
 * or its metadata gains a zone — no schedule row is written while
 * held, so nothing has to be unwound. Reminder RULES are unchanged:
 * same reminder types, cadences, windows, and triggers — only the
 * timezone interpretation of send times changes.
 *
 * DEDUPE NOTE: the legacy pre-trip reminder version
 * (preTripReminderVersion) hashes the stored-metadata zone, which
 * this rewire does not change — metadata is untouched, only the
 * fallback interpretation for missing metadata changes. An old
 * reminder key therefore equals the new reminder key for the same
 * trip/start/bookings, so a reinterpretation can never mint a second
 * reminder for one that already exists (the existing-event check
 * returns deduplicated). Briefing reminders are keyed by the
 * zone-independent communication logical key (user + trip + purpose
 * + occurrence), and pending ledger rows get their scheduled_for
 * rewritten to the corrected window target on each run — corrected,
 * never duplicated.
 */

import {
  resolveTripTimezoneServer
} from "@/lib/roamly/tripTimezoneServer";
import type { TripTimezoneResolution } from "@/lib/roamly/tripTimezone";

/** Suppression / hold code recorded in cron results for unknown zones. */
export const BACKGROUND_TIMEZONE_HOLD = "TIMEZONE_UNKNOWN_HELD" as const;

export type BackgroundTripTimezoneInput = {
  metadata?: unknown;
  destination?: unknown;
  destination_name?: unknown;
  destination_city?: unknown;
};

export type BackgroundTripTimezone = TripTimezoneResolution & {
  /** True exactly when the zone is unknown: do not schedule. */
  held: boolean;
  /** BACKGROUND_TIMEZONE_HOLD when held, else null. */
  holdReason: typeof BACKGROUND_TIMEZONE_HOLD | null;
};

/**
 * THE background resolution. Pass the trip record itself — never a
 * bare scheduling row: when a row carries no destination, the caller
 * resolves through the trip record (its destination columns) instead
 * of guessing from the row alone.
 */
export function resolveBackgroundTripTimezone(
  trip: BackgroundTripTimezoneInput
): BackgroundTripTimezone {
  const resolution = resolveTripTimezoneServer({
    metadata: trip.metadata,
    destination: trip.destination,
    destination_name: trip.destination_name,
    destination_city: trip.destination_city
  });
  return {
    ...resolution,
    held: !resolution.known,
    holdReason: resolution.known ? null : BACKGROUND_TIMEZONE_HOLD
  };
}
