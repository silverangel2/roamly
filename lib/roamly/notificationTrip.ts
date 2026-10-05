import { timezoneFromTripMetadata, tripWindowState } from "@/lib/roamly/liveCompanion";

export type NotificationTripCandidate = {
  id: string;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: unknown;
};

export function tripCompanionUnlocked(trip: NotificationTripCandidate | null | undefined) {
  return Boolean(trip && (trip.tracking_unlocked === true || trip.live_companion_unlocked === true));
}

function windowRank(trip: NotificationTripCandidate, now: Date) {
  const window = tripWindowState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: timezoneFromTripMetadata(trip.metadata),
    now
  });
  if (window === "active") return 0;
  if (window === "future_trip") return 1;
  if (window === "missing_dates") return 2;
  return 3;
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
