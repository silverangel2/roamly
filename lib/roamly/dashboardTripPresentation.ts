import { customerTripLifecycleState, isCustomerTripTerminalState, isTodayWithinTripDates, timezoneFromTripMetadata } from "./liveCompanion";

type DashboardTripLike = {
  id: string;
  status?: string | null;
  itinerary_status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
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
