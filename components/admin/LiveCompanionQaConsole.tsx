"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_LIVE_COMPANION_SETTINGS,
  buildLiveCompanionState,
  evaluateNotificationDecision,
  fallbackRouteStatus,
  timezoneFromTripMetadata,
  type LiveCompanionActivity,
  type LiveCoordinates,
  type LiveLocationPermission,
  type LiveNotificationDecision,
  type LiveNotificationType,
  type LiveRouteStatus
} from "@/lib/roamly/liveCompanion";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";

type QaTrip = {
  id: string;
  title: string | null;
  destination?: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date: string | null;
  end_date: string | null;
  metadata?: Record<string, unknown> | null;
};

type QaActivity = {
  id: string;
  trip_id: string;
  title: string;
  description: string | null;
  day_number?: number | null;
  time_label?: string | null;
  location_name?: string | null;
  map_query?: string | null;
  address?: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
};

type QaBooking = {
  id: string;
  trip_id: string;
  title: string | null;
  booking_type: string;
  provider_name?: string | null;
  confirmation_number?: string | null;
  address?: string | null;
  start_date?: string | null;
  start_time?: string | null;
  end_date?: string | null;
  end_time?: string | null;
};

type QaLog = LiveNotificationDecision & {
  id: string;
};

const phonePresets = [
  ["320", "320px"],
  ["375", "375px"],
  ["390", "390px"],
  ["430", "430px"]
] as const;

const previewModes = [
  ["live", "Live"],
  ["itinerary", "Itinerary"],
  ["generation", "Generation"],
  ["bookings", "Bookings"]
] as const;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function dateTime(date?: string | null, time?: string | null) {
  if (!date) return null;
  return time ? `${date}T${time}` : `${date}T00:00:00`;
}

function formatClock(value: string | null | undefined, timezone?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined
  }).format(date);
}

function countdown(minutes: number | null) {
  if (minutes == null) return "No start";
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function destinationFallback(trip: QaTrip, index = 0): LiveCoordinates {
  const label = `${trip.destination_city || trip.destination_name || trip.destination || ""} ${trip.destination_country || ""}`.toLowerCase();
  const base =
    label.includes("montreal")
      ? { latitude: 45.5019, longitude: -73.5674 }
      : label.includes("vancouver")
        ? { latitude: 49.2827, longitude: -123.1207 }
        : label.includes("paris")
          ? { latitude: 48.8566, longitude: 2.3522 }
          : label.includes("london")
            ? { latitude: 51.5072, longitude: -0.1276 }
            : { latitude: 43.6532, longitude: -79.3832 };
  return {
    latitude: base.latitude + index * 0.003,
    longitude: base.longitude - index * 0.003,
    accuracy: 20
  };
}

function activityLocation(activity: QaActivity, trip: QaTrip, index: number): LiveCoordinates {
  if (activity.latitude != null && activity.longitude != null) {
    return { latitude: activity.latitude, longitude: activity.longitude, accuracy: 20 };
  }
  return destinationFallback(trip, index);
}

function bookingTime(booking: QaBooking, start = true) {
  return dateTime(start ? booking.start_date : booking.end_date, start ? booking.start_time : booking.end_time);
}

function routeForScenario(params: {
  scenario: "verified" | "unavailable";
  offline: boolean;
  next: LiveCompanionActivity | null;
  durationMinutes: number;
  now: string;
}): LiveRouteStatus {
  if (params.offline) {
    return {
      status: "offline",
      mapsUrl: params.next ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(params.next.title)}` : "",
      reason: "QA offline mode. Showing saved itinerary details."
    };
  }
  if (params.scenario === "unavailable") {
    return fallbackRouteStatus(params.next, "QA route unavailable fallback.");
  }
  return {
    status: "verified",
    provider: "qa_simulated_maps",
    mode: "walking",
    durationMinutes: params.durationMinutes,
    retrievedAt: params.now,
    mapsUrl: params.next ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(params.next.title)}` : ""
  };
}

function LogBadge({ sent }: { sent: boolean }) {
  return (
    <span className={classNames(
      "rounded-full px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.08em]",
      sent ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
    )}>
      {sent ? "Sent" : "Suppressed"}
    </span>
  );
}

export function LiveCompanionQaConsole({
  trips,
  activities,
  bookings
}: {
  trips: QaTrip[];
  activities: QaActivity[];
  bookings: QaBooking[];
}) {
  const [tripId, setTripId] = useState(trips[0]?.id || "");
  const [phoneWidth, setPhoneWidth] = useState<(typeof phonePresets)[number][0]>("390");
  const [previewMode, setPreviewMode] = useState<(typeof previewModes)[number][0]>("live");
  const [darkMode, setDarkMode] = useState(false);
  const [longTextStress, setLongTextStress] = useState(false);
  const [permission, setPermission] = useState<LiveLocationPermission>("granted");
  const [routeScenario, setRouteScenario] = useState<"verified" | "unavailable">("verified");
  const [offline, setOffline] = useState(false);
  const [paused, setPaused] = useState(false);
  const [routeDuration, setRouteDuration] = useState(18);
  const [settings, setSettings] = useState(DEFAULT_LIVE_COMPANION_SETTINGS);
  const [selectedDay, setSelectedDay] = useState(1);
  const selectedTrip = trips.find((trip) => trip.id === tripId) || trips[0] || null;
  const tripActivities = activities.filter((activity) => activity.trip_id === selectedTrip?.id);
  const tripBookings = bookings.filter((booking) => booking.trip_id === selectedTrip?.id);
  const timezone = timezoneFromTripMetadata(selectedTrip?.metadata || null);
  const initialNow = selectedTrip?.start_date ? `${selectedTrip.start_date}T12:00:00Z` : new Date().toISOString();
  const [simulatedNow, setSimulatedNow] = useState(initialNow);
  const [selectedLocationId, setSelectedLocationId] = useState(tripActivities[0]?.id || "");
  const [logs, setLogs] = useState<QaLog[]>([]);

  const liveActivities = useMemo(() => {
    if (!selectedTrip) return [];
    return tripActivities.map((activity, index): LiveCompanionActivity => {
      const coords = activityLocation(activity, selectedTrip, index);
      const booking = tripBookings.find((item) => {
        const bookingTitle = (item.title || "").toLowerCase();
        return bookingTitle && activity.title.toLowerCase().includes(bookingTitle);
      });
      return {
        id: activity.id,
        title: longTextStress
          ? `${activity.title} with an intentionally long QA title to verify wrapping on narrow phone screens`
          : activity.title,
        shortDescription: longTextStress
          ? `${activity.description || "QA activity"} This long text verifies that the mobile journey card wraps without horizontal overflow, overlap, or layout shift.`
          : activity.description,
        date: selectedTrip.start_date,
        dayNumber: activity.day_number || 1,
        timeLabel: activity.time_label || (index === 0 ? "9:00 AM" : index === 1 ? "11:00 AM" : "2:00 PM"),
        address: activity.address || activity.map_query || activity.location_name,
        placeName: activity.location_name,
        latitude: coords.latitude,
        longitude: coords.longitude,
        radiusMeters: settings.arrivalRadiusMeters,
        status: activity.status || "planned",
        booking: booking
          ? {
              id: booking.id,
              title: booking.title,
              reference: booking.confirmation_number,
              provider: booking.provider_name,
              startTime: bookingTime(booking, true),
              endTime: bookingTime(booking, false),
              status: "verified"
            }
          : null
      };
    });
  }, [longTextStress, selectedTrip, settings.arrivalRadiusMeters, tripActivities, tripBookings]);

  const selectedLocationActivity =
    liveActivities.find((activity) => activity.id === selectedLocationId) || liveActivities[0] || null;
  const location = selectedLocationActivity?.latitude != null && selectedLocationActivity.longitude != null
    ? {
        latitude: selectedLocationActivity.latitude,
        longitude: selectedLocationActivity.longitude,
        accuracy: 12
      }
    : selectedTrip
      ? destinationFallback(selectedTrip)
      : null;
  const route = routeForScenario({
    scenario: routeScenario,
    offline,
    next: liveActivities[1] || liveActivities[0] || null,
    durationMinutes: routeDuration,
    now: simulatedNow
  });
  const companionState = selectedTrip
    ? buildLiveCompanionState({
        trip: {
          id: selectedTrip.id,
          title: selectedTrip.title,
          startDate: selectedTrip.start_date,
          endDate: selectedTrip.end_date,
          timezone,
          enabled: true,
          pausedUntil: paused ? new Date(new Date(simulatedNow).getTime() + 60 * 60_000).toISOString() : null,
          destination: {
            label: getTripDestinationLabel(selectedTrip),
            ...destinationFallback(selectedTrip)
          }
        },
        activities: liveActivities,
        permission,
        location,
        route,
        settings,
        now: simulatedNow
      })
    : null;

  const sentHistory = logs
    .filter((log) => log.notificationSent)
    .map((log) => ({
      key: log.key,
      eventType: log.eventType,
      activityId: log.activityId,
      sentAt: log.eventTime
    }));
  const sentLastHour = logs.filter((log) => {
    if (!log.notificationSent) return false;
    return new Date(simulatedNow).getTime() - new Date(log.eventTime).getTime() < 60 * 60_000;
  }).length;

  function setNowFromTrip(offsetDays: number, hour = 12) {
    if (!selectedTrip?.start_date) return;
    const base = new Date(`${selectedTrip.start_date}T${String(hour).padStart(2, "0")}:00:00Z`);
    base.setUTCDate(base.getUTCDate() + offsetDays);
    setSimulatedNow(base.toISOString());
  }

  function setLateNow() {
    if (companionState?.leaveBy) {
      const late = new Date(companionState.leaveBy);
      late.setUTCMinutes(late.getUTCMinutes() + settings.lateThresholdMinutes + 6);
      setSimulatedNow(late.toISOString());
    }
  }

  function moveToActivity(activityId: string) {
    setSelectedLocationId(activityId);
  }

  function triggerNotification(eventType: LiveNotificationType, reason: string) {
    const activity = eventType === "arrival" ? companionState?.now : companionState?.next;
    const decision = evaluateNotificationDecision({
      eventType,
      activity,
      now: simulatedNow,
      settings,
      history: sentHistory,
      activeWindow: Boolean(companionState?.activeWindow),
      paused,
      locationState: companionState?.arrivalState || "unknown",
      reason
    });
    setLogs((current) => [{ ...decision, id: `${decision.key}-${current.length}-${Date.now()}` }, ...current].slice(0, 80));
  }

  function resetQa() {
    setLogs([]);
    setPermission("granted");
    setRouteScenario("verified");
    setOffline(false);
    setPaused(false);
    setRouteDuration(18);
    setSettings(DEFAULT_LIVE_COMPANION_SETTINGS);
    if (tripActivities[0]) setSelectedLocationId(tripActivities[0].id);
    setNowFromTrip(0, 12);
  }

  if (!selectedTrip || !companionState) {
    return (
      <section className="rounded-[1.5rem] border border-cloud bg-white p-5 shadow-soft">
        <p className="text-sm font-black text-slate-600">No trips are available for Live Companion QA.</p>
      </section>
    );
  }

  const dayNumbers = Array.from(new Set(liveActivities.map((activity) => activity.dayNumber || 1))).sort((a, b) => a - b);
  const dayActivities = liveActivities.filter((activity) => (activity.dayNumber || 1) === selectedDay).slice(0, 6);

  return (
    <div className="grid gap-5">
      <section className="rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
        <div className="grid gap-3 lg:grid-cols-[1fr_0.65fr_0.65fr]">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-ocean">Trip</span>
            <select
              value={selectedTrip.id}
              onChange={(event) => {
                setTripId(event.target.value);
                setLogs([]);
              }}
              className="mt-2 min-h-12 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink"
            >
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {(trip.title || getTripDestinationLabel(trip) || "Trip").slice(0, 90)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-ocean">Simulated time</span>
            <input
              value={simulatedNow.slice(0, 16)}
              onChange={(event) => setSimulatedNow(new Date(event.target.value).toISOString())}
              type="datetime-local"
              className="mt-2 min-h-12 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-ocean">Location</span>
            <select
              value={selectedLocationActivity?.id || ""}
              onChange={(event) => moveToActivity(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink"
            >
              {liveActivities.map((activity) => (
                <option key={activity.id} value={activity.id}>{activity.title}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          {[
            ["Trip start", () => setNowFromTrip(0, 8)],
            ["Before trip", () => setNowFromTrip(-1, 12)],
            ["Next time", () => setNowFromTrip(0, 11)],
            ["Arrive", () => triggerNotification("arrival", "QA arrival inside configured radius.")],
            ["Late", () => {
              setLateNow();
              triggerNotification("late", "QA late threshold exceeded.");
            }],
            ["Route down", () => setRouteScenario("unavailable")],
            ["Permission denied", () => setPermission("denied")],
            ["Offline", () => setOffline((value) => !value)]
          ].map(([label, action]) => (
            <button
              key={String(label)}
              type="button"
              onClick={action as () => void}
              className="min-h-11 rounded-2xl border border-ocean/20 bg-ocean/5 px-3 py-2 text-xs font-black text-ocean"
            >
              {String(label)}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {phonePresets.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPhoneWidth(value)}
                  className={classNames(
                    "min-h-11 rounded-2xl px-3 py-2 text-xs font-black",
                    phoneWidth === value ? "bg-ink text-white" : "border border-slate-200 bg-white text-slate-700"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {previewModes.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPreviewMode(value)}
                  className={classNames(
                    "min-h-11 rounded-2xl px-3 py-2 text-xs font-black",
                    previewMode === value ? "bg-ocean text-white" : "border border-slate-200 bg-white text-slate-700"
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDarkMode((value) => !value)}
                className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
              >
                {darkMode ? "Dark on" : "Dark off"}
              </button>
              <button
                type="button"
                onClick={() => setLongTextStress((value) => !value)}
                className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
              >
                Long text
              </button>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-[1.5rem] bg-slate-100 p-4">
            <div className={classNames("mx-auto overflow-hidden rounded-[2rem] border shadow-soft", darkMode ? "dark border-slate-800" : "border-slate-200")} style={{ width: `${phoneWidth}px` }}>
              <div className="min-h-[680px] bg-[#fbf8ef] p-3 text-ink dark:bg-slate-950 dark:text-white">
                {previewMode === "live" ? (
                  <div className="rounded-[1.35rem] bg-ink p-4 text-white dark:bg-black">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-white/50">Now</p>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.08em]">
                        {companionState.activationStatus}
                      </span>
                    </div>
                    <h2 className="mt-4 text-3xl font-black leading-tight">{companionState.now?.title || "Schedule only"}</h2>
                    <p className="mt-3 text-sm font-semibold leading-6 text-white/65">{companionState.now?.shortDescription || companionState.activationReason}</p>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-white/10 p-3">
                        <p className="text-[0.65rem] font-black uppercase tracking-[0.1em] text-white/45">Countdown</p>
                        <p className="mt-1 text-lg font-black">{countdown(companionState.countdownMinutes)}</p>
                      </div>
                      <div className="rounded-2xl bg-white/10 p-3">
                        <p className="text-[0.65rem] font-black uppercase tracking-[0.1em] text-white/45">Leave by</p>
                        <p className="mt-1 text-lg font-black">{formatClock(companionState.leaveBy, timezone)}</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-2xl bg-white/10 p-3">
                      <p className="text-[0.65rem] font-black uppercase tracking-[0.1em] text-white/45">Next</p>
                      <p className="mt-1 text-lg font-black">{companionState.next?.title || "Flexible"}</p>
                      <p className="mt-1 text-xs font-bold text-white/55">{route.status === "verified" ? `${route.durationMinutes} min route` : route.reason}</p>
                    </div>
                    <button className="mt-4 min-h-12 w-full rounded-2xl bg-white text-sm font-black text-ink">Open in Maps</button>
                    <div className="mt-4 grid gap-2">
                      {[companionState.now, companionState.next].filter(Boolean).map((item) => (
                        <div key={item!.id} className="rounded-2xl bg-white/8 p-3">
                          <p className="truncate text-sm font-black">{item!.title}</p>
                          <p className="mt-1 text-xs font-bold text-white/45">{item!.timeLabel || "Time not set"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {previewMode === "itinerary" ? (
                  <div className="grid gap-3">
                    <div className="sticky top-0 -mx-3 bg-[#fbf8ef]/95 px-3 py-2 backdrop-blur dark:bg-slate-950/95">
                      <div className="flex gap-2 overflow-x-auto">
                        {dayNumbers.map((day) => (
                          <button
                            key={day}
                            onClick={() => setSelectedDay(day)}
                            className={classNames(
                              "min-h-11 rounded-full px-4 text-xs font-black",
                              selectedDay === day ? "bg-ink text-white dark:bg-white dark:text-ink" : "border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                            )}
                          >
                            Day {day}
                          </button>
                        ))}
                      </div>
                    </div>
                    {dayActivities.map((activity) => (
                      <article key={activity.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/10">
                        <p className="text-xs font-black uppercase tracking-[0.12em] text-ocean dark:text-cyan-200">{activity.timeLabel || "Flexible"}</p>
                        <h3 className="mt-1 text-lg font-black">{activity.title}</h3>
                        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{activity.shortDescription}</p>
                        <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">{activity.address || activity.placeName || "Address unavailable"}</p>
                      </article>
                    ))}
                  </div>
                ) : null}

                {previewMode === "generation" ? (
                  <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/10">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean dark:text-cyan-200">Generation</p>
                    <h2 className="mt-2 text-2xl font-black">Building your trip</h2>
                    <div className="mt-4 grid gap-3">
                      {["Outline", "Day 1 of N", "Finalizing", "Complete"].map((step, index) => (
                        <div key={step} className="flex items-center gap-3">
                          <span className={classNames("h-4 w-4 rounded-full", index <= 1 ? "bg-ocean" : "bg-slate-200 dark:bg-white/20")} />
                          <p className="text-sm font-black">{step}</p>
                        </div>
                      ))}
                    </div>
                    <button className="mt-5 min-h-12 w-full rounded-2xl bg-ocean text-sm font-black text-white">Retry</button>
                  </div>
                ) : null}

                {previewMode === "bookings" ? (
                  <div className="grid gap-3">
                    {tripBookings.slice(0, 6).map((booking) => (
                      <article key={booking.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/10">
                        <p className="text-xs font-black uppercase tracking-[0.12em] text-ocean dark:text-cyan-200">{booking.booking_type}</p>
                        <h3 className="mt-1 text-lg font-black">{booking.title || "Booking"}</h3>
                        <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">{[booking.provider_name, booking.start_date, booking.start_time].filter(Boolean).join(" · ") || "Details saved"}</p>
                        <details className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-white/10">
                          <summary className="cursor-pointer text-sm font-black">Details</summary>
                          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-300">{booking.confirmation_number || "No reference saved"}</p>
                        </details>
                      </article>
                    ))}
                    {!tripBookings.length ? <p className="rounded-2xl bg-white p-4 text-sm font-black dark:bg-white/10">No bookings saved for this trip.</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="grid gap-4">
          <section className="rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">State</p>
            <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700">
              <p>Activation: {companionState.activationStatus}</p>
              <p>Now: {companionState.now?.title || "None"}</p>
              <p>Next: {companionState.next?.title || "None"}</p>
              <p>Arrival: {companionState.arrivalState}</p>
              <p>Late: {companionState.lateByMinutes ? `${companionState.lateByMinutes} min` : "No"}</p>
              <p>Sent last hour: {sentLastHour}/{settings.maxNotificationsPerHour}</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setPaused(true)} className="min-h-11 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black">Pause</button>
              <button onClick={() => setPaused(false)} className="min-h-11 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black">Resume</button>
              <button onClick={() => triggerNotification("next_activity", "Manual QA next-activity notification trigger.")} className="min-h-11 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black">Next alert</button>
              <button onClick={() => {
                triggerNotification("leave_by", "First cooldown test reminder.");
                triggerNotification("leave_by", "Second cooldown test reminder.");
              }} className="min-h-11 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black">Cooldown</button>
              <button onClick={resetQa} className="col-span-2 min-h-11 rounded-2xl bg-ink px-3 py-2 text-xs font-black text-white">Reset</button>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">Thresholds</p>
            {[
              ["Reminder lead", "reminderLeadMinutes", 5, 180],
              ["Cooldown", "cooldownMinutes", 1, 120],
              ["Location interval", "locationUpdateIntervalSeconds", 30, 600],
              ["Late threshold", "lateThresholdMinutes", 1, 60],
              ["Arrival radius", "arrivalRadiusMeters", 25, 500],
              ["Max/hour", "maxNotificationsPerHour", 1, 12]
            ].map(([label, key, min, max]) => (
              <label key={String(key)} className="mt-3 block">
                <span className="text-xs font-black text-slate-500">{String(label)}: {settings[key as keyof typeof settings]}</span>
                <input
                  type="range"
                  min={Number(min)}
                  max={Number(max)}
                  value={Number(settings[key as keyof typeof settings])}
                  onChange={(event) => setSettings((current) => ({ ...current, [key as string]: Number(event.target.value) }))}
                  className="mt-2 w-full"
                />
              </label>
            ))}
          </section>
        </aside>
      </section>

      <section className="rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">Notification test log</p>
            <h2 className="mt-1 text-xl font-black text-ink">Why each notification fired</h2>
          </div>
          <button type="button" onClick={() => setLogs([])} className="min-h-11 rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black">
            Clear
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {logs.map((log) => (
            <article key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-ink">{log.eventType} · {log.activityTitle || "Trip"}</p>
                <LogBadge sent={log.notificationSent} />
              </div>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {formatClock(log.eventTime, timezone)} · {log.locationState} · {log.reason}
              </p>
              {!log.notificationSent ? (
                <p className="mt-1 text-xs font-black text-amber-800">Suppression: {log.suppressionReason}</p>
              ) : null}
            </article>
          ))}
          {!logs.length ? (
            <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-black text-slate-500">
              Trigger an arrival, late, leave-by, or next-activity notification to inspect the decision.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
