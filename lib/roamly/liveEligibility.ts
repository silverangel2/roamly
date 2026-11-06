/**
 * ONE Live Companion eligibility rule (L12 timezone workstream,
 * 2026-10-31 — closes the timezone split-brain finding in
 * roamly-blocker-closure-2026-10-31/verification/live/live-results.md
 * §12 L12 and the production evidence that followed it).
 *
 * THE RULE — the only definition of "is this trip Live-eligible
 * right now" in the app, and the rule the OWNER-APPLIED SQL migration
 * supabase/migrations/20261031000200_roamly_live_eligibility_timezone.sql
 * mirrors for the database gate:
 *
 *   eligible(trip, now)  <=>
 *     1. STATUS is live-ready: trip.status, lower-cased, is one of
 *        LIVE_COMPANION_ELIGIBLE_STATUSES = locked | active |
 *        planned | generated.
 *        Grounding in the app's own usage:
 *        - selectActiveTrip / getActiveOrUpcomingTrip already used
 *          exactly this set (liveCompanion.ts, tripActivation.ts);
 *        - "generated" is the status generation finalization writes
 *          for a completed itinerary (generationFinalization.ts sets
 *          status="generated" while billing.lockGeneratedItinerary
 *          sets status="locked" — two writers, one finished state),
 *          and the production Montreal trip (Oct 30–Nov 2, 2026) is
 *          status="generated" + itinerary_locked=true + unlocked,
 *          yet the old SQL/JS operational gates (locked|active|
 *          planned only) refused it;
 *        - draft / preview / generating are pre-generation states
 *          (generationStatus.ts defaults an unfinished trip to
 *          "draft"; staged generation writes "preview" mid-build),
 *          and completed / cancelled / archived are the terminal
 *          states customerTripLifecycleState treats as terminal —
 *          none of them can ever be Live-ready. Any other value is
 *          not live-ready either (closed set, fail-closed).
 *     2. LOCKED, in the app's own sense (billing.isTripLocked):
 *        itinerary_locked === true, OR itinerary_status === "locked",
 *        OR itinerary_generated_at is set. A "generated" trip must
 *        therefore also be locked in this sense and unlocked (3) —
 *        status alone never suffices.
 *     3. UNLOCKED: tracking_unlocked OR live_companion_unlocked
 *        (the same pair every Live gate in the app reads).
 *     4. IN WINDOW, destination-local: start_date <= D <= end_date,
 *        where D is the calendar date of `now` in the trip's
 *        DESTINATION timezone — never the process timezone, never a
 *        raw UTC date. start/end_date are plain calendar dates
 *        (YYYY-MM-DD) and are compared as dates, so an instant at
 *        00:30 destination-local on start_date is in window, and an
 *        instant on the day after end_date (destination-local) is
 *        out, in every process timezone.
 *
 * TIMEZONE RESOLUTION — the ONE order, shared with every day
 * surface via lib/roamly/tripTimezone.ts:
 *   a. a valid IANA zone stored in trip metadata
 *      (planning.timezone / destinationTimezone / destination_timezone
 *      and the root / tripPlanning equivalents);
 *   b. the verified destination registry (recommended places,
 *      client-safe; server callers pass the destination-seed registry
 *      through `extraRegistry`, or a pre-resolved `zoneOverride`
 *      from resolveTripTimezoneServer / resolveBackgroundTripTimezone)
 *      matched EXACTLY on the trip's destination / destination_name /
 *      destination_city / planning destination labels;
 *   c. DOCUMENTED FALLBACK when no zone is known (metadata zone null
 *      AND destination matches no registry entry): the window is
 *      computed in UTC — the `zoneForMath` fallback of
 *      tripTimezone.ts — deterministically, and the result reports
 *      zoneSource="unknown" / zoneKnown=false so callers and tests
 *      can see the fallback was used. It is never the process zone.
 *      (Background notification SCHEDULERS keep their stricter
 *      hold-on-unknown policy via backgroundNotificationTimezone.ts;
 *      that is a send-time scheduling policy, not eligibility, and
 *      callers that need it pass fallbackMode="hold".)
 *
 * Pure functions; `now` is injectable; nothing here reads the clock,
 * the process TZ, or any store. DST is handled by Intl: the local
 * date comes from Intl.DateTimeFormat parts in the resolved zone,
 * so a transition day in the destination zone (e.g. America/Toronto
 * falling back on 2026-11-01) still yields exactly one local date.
 */

import {
  isValidIanaZone,
  localDateInZone,
  resolveTripTimezone,
  zoneForMath,
  type TripTimezoneRegistryEntry,
  type TripTimezoneResolution,
  type TripTimezoneSource
} from "@/lib/roamly/tripTimezone";

export const LIVE_COMPANION_ELIGIBLE_STATUSES = [
  "locked",
  "active",
  "planned",
  "generated"
] as const;

export type LiveEligibilityTripInput = {
  status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_status?: string | null;
  itinerary_generated_at?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  metadata?: unknown;
  destination?: unknown;
  destination_name?: unknown;
  destination_city?: unknown;
};

export type LiveEligibilityOptions = {
  /**
   * A zone the caller already resolved for this trip (e.g. via
   * resolveTripTimezoneServer, which adds the server-only destination
   * seeds). A valid string wins outright; an explicit null means the
   * caller resolved and found the zone unknown — the documented
   * fallback then applies without re-resolving against a smaller
   * registry.
   */
  zoneOverride?: string | null;
  /** Extra registry rows for the client-safe resolver (server seeds). */
  extraRegistry?: readonly TripTimezoneRegistryEntry[];
  /** "utc" (default): unknown zone computes in UTC. "hold": unknown zone is ineligible. */
  fallbackMode?: "utc" | "hold";
};

export type LiveEligibilityExplanation = {
  eligible: boolean;
  /** Machine-readable reason codes, in rule order; ["eligible"] when eligible. */
  reasons: string[];
  status: string;
  liveReadyStatus: boolean;
  locked: boolean;
  unlocked: boolean;
  /** Zone used for the window math (the fallback UTC when unknown). */
  zone: string;
  zoneSource: TripTimezoneSource | "override";
  zoneKnown: boolean;
  /** Calendar date of `now` in `zone` (YYYY-MM-DD), or null when `now` is invalid. */
  localDate: string | null;
  inWindow: boolean;
};

function cleanStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isLiveReadyStatus(status: unknown): boolean {
  return (LIVE_COMPANION_ELIGIBLE_STATUSES as readonly string[]).includes(cleanStatus(status));
}

/** The app's own locked sense: billing.isTripLocked, on row fields. */
export function isLiveEligibilityLocked(trip: LiveEligibilityTripInput): boolean {
  return Boolean(
    trip.itinerary_locked ||
      cleanStatus(trip.itinerary_status) === "locked" ||
      trip.itinerary_generated_at
  );
}

export function hasLiveCompanionUnlock(trip: LiveEligibilityTripInput): boolean {
  return Boolean(trip.tracking_unlocked || trip.live_companion_unlocked);
}

export function resolveLiveEligibilityTimezone(
  trip: LiveEligibilityTripInput,
  options: LiveEligibilityOptions = {}
): TripTimezoneResolution & { zoneForMath: string } {
  if (options.zoneOverride !== undefined) {
    if (options.zoneOverride && isValidIanaZone(options.zoneOverride)) {
      return { zone: options.zoneOverride, source: "metadata", known: true, zoneForMath: options.zoneOverride };
    }
    if (options.zoneOverride === null) {
      return { zone: null, source: "unknown", known: false, zoneForMath: "UTC" };
    }
  }
  const resolution = resolveTripTimezone(
    {
      metadata: trip.metadata,
      destination: trip.destination,
      destination_name: trip.destination_name,
      destination_city: trip.destination_city
    },
    options.extraRegistry || []
  );
  return { ...resolution, zoneForMath: zoneForMath(resolution) };
}

function isoDate(value: string | null | undefined): string {
  return (value || "").slice(0, 10);
}

export function explainLiveCompanionEligibility(
  trip: LiveEligibilityTripInput,
  now: string | Date = new Date(),
  options: LiveEligibilityOptions = {}
): LiveEligibilityExplanation {
  const status = cleanStatus(trip.status);
  const liveReadyStatus = isLiveReadyStatus(status);
  const locked = isLiveEligibilityLocked(trip);
  const unlocked = hasLiveCompanionUnlock(trip);

  const resolution = resolveLiveEligibilityTimezone(trip, options);
  const zone = resolution.zoneForMath;
  const instant = now instanceof Date ? now : new Date(now);
  const localDate = Number.isFinite(instant.getTime()) ? localDateInZone(instant, zone) : null;

  const start = isoDate(trip.start_date ?? trip.startDate);
  const end = isoDate(trip.end_date ?? trip.endDate);
  const inWindow = Boolean(
    localDate && start && end && start.localeCompare(localDate) <= 0 && end.localeCompare(localDate) >= 0
  );

  const reasons: string[] = [];
  if (!liveReadyStatus) reasons.push("status_not_live_ready");
  if (!locked) reasons.push("not_locked");
  if (!unlocked) reasons.push("not_unlocked");
  if (!start || !end) reasons.push("missing_dates");
  else if (localDate && start.localeCompare(localDate) > 0) reasons.push("before_window");
  else if (localDate && end.localeCompare(localDate) < 0) reasons.push("after_window");
  if (!localDate) reasons.push("invalid_now");
  if (!resolution.known && options.fallbackMode === "hold") reasons.push("timezone_unknown_held");

  const eligible = reasons.length === 0;
  return {
    eligible,
    reasons: eligible ? ["eligible"] : reasons,
    status,
    liveReadyStatus,
    locked,
    unlocked,
    zone,
    zoneSource: options.zoneOverride !== undefined ? "override" : resolution.source,
    zoneKnown: resolution.known,
    localDate,
    inWindow
  };
}

export function isLiveCompanionEligible(
  trip: LiveEligibilityTripInput,
  now: string | Date = new Date(),
  options: LiveEligibilityOptions = {}
): boolean {
  return explainLiveCompanionEligibility(trip, now, options).eligible;
}

/** Destination-local calendar date of `now` for a trip, per the ONE resolution. */
export function liveEligibilityLocalDate(
  trip: LiveEligibilityTripInput,
  now: string | Date = new Date(),
  options: LiveEligibilityOptions = {}
): string {
  const resolution = resolveLiveEligibilityTimezone(trip, options);
  return localDateInZone(now, resolution.zoneForMath);
}
