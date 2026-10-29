/**
 * Time provenance labels (conditional-acceptance round, item 1;
 * evidence gate added in the not-approved repair round, 2026-10-26).
 *
 * OWNER-found defect this gate fixes: the conditional round labeled
 * nearly every activity "Live-updated" while location was unavailable.
 * Recomputing a time at render is NOT live evidence. The rule now:
 * every displayed time carries exactly one kind label, and no time
 * may carry a kind its source does not support.
 *
 * - "planned" — the original itinerary time, unchanged (stored plan
 *   seeds, plan-draft travel legs, stored plan windows on place
 *   detail, home rows whose stored time was never retimed).
 * - "estimated" — a recalculated or inferred time WITHOUT verified
 *   live evidence. Walk-adjusted / recomputed times are Estimated
 *   when location is unavailable; a retimed schedule is Estimated;
 *   a fallback walk estimate is Estimated. Never Live-updated.
 * - "live" — a time updated using actual, sufficiently current,
 *   VERIFIED information only. The evidence gate is
 *   hasVerifiedLiveEvidence: a fresh location fix OR a fresh
 *   verified check-in event, each inside TIME_EVIDENCE_FRESHNESS_MS
 *   of now. No evidence inside the window means the label falls
 *   back to Estimated (recomputed times) or Planned (stored times),
 *   never Live-updated. A stale verified input falls back the same
 *   way — it is never presented as current.
 * - "confirmed" — ONLY where an authoritative booking or
 *   confirmation record supports the time: a booking-anchored time
 *   (FACTUAL timing status, timeFromBooking, a verified booking
 *   override that supplied the start). No record → no Confirmed
 *   label anywhere. The tester trips carry no such record for the
 *   rendered rows, so tester renders must show zero Confirmed
 *   labels on those rows.
 *
 * Freshness window: 10 minutes, mirroring
 * PRECISE_LOCATION_MAX_AGE_MS in lib/roamly/location.ts (the
 * foreground-tracker cadence), with the same 2-minute future-skew
 * tolerance. This file stays import-free so the deterministic Node
 * checks can load it directly; the suite cross-checks the window
 * against location.ts instead of importing it.
 *
 * A row with no clock time ("Flexible", "") carries no label — there
 * is no time to label. Pure functions only; no imports.
 */

export type TimeProvenance = "planned" | "estimated" | "live" | "confirmed";

export const TIME_PROVENANCE_LABELS: Record<TimeProvenance, string> = {
  planned: "Planned",
  estimated: "Estimated",
  live: "Live-updated",
  confirmed: "Confirmed"
};

/** Freshness window for verified live inputs (mirrors location.ts). */
export const TIME_EVIDENCE_FRESHNESS_MS = 10 * 60_000;
/** Clock-skew tolerance for slightly-future evidence timestamps. */
export const TIME_EVIDENCE_FUTURE_SKEW_MS = 2 * 60_000;

export function timeProvenanceLabel(kind: TimeProvenance): string {
  return TIME_PROVENANCE_LABELS[kind];
}

/** True only for a clock time ("8:00 AM"), never for "Flexible" or "". */
export function isClockTime(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(value.trim());
}

/**
 * True only when an evidence timestamp (ISO string or epoch ms) falls
 * inside the freshness window relative to `nowMs`: younger than
 * TIME_EVIDENCE_FRESHNESS_MS, tolerating up to
 * TIME_EVIDENCE_FUTURE_SKEW_MS of future clock skew. Missing,
 * unparseable, stale, or far-future timestamps are NOT fresh — a
 * stale verified input must fall back, never present as current.
 */
export function isFreshEvidenceTimestamp(
  observedAt: string | number | null | undefined,
  nowMs: number
): boolean {
  const observed =
    typeof observedAt === "number" && Number.isFinite(observedAt)
      ? observedAt
      : typeof observedAt === "string" && observedAt.trim()
        ? Date.parse(observedAt)
        : Number.NaN;
  if (!Number.isFinite(observed) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - observed;
  return age < TIME_EVIDENCE_FRESHNESS_MS && age >= -TIME_EVIDENCE_FUTURE_SKEW_MS;
}

/**
 * THE EVIDENCE GATE. A time earns "Live-updated" only when at least
 * one verified live input is fresh right now: a fresh location fix
 * (the caller passes the already-freshness-checked fix, e.g. the
 * Live client's usableLocation, which is null unless fresh) or a
 * fresh verified check-in event (a checked_in activity whose
 * checked_in_at is fresh per isFreshEvidenceTimestamp). Either input
 * stale or absent → false → the caller must fall back.
 */
export function hasVerifiedLiveEvidence(params: {
  freshLocationFix: boolean;
  freshCheckIn: boolean;
}): boolean {
  return params.freshLocationFix === true || params.freshCheckIn === true;
}

/**
 * Live pre-trip rows (stored plan seeds): the builder marks
 * `planned` true exactly when the time is schedule-derived (not
 * FACTUAL). Schedule-derived → Planned; otherwise the time is
 * verified (FACTUAL) → Confirmed. Never anything else.
 */
export function provenanceForPreTripRow(planned: boolean): TimeProvenance {
  return planned ? "planned" : "confirmed";
}

/**
 * Home timeline rows (stored plan, rendered from the same plan the
 * day cards render — NOT a live recomputation):
 * - a verified-booking row (authority confirmed, or a time the
 *   booking itself supplied) → Confirmed;
 * - a plan-draft travel leg → Planned;
 * - a retimed row (the plan record carries retimed_by_event: the
 *   shown time is a recalculation, not the original plan time) →
 *   Estimated;
 * - every other row shows its original stored plan time, unchanged
 *   → Planned. The old default of "live" for these rows was the
 *   defect: a stored plan time is not a live update.
 */
export function provenanceForHomeRow(params: {
  planned: boolean;
  booked: boolean;
  timeFromBooking?: boolean;
  retimed?: boolean;
}): TimeProvenance {
  if (params.booked || params.timeFromBooking === true) return "confirmed";
  if (params.planned) return "planned";
  if (params.retimed === true) return "estimated";
  return "planned";
}

/**
 * Live in-progress times (featured + upcoming): the day's times are
 * recomputed for today from the live activity records, so without
 * further evidence they are Estimated — never Live-updated. They
 * earn Live-updated ONLY through the evidence gate (a fresh
 * location fix or a fresh verified check-in event). A time supplied
 * by a verified booking (verified booking override, or FACTUAL
 * timing status) is Confirmed regardless of live evidence, because
 * the booking record — not the recomputation — supports it.
 */
export function provenanceForLiveDayRow(params: {
  bookingVerified: boolean;
  verifiedLiveEvidence: boolean;
}): TimeProvenance {
  if (params.bookingVerified) return "confirmed";
  if (params.verifiedLiveEvidence) return "live";
  return "estimated";
}

/**
 * Place detail time windows (stored plan records: startTime/end_time
 * or time_label, the same stored window the home timeline shows):
 * - FACTUAL timing status (the record declares the time
 *   booking-anchored) → Confirmed;
 * - a retimed record (retimed_by_event set: the window is a
 *   recalculation, not the original plan window) → Estimated;
 * - otherwise the window is the original plan time, unchanged →
 *   Planned. A confirmed booking for the place is a separate fact
 *   (the place badge); it does not by itself confirm the window
 *   unless the record itself is booking-anchored.
 */
export function provenanceForPlaceTime(params: {
  timingStatus?: string | null;
  retimed?: boolean;
}): TimeProvenance {
  if (typeof params.timingStatus === "string" && params.timingStatus.trim().toUpperCase() === "FACTUAL") {
    return "confirmed";
  }
  if (params.retimed === true) return "estimated";
  return "planned";
}
