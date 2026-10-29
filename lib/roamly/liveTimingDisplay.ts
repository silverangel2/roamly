/**
 * Timing honesty for the Live NOW card (Round 2, CRITICAL 2).
 *
 * Root cause of the owner complaint: the old Timing row rendered
 * `timingCopy(countdownMinutes)` — minutes until the NEXT activity's
 * start, computed from the itinerary schedule — under a bare "Timing"
 * label, directly above "Travel time from your location is still
 * uncertain". A reader (reasonably) reads the precise "7h 32m" as a
 * travel time, next to an admission that travel time is uncertain.
 *
 * This module makes that confusion structurally impossible:
 * - The countdown and the travel time are SEPARATE labeled facts, on
 *   separate rows. The travel-time row shows a number ONLY when the
 *   route provider verified it; otherwise it says so and shows NO
 *   number — never a precise duration next to uncertain copy.
 * - The countdown itself is labeled by its basis: a booking-anchored
 *   (FACTUAL) start renders verbatim with a "Verified start time"
 *   basis; a schedule-derived (PLANNED / UNKNOWN / missing) start
 *   renders with "About" plus an "Estimated from the planned schedule"
 *   basis, in plain words. Only FACTUAL counts as verified — a missing
 *   timing status fails closed to estimated.
 * - No start time at all renders "No start time" and no number.
 *
 * Pure functions only; `now` is not needed because the caller passes the
 * already-computed countdown in minutes.
 */

export type TimingStatus = "FACTUAL" | "PLANNED" | "UNKNOWN" | null | undefined;

export type TimingDisplay = {
  /** Main countdown value: verbatim when verified, "About …" when estimated. */
  main: string;
  /** Basis line under the countdown, or null when the main value is a state. */
  basis: string | null;
  /** Travel-time row: a labeled verified duration, or an honest no-number line. */
  travel: string;
  /** True only when `main` carries a future duration (not "No start time"). */
  hasDuration: boolean;
  /**
   * Conditional-acceptance round, item 1: the time-provenance kind of
   * this countdown, in the shared vocabulary of
   * lib/roamly/timeProvenance.ts. FACTUAL (booking-anchored) →
   * "confirmed"; schedule-derived → "estimated"; no start time at all
   * → null (no time, no label). The Live surface renders this kind
   * next to the time; it never renders a bare time.
   */
  provenance: "confirmed" | "estimated" | null;
};

function formatCountdown(minutes: number, startDate: Date | null, timezone?: string | null, locale = "en"): string {
  if (minutes < -5) return "Started";
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  if (startDate && Number.isFinite(startDate.getTime())) {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: timezone || undefined
    }).format(startDate);
  }
  const days = Math.round(minutes / (60 * 24));
  return days <= 1 ? "in 1 day" : `in ${days} days`;
}

function isFutureDuration(main: string): boolean {
  return main !== "No start time" && main !== "Started" && main !== "Now";
}

export function timingDisplay(params: {
  countdownMinutes: number | null;
  nextStart: Date | null;
  timingStatus: TimingStatus;
  timezone?: string | null;
  locale?: string;
  routeVerified: boolean;
  routeDurationMinutes?: number | null;
  routeMode?: string | null;
}): TimingDisplay {
  const locale = params.locale || "en";
  const verifiedStart = params.timingStatus === "FACTUAL";
  const travel = params.routeVerified &&
    params.routeDurationMinutes != null &&
    Number.isFinite(params.routeDurationMinutes)
    ? `${params.routeDurationMinutes} min ${params.routeMode || "walking"} from your location`
    : "Travel time is not verified yet — no travel time is shown.";
  if (params.countdownMinutes == null) {
    return { main: "No start time", basis: null, travel, hasDuration: false, provenance: null };
  }
  const raw = formatCountdown(params.countdownMinutes, params.nextStart, params.timezone, locale);
  if (!isFutureDuration(raw)) {
    return { main: raw, basis: null, travel, hasDuration: false, provenance: null };
  }
  if (verifiedStart) {
    return { main: raw, basis: "Verified start time", travel, hasDuration: true, provenance: "confirmed" };
  }
  return {
    main: `About ${raw}`,
    basis: "Estimated from the planned schedule — the start time may change",
    travel,
    hasDuration: true,
    provenance: "estimated"
  };
}
