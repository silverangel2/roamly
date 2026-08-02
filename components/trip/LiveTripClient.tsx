"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityRecord, ChecklistRecord } from "@/lib/trips";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import {
  DEFAULT_LIVE_COMPANION_SETTINGS,
  activityStartDate,
  applyVerifiedBookingOverride,
  buildLiveCompanionState,
  calculateDistanceMeters,
  fallbackRouteStatus,
  mapsUrlForActivity,
  type LiveBookingDetails,
  type LiveCompanionActivity,
  type LiveCoordinates,
  type LiveLocationPermission,
  type LiveRouteStatus
} from "@/lib/roamly/liveCompanion";

export type LiveSimulatorPlace = {
  id: string;
  title: string;
  kind: "activity" | "hotel" | "booking" | "airport" | "destination";
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  status?: string | null;
};

export type LiveCompanionBookingDetail = LiveBookingDetails;

type SimulationResponse = {
  ok?: boolean;
  latitude?: number;
  longitude?: number;
  nearbyActivities?: Array<{ id?: string; title?: string; distance_meters?: number | null }>;
  upNextActivity?: { id?: string; title?: string; distance_meters?: number | null } | null;
  notificationCreated?: boolean;
  error?: string | null;
};

type LiveTripClientProps = {
  tripId: string;
  activities: ActivityRecord[];
  checklist: ChecklistRecord[];
  canSimulateLocation?: boolean;
  destinationLabel?: string;
  simulatorPlaces?: LiveSimulatorPlace[];
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  timezone?: string | null;
  companionEnabled?: boolean;
  companionPausedUntil?: string | null;
  backgroundLocationEnabled?: boolean;
  initialPermissionState?: LiveLocationPermission;
  initialLocation?: LiveCoordinates | null;
  bookingDetails?: LiveCompanionBookingDetail[];
};

const SIMULATED_LOCATION_KEY = "roamly_live_simulated_location";
const ROUTE_FETCH_DEBOUNCE_MS = 1200;
const MIN_LOCATION_DELTA_METERS = 75;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatClock(value: string | null | undefined, timezone?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "Not set";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined
  }).format(date);
}

function countdownCopy(minutes: number | null) {
  if (minutes == null) return "No start time";
  if (minutes < -5) return "Started";
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function statusLabel(status: string | null | undefined) {
  if (status === "active") return "Live";
  if (status === "schedule_only") return "Schedule only";
  if (status === "permission_required") return "Location needed";
  if (status === "too_far") return "Near destination to start";
  if (status === "paused") return "Paused";
  if (status === "disabled") return "Off";
  if (status === "future_trip") return "Future trip";
  if (status === "completed_trip") return "Completed";
  return "Checking";
}

function routeCopy(route: LiveRouteStatus) {
  if (route.status === "verified") return `${route.durationMinutes} min ${route.mode}`;
  if (route.status === "offline") return "Offline";
  if (route.status === "permission_denied") return "Location denied";
  return "Route unavailable";
}

function primaryAddress(activity: LiveCompanionActivity | null) {
  if (!activity) return "No destination selected";
  return activity.address || activity.placeName || activity.title;
}

function placeText(place: Pick<LiveSimulatorPlace, "title" | "address"> | string | null | undefined, destination = "") {
  const text =
    typeof place === "string"
      ? `${place} ${destination}`
      : `${place?.title || ""} ${place?.address || ""} ${destination}`;
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function knownCoordinates(input: string, destination: string) {
  const text = placeText(input, destination);
  const known: Array<[RegExp, { latitude: number; longitude: number; label: string }]> = [
    [/notre.?dame basilica|basilique notre.?dame/, { latitude: 45.5045, longitude: -73.5561, label: "Notre-Dame Basilica" }],
    [/pointe.?a.?calliere/, { latitude: 45.5027, longitude: -73.5545, label: "Pointe-a-Calliere Museum" }],
    [/mount royal|mont royal|mont-royal/, { latitude: 45.5017, longitude: -73.587, label: "Mount Royal" }],
    [/old montreal|vieux.?montreal|old port/, { latitude: 45.5066, longitude: -73.554, label: "Old Montreal" }],
    [/cn tower/, { latitude: 43.6426, longitude: -79.3871, label: "CN Tower" }],
    [/ripley/, { latitude: 43.6424, longitude: -79.386, label: "Ripley's Aquarium" }],
    [/harbourfront/, { latitude: 43.6387, longitude: -79.3822, label: "Harbourfront" }],
    [/royal ontario museum|\brom\b/, { latitude: 43.6677, longitude: -79.3948, label: "Royal Ontario Museum" }],
    [/kensington/, { latitude: 43.6545, longitude: -79.4015, label: "Kensington Market" }],
    [/yul|trudeau|montreal airport/, { latitude: 45.4706, longitude: -73.7408, label: "YUL airport" }],
    [/yyz|pearson|toronto airport/, { latitude: 43.6777, longitude: -79.6248, label: "YYZ airport" }]
  ];
  return known.find(([pattern]) => pattern.test(text))?.[1] || null;
}

function cityFallback(destination: string) {
  const text = placeText(destination);
  const known: Array<[RegExp, { latitude: number; longitude: number; label: string }]> = [
    [/montreal/, { latitude: 45.5019, longitude: -73.5674, label: "Montreal center" }],
    [/toronto/, { latitude: 43.6532, longitude: -79.3832, label: "Toronto center" }],
    [/vancouver/, { latitude: 49.2827, longitude: -123.1207, label: "Vancouver center" }],
    [/new york/, { latitude: 40.7128, longitude: -74.006, label: "New York center" }],
    [/london/, { latitude: 51.5072, longitude: -0.1276, label: "London center" }],
    [/paris/, { latitude: 48.8566, longitude: 2.3522, label: "Paris center" }],
    [/tokyo/, { latitude: 35.6762, longitude: 139.6503, label: "Tokyo center" }]
  ];
  return known.find(([pattern]) => pattern.test(text))?.[1] || { latitude: 43.6532, longitude: -79.3832, label: "Destination center" };
}

function offsetMeters(coords: { latitude: number; longitude: number }, meters: number) {
  return {
    latitude: coords.latitude + meters / 111_320,
    longitude: coords.longitude
  };
}

function activityPlace(activity: ActivityRecord, simulatorPlaces: LiveSimulatorPlace[]) {
  return (
    simulatorPlaces.find((place) => place.id === `activity:${activity.id}`) ||
    simulatorPlaces.find((place) => place.title.toLowerCase() === activity.title.toLowerCase()) ||
    null
  );
}

function bookingForActivity(activity: ActivityRecord, bookings: LiveCompanionBookingDetail[]) {
  const title = activity.title.toLowerCase();
  return bookings.find((booking) => {
    const bookingTitle = (booking.title || "").toLowerCase();
    return bookingTitle && (bookingTitle === title || title.includes(bookingTitle) || bookingTitle.includes(title));
  }) || null;
}

function progressItems(now: LiveCompanionActivity | null, next: LiveCompanionActivity | null, items: LiveCompanionActivity[]) {
  const visible = items.slice(0, 6);
  if (now && !visible.some((item) => item.id === now.id)) visible.unshift(now);
  if (next && !visible.some((item) => item.id === next.id)) visible.push(next);
  return visible.slice(0, 6);
}

export function LiveTripClient({
  tripId,
  activities,
  checklist,
  canSimulateLocation = false,
  destinationLabel = "",
  simulatorPlaces = [],
  tripStartDate = null,
  tripEndDate = null,
  timezone = null,
  companionEnabled = true,
  companionPausedUntil = null,
  backgroundLocationEnabled = false,
  initialPermissionState = "prompt",
  initialLocation = null,
  bookingDetails = []
}: LiveTripClientProps) {
  const [items, setItems] = useState(activities);
  const [permission, setPermission] = useState<LiveLocationPermission>(initialPermissionState);
  const [location, setLocation] = useState<LiveCoordinates | null>(initialLocation);
  const [watching, setWatching] = useState(false);
  const [route, setRoute] = useState<LiveRouteStatus>(() => fallbackRouteStatus(null));
  const [routeBusy, setRouteBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [qaBusy, setQaBusy] = useState("");
  const [selectedPlaceId, setSelectedPlaceId] = useState(simulatorPlaces[0]?.id || "");
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ at: number; location: LiveCoordinates } | null>(null);
  const lastRouteKeyRef = useRef("");
  const routeTimerRef = useRef<number | null>(null);

  const placeOptions = useMemo(() => {
    const byKey = new Map<string, LiveSimulatorPlace>();
    for (const place of simulatorPlaces) byKey.set(place.id, place);
    for (const activity of activities) {
      const id = `display:${activity.id}`;
      if (!byKey.has(id)) {
        byKey.set(id, {
          id,
          title: activity.title,
          kind: "activity",
          latitude: null,
          longitude: null,
          address: activity.map_query || activity.location_name,
          status: activity.status
        });
      }
    }
    return Array.from(byKey.values());
  }, [activities, simulatorPlaces]);

  const liveActivities = useMemo(() => {
    return items.map((activity): LiveCompanionActivity => {
      const place = activityPlace(activity, simulatorPlaces);
      const booking = bookingForActivity(activity, bookingDetails);
      const base: LiveCompanionActivity = {
        id: activity.id,
        title: activity.title,
        shortDescription: activity.description,
        dayNumber: activity.day_number,
        timeLabel: activity.time_label,
        address: activity.map_query || place?.address || activity.location_name,
        placeName: activity.location_name || place?.title,
        latitude: getNumber(place?.latitude),
        longitude: getNumber(place?.longitude),
        radiusMeters: 140,
        status: activity.status,
        booking
      };
      return applyVerifiedBookingOverride(base, bookingDetails);
    });
  }, [bookingDetails, items, simulatorPlaces]);

  const model = useMemo(
    () =>
      buildLiveCompanionState({
        trip: {
          id: tripId,
          title: destinationLabel,
          startDate: tripStartDate,
          endDate: tripEndDate,
          timezone,
          enabled: companionEnabled,
          pausedUntil: companionPausedUntil,
          destination: {
            label: destinationLabel,
            latitude: getNumber(simulatorPlaces.find((place) => place.kind === "destination")?.latitude),
            longitude: getNumber(simulatorPlaces.find((place) => place.kind === "destination")?.longitude)
          }
        },
        activities: liveActivities,
        permission,
        location,
        route,
        now: nowTick
      }),
    [
      companionEnabled,
      companionPausedUntil,
      destinationLabel,
      liveActivities,
      location,
      permission,
      route,
      simulatorPlaces,
      timezone,
      tripEndDate,
      tripId,
      tripStartDate,
      nowTick
    ]
  );

  const currentActivity = model.now || liveActivities[0] || null;
  const nextActivity = model.next || liveActivities.find((item) => item.id !== currentActivity?.id) || null;
  const mapsHref = useMemo(() => {
    const direct = nextActivity ? mapsUrlForActivity(nextActivity) : "";
    return direct || buildNavigationLinks({ destinationLabel: nextActivity?.title, address: primaryAddress(nextActivity) })[0]?.href || "";
  }, [nextActivity]);
  const timeline = useMemo(() => progressItems(currentActivity, nextActivity, liveActivities), [currentActivity, liveActivities, nextActivity]);
  const nextStart = nextActivity ? activityStartDate({ activity: nextActivity, tripStartDate, timezone }) : null;
  const paused = model.activationStatus === "paused";
  const activeStep = currentActivity || nextActivity;

  useEffect(() => {
    setItems(activities);
  }, [activities]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    function markOnline() {
      setOnline(true);
    }
    function markOffline() {
      setOnline(false);
      setRoute((current) => ({
        status: "offline",
        mode: current.mode || null,
        mapsUrl: mapsHref,
        reason: "Offline mode. Showing saved itinerary details."
      }));
    }
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [mapsHref]);

  useEffect(() => {
    if (!("permissions" in navigator) || !navigator.permissions?.query) return;
    let cancelled = false;
    void navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      if (!cancelled) setPermission(status.state as LiveLocationPermission);
      status.onchange = () => setPermission(status.state as LiveLocationPermission);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const sendLocationUpdate = useCallback(async (nextLocation: LiveCoordinates, force = false) => {
    const now = Date.now();
    const previous = lastSentRef.current;
    if (!force && previous) {
      const elapsed = now - previous.at;
      const distance = calculateDistanceMeters(
        previous.location.latitude,
        previous.location.longitude,
        nextLocation.latitude,
        nextLocation.longitude
      );
      if (
        elapsed < DEFAULT_LIVE_COMPANION_SETTINGS.locationUpdateIntervalSeconds * 1000 &&
        distance < MIN_LOCATION_DELTA_METERS
      ) {
        return;
      }
    }
    lastSentRef.current = { at: now, location: nextLocation };
    const response = await fetch("/api/roamly/location/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId,
        latitude: nextLocation.latitude,
        longitude: nextLocation.longitude,
        accuracy: nextLocation.accuracy,
        permissionState: "granted"
      })
    });
    const data = await response.json().catch(() => null) as SimulationResponse | null;
    if (!response.ok || data?.error) throw new Error(data?.error || "Location update failed.");
    const nearbyTitles = new Set((data?.nearbyActivities || []).map((item) => item.title).filter(Boolean));
    if (nearbyTitles.size) {
      setItems((current) =>
        current.map((item) =>
          nearbyTitles.has(item.title) && !["completed", "skipped", "checked_in"].includes(item.status)
            ? { ...item, status: "nearby" }
            : item
        )
      );
    }
  }, [tripId]);

  const startForegroundLocation = useCallback(async () => {
    setError("");
    setNotice("");
    if (!navigator.geolocation) {
      setPermission("unavailable");
      setError("This browser does not support location sensing.");
      return;
    }
    try {
      await fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationTrackingEnabled: true, notificationEnabled: true })
      });
    } catch {
      setNotice("Location permission can still be requested, but account settings could not be refreshed.");
    }

    const handlePosition = (position: GeolocationPosition) => {
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      setPermission("granted");
      setLocation(nextLocation);
      setWatching(true);
      void sendLocationUpdate(nextLocation).catch((err) => {
        setNotice(err instanceof Error ? err.message : "Location update failed.");
      });
    };
    const handleError = (geoError: GeolocationPositionError) => {
      const denied = geoError.code === geoError.PERMISSION_DENIED;
      setPermission(denied ? "denied" : "unavailable");
      setWatching(false);
      void fetch("/api/roamly/location/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, permissionState: denied ? "denied" : "prompt" })
      }).catch(() => undefined);
      setError(denied ? "Location permission was denied. Schedule-only mode is still available." : "Location is unavailable right now.");
    };

    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: false,
      maximumAge: 120_000,
      timeout: 20_000
    });
  }, [sendLocationUpdate, tripId]);

  const stopForegroundLocation = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  }, []);

  useEffect(() => stopForegroundLocation, [stopForegroundLocation]);

  useEffect(() => {
    if (!nextActivity) return;
    if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    routeTimerRef.current = window.setTimeout(() => {
      const key = [
        nextActivity.id,
        nextActivity.latitude,
        nextActivity.longitude,
        nextActivity.address,
        location?.latitude,
        location?.longitude,
        online
      ].join("|");
      if (key === lastRouteKeyRef.current) return;
      lastRouteKeyRef.current = key;

      if (!online) {
        setRoute({
          status: "offline",
          mapsUrl: mapsHref,
          reason: "Offline mode. Showing saved itinerary details."
        });
        return;
      }
      if (!location) {
        setRoute(fallbackRouteStatus(nextActivity, "Location is unavailable. Open Maps for directions."));
        return;
      }

      setRouteBusy(true);
      void fetch(`/api/trips/${tripId}/live-companion/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originLatitude: location.latitude,
          originLongitude: location.longitude,
          accuracy: location.accuracy,
          destinationId: nextActivity.id,
          destinationTitle: nextActivity.title,
          destinationAddress: nextActivity.address,
          destinationPlaceName: nextActivity.placeName,
          destinationLatitude: nextActivity.latitude,
          destinationLongitude: nextActivity.longitude,
          mode: "walking"
        })
      })
        .then(async (response) => {
          const data = await response.json().catch(() => null) as { route?: LiveRouteStatus; error?: string } | null;
          if (!response.ok) throw new Error(data?.error || "Route unavailable.");
          setRoute(data?.route || fallbackRouteStatus(nextActivity));
        })
        .catch(() => {
          setRoute(fallbackRouteStatus(nextActivity, "Live routing failed. Open Maps for directions."));
        })
        .finally(() => setRouteBusy(false));
    }, ROUTE_FETCH_DEBOUNCE_MS);
    return () => {
      if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    };
  }, [location, mapsHref, nextActivity, online, tripId]);

  async function saveLiveControls(patch: { liveCompanionEnabled?: boolean; liveCompanionPausedUntil?: string | null }) {
    setError("");
    setNotice("");
    const response = await fetch(`/api/trips/${tripId}/companion/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not update Live Companion controls.");
  }

  async function pauseCompanion() {
    try {
      await saveLiveControls({
        liveCompanionEnabled: true,
        liveCompanionPausedUntil: new Date(Date.now() + 60 * 60_000).toISOString()
      });
      stopForegroundLocation();
      setNotice("Live Companion paused for 1 hour.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pause Live Companion.");
    }
  }

  async function resumeCompanion() {
    try {
      await saveLiveControls({ liveCompanionEnabled: true, liveCompanionPausedUntil: null });
      setNotice("Live Companion resumed. Refresh if the paused badge remains.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume Live Companion.");
    }
  }

  async function runAction(activityId: string, action: "check-in" | "skip" | "complete") {
    setBusy(activityId + action);
    setError("");
    const endpoint =
      action === "check-in"
        ? "/api/roamly/activities/check-in"
        : action === "skip"
          ? "/api/roamly/activities/skip"
          : "/api/roamly/activities/complete";
    const nextStatus = action === "check-in" ? "checked_in" : action === "skip" ? "skipped" : "completed";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          activityId,
          ...(location
            ? {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy
              }
            : {})
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update activity.");
      setItems((current) => current.map((item) => (item.id === activityId ? { ...item, status: nextStatus } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update activity.");
    } finally {
      setBusy("");
    }
  }

  function resolvePlace(place: LiveSimulatorPlace | null, fallbackLabel = "Simulated location") {
    const latitude = getNumber(place?.latitude);
    const longitude = getNumber(place?.longitude);
    if (latitude != null && longitude != null) return { latitude, longitude, label: place?.title || fallbackLabel, target: place?.id };
    const known = knownCoordinates(placeText(place, destinationLabel), destinationLabel);
    if (known) return { ...known, target: place?.id };
    const fallback = cityFallback(destinationLabel);
    return { ...fallback, label: place?.title || fallback.label || fallbackLabel, target: place?.id };
  }

  async function activateSimulatedLocation(target: { latitude: number; longitude: number; label: string; target?: string }) {
    setQaBusy(target.label);
    setError("");
    setNotice("");
    const nextLocation = { latitude: target.latitude, longitude: target.longitude, accuracy: 15 };
    try {
      window.localStorage.setItem(
        SIMULATED_LOCATION_KEY,
        JSON.stringify({ active: true, tripId, ...nextLocation, label: target.label, target: target.target, updatedAt: Date.now() })
      );
      const response = await fetch("/api/roamly/location/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          latitude: target.latitude,
          longitude: target.longitude,
          label: target.label,
          target: target.target,
          simulated: true
        })
      });
      const data = await response.json().catch(() => null) as SimulationResponse | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not simulate location.");
      setPermission("granted");
      setLocation(nextLocation);
      setNotice(`Simulated location active: ${target.label}.`);
      const nearbyTitles = new Set((data.nearbyActivities || []).map((item) => item.title).filter(Boolean));
      if (nearbyTitles.size) {
        setItems((current) =>
          current.map((item) =>
            nearbyTitles.has(item.title) && !["completed", "skipped", "checked_in"].includes(item.status)
              ? { ...item, status: "nearby" }
              : item
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not simulate location.");
    } finally {
      setQaBusy("");
    }
  }

  const selectedPlace = placeOptions.find((place) => place.id === selectedPlaceId) || placeOptions[0] || null;
  const qaActions = [
    { label: "Current", place: selectedPlace },
    { label: "Next", place: placeOptions.find((place) => place.title.toLowerCase() === nextActivity?.title.toLowerCase()) || selectedPlace },
    {
      label: "Arrived",
      place: placeOptions.find((place) => place.title.toLowerCase() === currentActivity?.title.toLowerCase()) || selectedPlace
    },
    {
      label: "100m away",
      place: null,
      custom: () => {
        const base = resolvePlace(selectedPlace);
        return { ...offsetMeters(base, 100), label: `${base.label} - 100m away`, target: base.target };
      }
    },
    {
      label: "2km away",
      place: null,
      custom: () => {
        const base = resolvePlace(selectedPlace);
        return { ...offsetMeters(base, 2000), label: `${base.label} - 2km away`, target: base.target };
      }
    }
  ];

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 pb-28 md:pb-0">
      <section className="overflow-hidden rounded-[1.25rem] bg-ink text-white shadow-[0_18px_50px_rgba(16,32,51,0.24)] dark:bg-slate-950">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-white/55">Live Companion</p>
              <p className="mt-1 text-sm font-black">{destinationLabel || "Current trip"}</p>
            </div>
            <span
              className={classNames(
                "rounded-full border px-3 py-1.5 text-[0.68rem] font-black uppercase tracking-[0.1em]",
                model.activationStatus === "active"
                  ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
                  : "border-white/15 bg-white/10 text-white/80"
              )}
            >
              {statusLabel(model.activationStatus)}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[1.15fr_0.85fr] md:p-6">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-lagoon">Now</p>
            <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight sm:text-5xl">
              {currentActivity?.title || "Schedule ready"}
            </h1>
            <p className="mt-3 line-clamp-3 text-sm font-semibold leading-6 text-white/72">
              {currentActivity?.shortDescription || model.activationReason}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-white/45">Next</p>
                <p className="mt-1 truncate text-sm font-black">{nextActivity?.title || "Flexible"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-white/45">Countdown</p>
                <p className="mt-1 text-sm font-black">{countdownCopy(model.countdownMinutes)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-white/45">Leave by</p>
                <p className="mt-1 text-sm font-black">{model.leaveBy ? formatClock(model.leaveBy, timezone) : "Open Maps"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-white/45">Route</p>
                <p className="mt-1 text-sm font-black">{routeBusy ? "Checking" : routeCopy(model.route)}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-white/45">Address</p>
              <p className="mt-1 text-sm font-black leading-5">{primaryAddress(nextActivity || currentActivity)}</p>
              {nextActivity?.openingHours ? (
                <p className="mt-2 text-xs font-bold text-white/60">Hours: {nextActivity.openingHours}</p>
              ) : null}
            </div>

            {(nextActivity?.booking?.reference || nextActivity?.booking?.provider || nextActivity?.booking?.gate || nextActivity?.booking?.terminal) ? (
              <details className="mt-3 rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                <summary className="cursor-pointer text-sm font-black text-white">Booking details</summary>
                <div className="mt-3 grid gap-2 text-sm font-semibold text-white/72">
                  {[
                    ["Provider", nextActivity.booking?.provider],
                    ["Reference", nextActivity.booking?.reference],
                    ["Terminal", nextActivity.booking?.terminal],
                    ["Gate", nextActivity.booking?.gate]
                  ]
                    .filter((row): row is [string, string] => Boolean(row[1]))
                    .map(([label, value]) => (
                      <p key={label} className="rounded-xl bg-white/8 px-3 py-2">
                        <span className="text-white/45">{label}: </span>
                        {value}
                      </p>
                    ))}
                </div>
              </details>
            ) : null}

            <a
              href={mapsHref || "#"}
              target={mapsHref ? "_blank" : undefined}
              rel={mapsHref ? "noreferrer" : undefined}
              className={classNames(
                "mt-5 hidden min-h-12 items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink md:inline-flex",
                !mapsHref && "pointer-events-none opacity-50"
              )}
            >
              Open in Maps
            </a>
          </div>

          <div className="grid gap-3">
            <section className="rounded-2xl border border-white/10 bg-white/8 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">Progress</p>
                <p className="text-xs font-black text-white/55">{formatClock(nextStart?.toISOString() || null, timezone)}</p>
              </div>
              <div className="mt-4 grid gap-3">
                {timeline.map((item) => {
                  const active = item.id === currentActivity?.id;
                  const upcoming = item.id === nextActivity?.id;
                  return (
                    <div key={item.id} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3">
                      <span
                        className={classNames(
                          "mt-1 h-3 w-3 rounded-full border",
                          active ? "border-lagoon bg-lagoon" : upcoming ? "border-sun bg-sun" : "border-white/30 bg-white/10"
                        )}
                      />
                      <div className="min-w-0">
                        <p className={classNames("truncate text-sm font-black", active ? "text-white" : "text-white/72")}>
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs font-bold text-white/45">{item.timeLabel || formatClock(activityStartDate({ activity: item, tripStartDate, timezone })?.toISOString() || null, timezone)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/8 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">Location</p>
              <p className="mt-2 text-sm font-black">
                {watching ? "Foreground active" : permission === "granted" ? "Permission granted" : statusLabel(model.activationStatus)}
              </p>
              <p className="mt-1 text-xs font-bold leading-5 text-white/55">
                {backgroundLocationEnabled
                  ? "Background location is allowed only when supported by the device."
                  : "Using foreground location while this screen is open."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void startForegroundLocation()}
                  disabled={watching || paused || companionEnabled === false}
                  className="min-h-11 rounded-2xl bg-white px-3 py-2 text-xs font-black text-ink disabled:opacity-50"
                >
                  {watching ? "Watching" : "Use location"}
                </button>
                <button
                  type="button"
                  onClick={stopForegroundLocation}
                  disabled={!watching}
                  className="min-h-11 rounded-2xl border border-white/15 bg-white/8 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Stop
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

      {model.alerts.length || error || notice ? (
        <section className="grid gap-2">
          {model.alerts.slice(0, 2).map((alert) => (
            <p key={alert} className="rounded-2xl border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-black leading-6 text-amber-900 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100">
              {alert}
            </p>
          ))}
          {notice ? <p className="rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean dark:text-cyan-100">{notice}</p> : null}
          {error ? <p className="rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral dark:text-rose-100">{error}</p> : null}
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-[1fr_0.75fr]">
        <article className="rounded-[1.25rem] border border-cloud bg-white p-4 shadow-soft dark:border-white/10 dark:bg-slate-950 dark:text-white">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean dark:text-cyan-200">Next</p>
          <h2 className="mt-2 text-xl font-black text-ink dark:text-white">{nextActivity?.title || "Flexible time"}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {nextActivity?.shortDescription || "Use this window for rest, food, or travel buffer."}
          </p>
          <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
            <p>Start: {formatClock(nextStart?.toISOString() || null, timezone)}</p>
            <p>Address: {primaryAddress(nextActivity)}</p>
            <p>Route: {routeCopy(model.route)}</p>
          </div>
        </article>

        <article className="rounded-[1.25rem] border border-cloud bg-white p-4 shadow-soft dark:border-white/10 dark:bg-slate-950 dark:text-white">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean dark:text-cyan-200">Controls</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void pauseCompanion()}
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => void resumeCompanion()}
              className="min-h-11 rounded-2xl border border-ocean/20 bg-ocean/10 px-3 py-2 text-xs font-black text-ocean dark:text-cyan-100"
            >
              Resume
            </button>
          </div>
          <details className="mt-3 rounded-2xl bg-mist px-3 py-3 dark:bg-white/10">
            <summary className="cursor-pointer text-sm font-black text-ink dark:text-white">Essentials</summary>
            <div className="mt-3 grid gap-2">
              {checklist.slice(0, 5).map((item) => (
                <p key={item.id} className="text-sm font-bold text-slate-600 dark:text-slate-300">
                  {item.is_done ? "Done: " : ""}{item.item}
                </p>
              ))}
            </div>
          </details>
        </article>
      </section>

      <section className="grid gap-3">
        {liveActivities.slice(0, 6).map((activity) => (
          <article
            key={activity.id}
            className={classNames(
              "rounded-[1.15rem] border bg-white p-4 shadow-[0_10px_28px_rgba(16,32,51,0.05)] dark:bg-slate-950",
              activity.id === currentActivity?.id ? "border-ocean/35" : "border-cloud dark:border-white/10"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean dark:text-cyan-200">
                  {activity.timeLabel || "Flexible"} · {activity.id === currentActivity?.id ? "Now" : activity.id === nextActivity?.id ? "Next" : activity.status || "Planned"}
                </p>
                <h3 className="mt-1 text-lg font-black text-ink dark:text-white">{activity.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{activity.shortDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => void runAction(activity.id, "check-in")}
                disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(String(activity.status))}
                className="min-h-11 shrink-0 rounded-2xl bg-ocean px-3 py-2 text-xs font-black text-white disabled:opacity-45"
              >
                Check in
              </button>
            </div>
            <details className="mt-3 rounded-2xl bg-mist px-3 py-3 dark:bg-white/10">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">More</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void runAction(activity.id, "complete")}
                  disabled={Boolean(busy) || ["completed", "skipped"].includes(String(activity.status))}
                  className="min-h-11 rounded-2xl bg-ink px-3 py-2 text-xs font-black text-white disabled:opacity-45 dark:bg-white dark:text-ink"
                >
                  Mark done
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(activity.id, "skip")}
                  disabled={Boolean(busy) || ["completed", "skipped"].includes(String(activity.status))}
                  className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-45 dark:border-white/10 dark:bg-white/10 dark:text-white"
                >
                  Skip
                </button>
              </div>
            </details>
          </article>
        ))}
      </section>

      {canSimulateLocation ? (
        <details className="rounded-[1.25rem] border border-ocean/20 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-slate-950">
          <summary className="cursor-pointer text-sm font-black text-ocean dark:text-cyan-200">Tester location tools</summary>
          <div className="mt-4 grid gap-3">
            <select
              value={selectedPlaceId}
              onChange={(event) => setSelectedPlaceId(event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-cloud bg-white px-3 py-2 text-sm font-black text-ink dark:border-white/10 dark:bg-slate-900 dark:text-white"
            >
              {placeOptions.map((place) => (
                <option key={place.id} value={place.id}>{place.title}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {qaActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={Boolean(qaBusy)}
                  onClick={() => {
                    const coords = action.custom ? action.custom() : resolvePlace(action.place, action.label);
                    void activateSimulatedLocation({ latitude: coords.latitude, longitude: coords.longitude, label: coords.label || action.label, target: coords.target });
                  }}
                  className="min-h-11 rounded-2xl border border-ocean/20 bg-ocean/5 px-3 py-2 text-xs font-black text-ocean disabled:opacity-60 dark:text-cyan-100"
                >
                  {qaBusy === action.label ? "Running" : action.label}
                </button>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      {activeStep ? (
        <section className="fixed inset-x-3 bottom-[calc(6.2rem+env(safe-area-inset-bottom))] z-30 rounded-[1.15rem] border border-white/80 bg-white/96 p-2 shadow-soft backdrop-blur md:hidden dark:border-white/10 dark:bg-slate-950/96">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={() => void runAction(activeStep.id, "check-in")}
              disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(String(activeStep.status))}
              className="min-h-12 rounded-2xl bg-ocean px-3 py-2 text-sm font-black text-white disabled:opacity-45"
            >
              Check in
            </button>
            <a
              href={mapsHref || "#"}
              target={mapsHref ? "_blank" : undefined}
              rel={mapsHref ? "noreferrer" : undefined}
              className={classNames(
                "flex min-h-12 items-center justify-center rounded-2xl bg-ink px-4 py-2 text-sm font-black text-white dark:bg-white dark:text-ink",
                !mapsHref && "pointer-events-none opacity-45"
              )}
            >
              Open in Maps
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
