import { customerTripLifecycleState, isCustomerTripTerminalState, isTodayWithinTripDates, timezoneFromTripMetadata } from "./liveCompanion";

type DashboardTripLike = {
  id: string;
  status?: string | null;
  itinerary_status?: string | null;
  itinerary_locked?: boolean | null;
  itineraryLocked?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

export function dashboardTripPresentation(trip: DashboardTripLike, now: string | Date = new Date()) {
  const lifecycle = customerTripLifecycleState({
    status: trip.status,
    itineraryStatus: trip.itinerary_status,
    startDate: trip.start_date,
    endDate: trip.end_date,
    metadata: trip.metadata
  }, now);
  const terminal = isCustomerTripTerminalState(lifecycle);
  const companionUnlocked = !terminal && Boolean(trip.tracking_unlocked || trip.live_companion_unlocked);
  const liveNow = lifecycle === "active" && companionUnlocked && isTodayWithinTripDates({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: timezoneFromTripMetadata(trip.metadata),
    now
  });

  return {
    lifecycle,
    terminal,
    companionUnlocked,
    liveNow,
    href: liveNow ? `/trip/${trip.id}/live` : `/trip/${trip.id}`,
    eyebrow: lifecycle === "completed"
      ? "Completed trip"
      : lifecycle === "archived"
        ? "Archived trip"
        : liveNow
          ? "Live Trip Companion"
          : companionUnlocked
            ? "Companion unlocked"
            : trip.status || lifecycle,
    badge: lifecycle === "completed"
      ? "History"
      : lifecycle === "archived"
        ? "Archived"
        : liveNow
          ? "Live"
          : companionUnlocked
            ? "Unlocked"
            : "Draft",
    action: lifecycle === "completed" ? "View history" : liveNow ? "Open Live" : companionUnlocked ? "Open companion" : "Open trip"
  } as const;
}

function unlockedItinerary(trip: DashboardTripLike) {
  return Boolean(trip.itinerary_locked || trip.itineraryLocked);
}

/** Lower rank is shown first: live, upcoming unlocked, drafts, then past. */
export function dashboardTripSortRank(trip: DashboardTripLike, now: string | Date = new Date()) {
  const view = dashboardTripPresentation(trip, now);
  if (view.lifecycle === "completed" || view.lifecycle === "archived" || view.lifecycle === "cancelled") return 400;
  if (view.liveNow) return 0;
  if (view.companionUnlocked && (view.lifecycle === "upcoming" || view.lifecycle === "active")) return 100;
  if (unlockedItinerary(trip) && view.lifecycle === "upcoming") return 200;
  if (unlockedItinerary(trip) || view.companionUnlocked) return 250;
  return 300;
}

export function compareDashboardTrips<T extends DashboardTripLike>(a: T, b: T, now: string | Date = new Date()) {
  const rank = dashboardTripSortRank(a, now) - dashboardTripSortRank(b, now);
  if (rank !== 0) return rank;
  const aRank = dashboardTripSortRank(a, now);
  if (aRank < 300) {
    const aStart = a.start_date || "9999-99-99";
    const bStart = b.start_date || "9999-99-99";
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  }
  const aCreated = a.created_at || "";
  const bCreated = b.created_at || "";
  if (aCreated === bCreated) return 0;
  return aCreated < bCreated ? 1 : -1;
}
