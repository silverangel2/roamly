import { tripWindowState } from "@/lib/roamly/liveCompanion";
import { resolveTripTimezone, zoneForMath } from "@/lib/roamly/tripTimezone";

export type NotificationTripCandidate = {
  id: string;
  status?: string | null;
  itinerary_status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: unknown;
  /** Destination fields, when the row carries them — they let the
   *  window rank resolve the trip's zone from the verified registry
   *  instead of metadata alone (timezone round, 2026-10-26). */
  destination?: unknown;
  destination_name?: unknown;
  destination_city?: unknown;
};

export function tripCompanionUnlocked(trip: NotificationTripCandidate | null | undefined) {
  return Boolean(trip && (trip.tracking_unlocked === true || trip.live_companion_unlocked === true));
}

function windowRank(trip: NotificationTripCandidate, now: Date) {
  // Timezone round: the window rank resolves through the ONE resolver
  // (metadata, then destination registry) — never metadata-only with
  // a silent UTC fallback — so a registry-known trip is ranked in its
  // own zone even when its metadata records no zone.
  const resolved = resolveTripTimezone({
    metadata: trip.metadata,
    destination: trip.destination,
    destination_name: trip.destination_name,
    destination_city: trip.destination_city
  });
  const window = tripWindowState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: zoneForMath(resolved),
    now
  });
  if (window === "active") return 0;
  if (window === "future_trip") return 1;
  if (window === "missing_dates") return 2;
  return 3;
}

/** True when the trip is not terminal (cancelled/archived trips are never selected). */
export function isOpenNotificationTrip(trip: NotificationTripCandidate | null | undefined): boolean {
  return Boolean(trip) && !["cancelled", "archived"].includes(String(trip?.status || "").toLowerCase());
}

/**
 * ONE selected-trip resolution for every trip-specific surface
 * (repair round, Priority 2 — ends the documented divergence where
 * Alerts rule-selected Montreal while Live/Itinerary URL-selected
 * Toronto on Toronto pages):
 * - when the user is viewing a trip (a trip URL, or the Alerts tab
 *   carrying ?trip=<id> from that trip's own screen), the URL trip
 *   WINS, provided it names an open trip in the user's list — the
 *   badge, the Alerts page, and every trip screen then show that
 *   trip together, with no cross-trip leakage;
 * - otherwise (no URL trip, or the URL names no open trip in the
 *   list — unknown id, cancelled/archived, or outside the list's
 *   40-trip window) the established rule below applies.
 * The Alerts page server variant follows the same rule with a direct
 * row fetch for the requested id (so an open trip outside the
 * list's window still wins there); the shell uses this list form.
 * Pure function; `now` injectable for tests.
 */
export function resolveSelectedTrip<T extends NotificationTripCandidate>(params: {
  trips: readonly T[];
  urlTripId?: string | null;
  now?: Date;
}): T | null {
  const { trips, urlTripId } = params;
  if (urlTripId) {
    const urlTrip = trips.find((trip) => trip.id === urlTripId);
    if (urlTrip && isOpenNotificationTrip(urlTrip)) return urlTrip;
  }
  return selectNotificationTrip(trips, params.now ?? new Date());
}

/**
 * The notifications page shows one current trip.
 * A future companion-unlocked trip wins over another trip's old check-ins.
 */
export function selectNotificationTrip<T extends NotificationTripCandidate>(trips: readonly T[], now: Date = new Date()) {
  const open = trips.filter((trip) => !["cancelled", "archived"].includes(String(trip.status || "").toLowerCase()));
  const unlocked = open.filter((trip) => tripCompanionUnlocked(trip));
  const pool = unlocked.length ? unlocked : open;
  return [...pool].sort((a, b) => {
    const windowDelta = windowRank(a, now) - windowRank(b, now);
    if (windowDelta) return windowDelta;
    const aFuture = windowRank(a, now) === 1;
    if (aFuture) return String(a.start_date || "9999").localeCompare(String(b.start_date || "9999"));
    return String(b.start_date || "").localeCompare(String(a.start_date || "")) || a.id.localeCompare(b.id);
  })[0] || null;
}
