"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import type { ActivityRecord, ChecklistRecord } from "@/lib/trips";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";
import { isFreshLocationObservation } from "@/lib/roamly/location";
import { clearActivityNotification, ensurePushSubscription, getNotificationPermissionState, getPushCapabilityState, hasPushSubscription, isSupportedMobileEnvironment, requestNotificationPermission } from "@/lib/roamly/pushClient";
import {
  DEFAULT_LIVE_COMPANION_SETTINGS,
  activityStartDate,
  applyVerifiedBookingOverride,
  buildLiveCompanionState,
  calculateDistanceMeters,
  fallbackRouteStatus,
  isUsablePlaceLabel,
  isTodayWithinTripDates,
  localDateInTimeZone,
  mergeLiveActivityStatuses,
  directionLinksForActivity,
  googleMapsUrlForActivity,
  mapsUrlForActivity,
  persistSkippedActivityIds,
  readPersistedSkippedActivityIds,
  tripWindowState,
  type LiveBookingDetails,
  type LiveCompanionActivity,
  type LiveCoordinates,
  type LiveDirectionLinks,
  type LiveDirectionMode,
  type LiveLocationPermission,
  type LiveRouteStatus
} from "@/lib/roamly/liveCompanion";
import { cleanTravelerTimeLabel, confirmableStopTitle, isHollowTravelerPlace, looksLikeProviderSearchTitle, preTripAddressCopy, preTripPrepTitle, presentTravelerTitle, repairGarbledGettingTo, shouldSuppressFlightFraming } from "@/lib/roamly/itineraryPresentation";

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
  demo?: LiveDemoServerState | null;
  error?: string | null;
};

type LiveDemoStop = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  startAt: string;
  status: ActivityRecord["status"];
  distanceMeters?: number | null;
  insideGeofence?: boolean;
};

type LiveDemoPushResult = {
  ok: boolean;
  sent: number;
  failed: number;
  status: "sent" | "no_subscription" | "not_configured" | "failed";
};

type LiveDemoServerState = {
  active?: boolean;
  sessionId?: string;
  expiresAt?: string;
  pushSubscription?: "active" | "missing";
  nextStop?: {
    id: string;
    title: string;
    radiusMeters: number;
    distanceMeters: number | null;
    insideGeofence: boolean;
  } | null;
  stops?: Array<{
    id: string;
    title: string;
    radiusMeters: number;
    distanceMeters: number | null;
    insideGeofence: boolean;
  }>;
  lastEvent?: {
    type: string;
    title: string;
    stopId: string | null;
    createdAt: string | null;
  } | null;
  lastPushResult?: LiveDemoPushResult | null;
};

type LiveDemoState = {
  sessionId: string;
  startedAt: string;
  expiresAt: string;
  origin: LiveCoordinates;
  stops: LiveDemoStop[];
  pushSubscription: "unknown" | "active" | "missing";
  lastGpsAt: string | null;
  lastEvent: LiveDemoServerState["lastEvent"];
  lastPushResult: LiveDemoPushResult | null;
};

type LiveTripClientProps = {
  tripId: string;
  activities: ActivityRecord[];
  checklist: ChecklistRecord[];
  canSimulateLocation?: boolean;
  destinationLabel?: string;
  originLabel?: string | null;
  simulatorPlaces?: LiveSimulatorPlace[];
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  transportationPreference?: string | null;
  hasConfirmedFlight?: boolean;
  timezone?: string | null;
  companionEnabled?: boolean;
  companionPausedUntil?: string | null;
  backgroundLocationEnabled?: boolean;
  initialPermissionState?: LiveLocationPermission;
  initialTrackingEnabled?: boolean;
  initialLocation?: LiveCoordinates | null;
  bookingDetails?: LiveCompanionBookingDetail[];
  liveDemoEnabled?: boolean;
  fieldTestMode?: boolean;
};

const SIMULATED_LOCATION_KEY = "roamly_live_simulated_location";
const LIVE_DEMO_STORAGE_KEY = "roamly_live_demo_state";
const LIVE_DEMO_TTL_MS = 20 * 60_000;
const ROUTE_FETCH_DEBOUNCE_MS = 1200;
const MIN_LOCATION_DELTA_METERS = 75;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

async function getBrowserLocationPermission(): Promise<LiveLocationPermission | null> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state === "granted" || status.state === "denied" ? status.state : "prompt";
  } catch {
    return null;
  }
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatClock(value: string | null | undefined, timezone?: string | null, locale = "en") {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "Not set";
  const formatted = new Intl.DateTimeFormat(locale === "en" ? "en-CA" : locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined
  }).format(date);
  return cleanTravelerTimeLabel(formatted);
}

function formatShortDay(date: Date, timezone?: string | null, locale = "en") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone || undefined
  }).format(date);
}

function timingCopy(minutes: number | null, startDate: Date | null, timezone?: string | null, locale = "en") {
  if (minutes == null) return "No start time";
  if (minutes < -5) return "Started";
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  // Beyond two days a date beats a day-count: "Wed, Oct 21" is what the
  // traveler actually wants, and it can never be misread as a travel time
  // (the old "1232h 31m" looked like a route duration).
  if (startDate && Number.isFinite(startDate.getTime())) return formatShortDay(startDate, timezone, locale);
  const days = Math.round(minutes / (60 * 24));
  return days <= 1 ? "in 1 day" : `in ${days} days`;
}

function formatMeters(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Waiting";
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

function activityProgressLabel(status: string | null | undefined) {
  if (status === "checked_in") return "Checked in";
  if (status === "completed") return "Completed";
  if (status === "skipped") return "Skipped";
  if (status === "missed") return "Missed";
  if (status === "nearby") return "Nearby";
  if (status === "active") return "Active";
  return "Planned";
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
  return "";
}

function travelerFacingPlace(value: string | null | undefined, destination = "", suppressFlightFraming = false, origin = "") {
  if (!value || !isUsablePlaceLabel(value)) return "";
  const repaired = repairGarbledGettingTo(value, origin, destination);
  if (repaired) return repaired;
  const presented = presentTravelerTitle({
    title: value,
    destination,
    origin,
    suppressFlightFraming,
    category: value
  }).title;
  if (!presented || isHollowTravelerPlace(presented, destination)) return "";
  return presented;
}

function primaryAddress(activity: LiveCompanionActivity | null, destination = "", suppressFlightFraming = false, origin = "") {
  if (!activity) return "Details to confirm";
  const title = activityDisplayTitle(activity, "", destination, suppressFlightFraming, origin);
  const rawAddress = activity.address || activity.placeName || "";
  const namedAirportPlace = /\b(?:lounge|hotel|inn|parking|rental)\b/i.test(rawAddress);
  const placeholder = !rawAddress
    || looksLikeProviderSearchTitle(rawAddress)
    || isHollowTravelerPlace(rawAddress, destination)
    || (suppressFlightFraming && /\bairport\b/i.test(rawAddress) && !namedAirportPlace);
  if (placeholder) return title || "Details to confirm";
  return travelerFacingPlace(rawAddress, destination, suppressFlightFraming, origin) || title || "Details to confirm";
}

function activityDisplayTitle(activity: LiveCompanionActivity | null, fallback: string, destination = "", suppressFlightFraming = false, origin = "") {
  if (!activity) return fallback;
  const fromStop = confirmableStopTitle({
    title: activity.title,
    placeName: activity.placeName,
    address: activity.address,
    category: activity.category,
    origin,
    destination,
    suppressFlightFraming
  });
  const bookedName = activity.booking?.status === "verified" ? activity.booking.title : "";
  const fromBooking = bookedName
    ? confirmableStopTitle({ title: bookedName, origin, destination, suppressFlightFraming })
    : "";
  const categoryLabel = /^(?:stay in|events in|getting (?:from|to)|leave time before)\b/i;
  if (fromStop && !categoryLabel.test(fromStop)) return fromStop;
  if (fromBooking && !categoryLabel.test(fromBooking)) return fromBooking;
  return fromStop || fromBooking || fallback;
}

/** A "Trip · city" row uses the same traveler title as NEXT. */
function timelineRowTitle(
  activity: LiveCompanionActivity,
  nextTitle: string,
  destination = "",
  suppressFlightFraming = false,
  origin = ""
) {
  const title = activityDisplayTitle(activity, "Stop to confirm", destination, suppressFlightFraming, origin);
  // Only borrow NEXT when this row is still the generic "Trip · city" label.
  // A real stop that merely started as "Trip · …" keeps its own traveler title.
  if (/^trip\s*[·•|-]\s+/i.test(title) && nextTitle && !/^trip\s*[·•|-]\s+/i.test(nextTitle)) return nextTitle;
  return title;
}

function activityDisplayDescription(activity: LiveCompanionActivity | null, fallback: string) {
  if (!activity?.shortDescription) return fallback;
  return isUsablePlaceLabel(activity.shortDescription) && !looksLikeProviderSearchTitle(activity.shortDescription)
    ? activity.shortDescription
    : "We could not verify the place details for this stop yet.";
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

function offsetCoordinates(coords: { latitude: number; longitude: number }, northMeters: number, eastMeters = 0) {
  const latRadians = (coords.latitude * Math.PI) / 180;
  const longitudeScale = Math.max(0.2, Math.cos(latRadians));
  return {
    latitude: coords.latitude + northMeters / 111_320,
    longitude: coords.longitude + eastMeters / (111_320 * longitudeScale)
  };
}

function demoStorageAvailable() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function readStoredDemoState(tripId: string): LiveDemoState | null {
  if (!demoStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(LIVE_DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveDemoState & { tripId?: string };
    if (parsed.tripId && parsed.tripId !== tripId) return null;
    if (!parsed.sessionId || !parsed.expiresAt || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(LIVE_DEMO_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredDemoState(tripId: string, state: LiveDemoState | null) {
  if (!demoStorageAvailable()) return;
  try {
    if (!state) {
      window.localStorage.removeItem(LIVE_DEMO_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LIVE_DEMO_STORAGE_KEY, JSON.stringify({ ...state, tripId }));
  } catch {
    // Demo state is best-effort. The server remains the source of event truth.
  }
}

function demoPayload(state: LiveDemoState) {
  return {
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    expiresAt: state.expiresAt,
    stops: state.stops.map((stop) => ({
      id: stop.id,
      title: stop.title,
      latitude: stop.latitude,
      longitude: stop.longitude,
      radiusMeters: stop.radiusMeters,
      startAt: stop.startAt
    }))
  };
}

function makeDemoActivities(tripId: string, demo: LiveDemoState, timezone?: string | null): ActivityRecord[] {
  return demo.stops.map((stop, index) => ({
    id: stop.id,
    trip_id: tripId,
    day_number: 1,
    time_label: formatClock(stop.startAt, timezone),
    title: stop.title,
    description: `Live Demo checkpoint ${index + 1}.`,
    location_name: stop.title,
    estimated_cost: null,
    category: "live_demo",
    map_query: stop.title,
    status: stop.status
  }));
}

function makeDemoPlaces(demo: LiveDemoState): LiveSimulatorPlace[] {
  return demo.stops.map((stop) => ({
    id: `activity:${stop.id}`,
    title: stop.title,
    kind: "activity" as const,
    latitude: stop.latitude,
    longitude: stop.longitude,
    address: `${stop.title} temporary checkpoint`,
    status: stop.status
  }));
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

export function LiveTripClient({
  tripId,
  activities,
  checklist,
  canSimulateLocation = false,
  destinationLabel = "",
  originLabel = "",
  simulatorPlaces = [],
  tripStartDate = null,
  tripEndDate = null,
  transportationPreference = null,
  hasConfirmedFlight = false,
  timezone = null,
  companionEnabled = true,
  companionPausedUntil = null,
  backgroundLocationEnabled = false,
  initialPermissionState = "prompt",
  initialTrackingEnabled = false,
  initialLocation = null,
  bookingDetails = [],
  liveDemoEnabled = false,
  fieldTestMode = false
}: LiveTripClientProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const locallySkippedActivityIdsRef = useRef<Set<string>>(readPersistedSkippedActivityIds(tripId));
  const [items, setItems] = useState(() => mergeLiveActivityStatuses(activities, locallySkippedActivityIdsRef.current));
  const [permission, setPermission] = useState<LiveLocationPermission>(initialPermissionState);
  // The persisted account setting is the ONE source of truth for whether
  // location is "on". The browser permission below is only the live grant
  // state for this browser — it must never re-decide the traveler's choice.
  const [trackingEnabled, setTrackingEnabled] = useState<boolean>(Boolean(initialTrackingEnabled));
  const [notificationPermission, setNotificationPermission] = useState<string>("unknown");
  const [pushReady, setPushReady] = useState(false);
  const [location, setLocation] = useState<LiveCoordinates | null>(initialLocation);
  const [watching, setWatching] = useState(false);
  const [route, setRoute] = useState<LiveRouteStatus>(() => fallbackRouteStatus(null));
  const [routeBusy, setRouteBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [nowTick, setNowTick] = useState(() => new Date());
  const usableLocation = location && isFreshLocationObservation(location.capturedAt, nowTick.getTime()) ? location : null;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [directionMode, setDirectionMode] = useState<LiveDirectionMode>(() => {
    if (typeof window === "undefined") return "walking";
    const stored = window.localStorage.getItem("roamly-direction-mode");
    return stored === "transit" || stored === "driving" ? stored : "walking";
  });
  const updateDirectionMode = useCallback((mode: LiveDirectionMode) => {
    setDirectionMode(mode);
    try {
      window.localStorage.setItem("roamly-direction-mode", mode);
    } catch {
      // Storage is a nicety, not a requirement.
    }
  }, []);
  const [error, setError] = useState("");
  const [qaBusy, setQaBusy] = useState("");
  const [demoState, setDemoState] = useState<LiveDemoState | null>(null);
  const [demoBusy, setDemoBusy] = useState("");
  const [demoError, setDemoError] = useState("");
  const [demoNotice, setDemoNotice] = useState("");
  const [setupComplete, setSetupComplete] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [tripLinkCopied, setTripLinkCopied] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [deepLinkedActivityId, setDeepLinkedActivityId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState(simulatorPlaces[0]?.id || "");
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ at: number; location: LiveCoordinates } | null>(null);
  const lastRouteKeyRef = useRef("");
  const routeTimerRef = useRef<number | null>(null);
  const foregroundRefreshTimerRef = useRef<number | null>(null);
  const lastForegroundRefreshRef = useRef(0);
  const demoStateRef = useRef<LiveDemoState | null>(null);
  const demoStartedWatchRef = useRef(false);
  const demoActive = Boolean(demoState && liveDemoEnabled);
  const activeActivities = useMemo(
    () => (demoActive && demoState ? makeDemoActivities(tripId, demoState, timezone) : items),
    [demoActive, demoState, items, timezone, tripId]
  );
  const activeSimulatorPlaces = useMemo(
    () => (demoActive && demoState ? makeDemoPlaces(demoState) : simulatorPlaces),
    [demoActive, demoState, simulatorPlaces]
  );
  const activeDestinationLabel = demoActive ? "Live Demo" : destinationLabel;
  const activeTripStartDate = demoActive && demoState ? demoState.startedAt.slice(0, 10) : tripStartDate;
  const activeTripEndDate = demoActive && demoState ? demoState.startedAt.slice(0, 10) : tripEndDate;

  const placeOptions = useMemo(() => {
    const byKey = new Map<string, LiveSimulatorPlace>();
    for (const place of activeSimulatorPlaces) byKey.set(place.id, place);
    for (const activity of activeActivities) {
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
  }, [activeActivities, activeSimulatorPlaces]);

  const liveActivities = useMemo(() => {
    return activeActivities.map((activity) => {
      const place = activityPlace(activity, activeSimulatorPlaces);
      const booking = bookingForActivity(activity, bookingDetails);
      const base: LiveCompanionActivity = {
        id: activity.id,
        title: activity.title,
        shortDescription: activity.description,
        dayNumber: activity.day_number,
        timeLabel: activity.time_label,
        address: activity.map_query || place?.address || activity.location_name,
        placeName: activity.location_name || place?.title,
        category: activity.category,
        latitude: getNumber(place?.latitude),
        longitude: getNumber(place?.longitude),
        radiusMeters: 140,
        status: activity.status,
        booking
      };
      return {
        ...applyVerifiedBookingOverride(base, bookingDetails),
        timing_status: activity.timing_status
      };
    });
  }, [activeActivities, activeSimulatorPlaces, bookingDetails]);

  const model = useMemo(
    () =>
      buildLiveCompanionState({
        trip: {
          id: tripId,
          title: activeDestinationLabel,
          startDate: activeTripStartDate,
          endDate: activeTripEndDate,
          timezone,
          enabled: companionEnabled,
          pausedUntil: companionPausedUntil,
          destination: {
            label: activeDestinationLabel,
            latitude: getNumber(activeSimulatorPlaces.find((place) => place.kind === "destination")?.latitude),
            longitude: getNumber(activeSimulatorPlaces.find((place) => place.kind === "destination")?.longitude)
          }
        },
        activities: liveActivities,
        permission,
        location: usableLocation,
        route,
        now: nowTick
      }),
    [
      activeDestinationLabel,
      activeSimulatorPlaces,
      activeTripEndDate,
      activeTripStartDate,
      companionEnabled,
      companionPausedUntil,
      liveActivities,
      usableLocation,
      permission,
      route,
      timezone,
      tripId,
      nowTick
    ]
  );

  const currentActivity = model.now || null;
  const nextActivity = model.next || liveActivities.find((item) => item.id !== currentActivity?.id) || null;
  const todayActivities = useMemo(() => {
    return [...liveActivities].sort((a, b) => {
      const aStart = activityStartDate({ activity: a, tripStartDate: activeTripStartDate, timezone })?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bStart = activityStartDate({ activity: b, tripStartDate: activeTripStartDate, timezone })?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aStart - bStart;
    });
  }, [activeTripStartDate, liveActivities, timezone]);
  const nextTimingStatus = (nextActivity as (LiveCompanionActivity & { timing_status?: "FACTUAL" | "PLANNED" | "UNKNOWN" }) | null)?.timing_status;
  const mapsHref = useMemo(() => {
    const mapsTarget = currentActivity || nextActivity;
    return googleMapsUrlForActivity(mapsTarget, directionMode);
  }, [currentActivity, nextActivity, directionMode]);
  const directionLinks: LiveDirectionLinks = useMemo(
    () => directionLinksForActivity(currentActivity || nextActivity, directionMode),
    [currentActivity, nextActivity, directionMode]
  );
  const hasDirectionLinks = Boolean(directionLinks.google || directionLinks.apple || directionLinks.citymapper);
  const gpsStatus = useMemo(() => {
    if (usableLocation) {
      const accuracy = usableLocation.accuracy != null ? ` \u00b1${Math.round(usableLocation.accuracy)}m` : "";
      return { ok: true, copy: `GPS live${accuracy}` };
    }
    if (location) return { ok: false, copy: "GPS updating\u2026" };
    if (watching) return { ok: false, copy: "Waiting for GPS\u2026" };
    return { ok: false, copy: "GPS off" };
  }, [usableLocation, location, watching]);
  const scrollToDirections = useCallback(() => {
    document.getElementById("live-directions")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  const nextStart = nextActivity ? activityStartDate({ activity: nextActivity, tripStartDate: activeTripStartDate, timezone }) : null;
  const paused = model.activationStatus === "paused";
  const activeStep = currentActivity || nextActivity;
  const actionableActivityId = currentActivity?.id || null;
  const mobileRuntime = typeof navigator !== "undefined" && isSupportedMobileEnvironment();
  const tripWindowActive = isTodayWithinTripDates({
    startDate: activeTripStartDate,
    endDate: activeTripEndDate,
    timezone,
    now: nowTick
  });
  const tripPhaseNow = tripWindowState({
    startDate: activeTripStartDate,
    endDate: activeTripEndDate,
    timezone,
    now: nowTick
  });
  const tripCompleted = tripPhaseNow === "completed_trip";
  const preTrip = tripPhaseNow === "future_trip";

  useEffect(() => {
    let alive = true;
    const refreshInstallState = async () => {
      const capability = getPushCapabilityState();
      const currentNotificationPermission = await getNotificationPermissionState();
      const currentPushReady = capability.isStandalone
        ? currentNotificationPermission === "granted"
          ? (await ensurePushSubscription(fieldTestMode ? tripId : undefined)).ok
          : await hasPushSubscription(fieldTestMode ? tripId : undefined)
        : false;
      const currentLocationPermission = await getBrowserLocationPermission();
      if (!alive) return;
      const resolvedLocationPermission = currentLocationPermission || permission;
      setIsStandalone(capability.isStandalone);
      setNotificationPermission(currentNotificationPermission);
      setPushReady(currentPushReady);
      setPermission(resolvedLocationPermission);
      setSetupComplete(
        capability.isStandalone &&
          currentNotificationPermission === "granted" &&
          currentPushReady &&
          resolvedLocationPermission === "granted"
      );
    };
    void refreshInstallState();
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    const onPageShow = () => void refreshInstallState();
    const onVisibilityChange = () => void refreshInstallState();
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fieldTestMode, permission, tripId]);

  useEffect(() => {
    setItems(mergeLiveActivityStatuses(activities, locallySkippedActivityIdsRef.current));
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

  const applyDemoServerState = useCallback((serverDemo: LiveDemoServerState | null | undefined) => {
    if (!serverDemo?.sessionId) return;
    setDemoState((current) => {
      if (!current || current.sessionId !== serverDemo.sessionId) return current;
      const stops: LiveDemoStop[] = current.stops.map((stop) => {
        const update = serverDemo.stops?.find((item) => item.id === stop.id);
        const arrived = serverDemo.lastEvent?.stopId === stop.id && /nearby|arrival/i.test(serverDemo.lastEvent.type || "");
        return {
          ...stop,
          distanceMeters: update?.distanceMeters ?? stop.distanceMeters ?? null,
          insideGeofence: update?.insideGeofence ?? stop.insideGeofence ?? false,
          status: arrived || update?.insideGeofence ? ("nearby" as const) : stop.status
        };
      });
      const next = {
        ...current,
        pushSubscription: serverDemo.pushSubscription === "active" ? "active" as const : current.pushSubscription,
        lastGpsAt: new Date().toISOString(),
        lastEvent: serverDemo.lastEvent ?? current.lastEvent,
        lastPushResult: serverDemo.lastPushResult ?? current.lastPushResult,
        stops
      };
      demoStateRef.current = next;
      writeStoredDemoState(tripId, next);
      return next;
    });
  }, [tripId]);

  const sendLocationUpdate = useCallback(async (nextLocation: LiveCoordinates, force = false, demoOverride?: LiveDemoState | null) => {
    const demoForUpdate = demoOverride === undefined ? demoStateRef.current : demoOverride;
    const now = Date.now();
    const previous = lastSentRef.current;
    if (!demoForUpdate && !force && previous) {
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
        capturedAt: nextLocation.capturedAt,
        permissionState: "granted",
        ...(demoForUpdate ? { liveDemo: demoPayload(demoForUpdate) } : {})
      })
    });
    const data = await response.json().catch(() => null) as SimulationResponse | null;
    if (!response.ok || data?.error) throw new Error(data?.error || "Location update failed.");
    if (demoForUpdate) applyDemoServerState(data?.demo);
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
  }, [applyDemoServerState, tripId]);

  const startForegroundLocation = useCallback(async () => {
    setError("");
    setNotice("");
    if (!navigator.geolocation) {
      setPermission("unavailable");
      setError("This browser does not support location sensing.");
      return;
    }
    if (!isSupportedMobileEnvironment()) {
      setError("Live Companion runs on a supported mobile browser or installed Roamly app.");
      return;
    }
    const handlePosition = (position: GeolocationPosition) => {
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: Number.isFinite(position.timestamp) ? new Date(position.timestamp).toISOString() : null
      };
      setPermission("granted");
      setLocation(nextLocation);
      setWatching(true);
      setSetupComplete(!fieldTestMode);
      void fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationTrackingEnabled: true, notificationEnabled: true })
      }).catch(() => undefined);
      void fetch(`/api/trips/${tripId}/companion/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveCompanionEnabled: true })
      }).catch(() => undefined);
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
      enableHighAccuracy: Boolean(demoStateRef.current),
      maximumAge: 120_000,
      timeout: 20_000
    });
  }, [fieldTestMode, sendLocationUpdate, tripId]);

  // Turning location on persists the traveler's choice FIRST (server-side
  // setting + companion preference), so it stays on across pages and visits.
  // The browser grant is only requested in context: inside the travel window,
  // where sensing can actually begin.
  const persistLocationOn = useCallback(() => {
    setTrackingEnabled(true);
    void fetch("/api/roamly/location/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationTrackingEnabled: true, notificationEnabled: true })
    }).catch(() => undefined);
    void fetch(`/api/trips/${tripId}/companion/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ liveCompanionEnabled: true })
    }).catch(() => undefined);
  }, [tripId]);

  const enableLocation = useCallback(() => {
    persistLocationOn();
    if (tripWindowActive) void startForegroundLocation();
  }, [persistLocationOn, startForegroundLocation, tripWindowActive]);

  const liveTripUrl = typeof window !== "undefined" ? `${window.location.origin}/trip/${tripId}/live` : "";
  const canNativeShare = typeof navigator !== "undefined" && typeof (navigator as Navigator & { share?: unknown }).share === "function";

  function installGuideVariant(): "ios" | "samsung" | "firefox" | "chrome" {
    if (typeof navigator === "undefined") return "chrome";
    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iOS) return "ios";
    if (/SamsungBrowser/i.test(ua)) return "samsung";
    if (/Firefox|FxiOS/i.test(ua)) return "firefox";
    return "chrome";
  }
  const guideVariant = installGuideVariant();

  async function copyTripLink() {
    if (!liveTripUrl) return;
    try {
      await navigator.clipboard.writeText(liveTripUrl);
      setTripLinkCopied(true);
      window.setTimeout(() => setTripLinkCopied(false), 2500);
    } catch {
      setTripLinkCopied(false);
    }
  }

  async function shareTripLink() {
    if (!liveTripUrl) return;
    try {
      await (navigator as Navigator & { share: (data: { title?: string; text?: string; url?: string }) => Promise<void> }).share({
        title: "Roamly Live Companion",
        text: "Open my trip in Roamly",
        url: liveTripUrl
      });
    } catch {
      /* user dismissed the share sheet */
    }
  }

  async function startInstall() {
    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => undefined);
      setDeferredInstallPrompt(null);
      return;
    }
    setInstallGuideOpen(true);
  }

  const enableFieldTestNotifications = useCallback(async () => {
    setBusy("notifications");
    setError("");
    setNotice("");
    try {
      const currentPermission = await getNotificationPermissionState();
      const permissionResult = currentPermission === "granted"
        ? currentPermission
        : await requestNotificationPermission();
      setNotificationPermission(permissionResult);
      if (permissionResult !== "granted") {
        if (permissionResult === "denied") {
          throw new Error("Notifications are blocked. In iPhone Settings, allow notifications for Roamly, then return here.");
        }
        throw new Error("Notifications could not be enabled on this device.");
      }
      const push = await ensurePushSubscription(tripId);
      if (!push.ok) throw new Error(push.error || "Push subscription could not be registered. Try again.");
      setPushReady(true);
      setNotice("Notifications ready");
    } catch (err) {
      setError(localizeCustomerError(locale, err));
    } finally {
      setBusy("");
    }
  }, [locale, tripId]);

  const setupLiveCompanion = useCallback(async () => {
    setBusy("setup");
    setError("");
    setNotice("");
    try {
      if (!mobileRuntime) throw new Error("Live Companion runs on your phone. Open this trip on your phone to finish setup.");
      const push = await ensurePushSubscription(fieldTestMode ? tripId : undefined);
      if (!push.ok) {
        const currentNotificationPermission = await getNotificationPermissionState();
        setNotificationPermission(currentNotificationPermission);
        throw new Error(
          currentNotificationPermission === "denied"
            ? "Notifications are blocked. In your phone settings, allow notifications for Roamly, then return here."
            : push.error || "Notifications could not be enabled."
        );
      }
      setNotificationPermission("granted");
      setPushReady(true);
      // Persist the traveler's choice first — the persisted setting is the
      // source of truth and keeps location "on" across pages. The browser
      // grant is requested only inside the travel window, where sensing can
      // actually begin; pre-trip setup never triggers the browser ask.
      persistLocationOn();
      if (tripWindowActive) {
        await startForegroundLocation();
        setNotice("Live Companion setup is continuing: allow location when your phone asks.");
      } else {
        setNotice("You're set — location is on, and Live Companion will start when your trip begins.");
      }
    } catch (err) {
      setError(localizeCustomerError(locale, err));
    } finally {
      setBusy("");
    }
  }, [fieldTestMode, locale, mobileRuntime, persistLocationOn, startForegroundLocation, tripId, tripWindowActive]);

  const stopForegroundLocation = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  }, []);

  const stopLiveDemo = useCallback((expired = false) => {
    writeStoredDemoState(tripId, null);
    demoStateRef.current = null;
    setDemoState(null);
    setDemoBusy("");
    setDemoError("");
    if (demoStartedWatchRef.current) stopForegroundLocation();
    demoStartedWatchRef.current = false;
    setDemoNotice(expired ? "Live Demo expired." : "Live Demo stopped.");
  }, [stopForegroundLocation, tripId]);

  useEffect(() => {
    if (!liveDemoEnabled) return;
    const stored = readStoredDemoState(tripId);
    if (!stored) return;
    demoStateRef.current = stored;
    setDemoState(stored);
  }, [liveDemoEnabled, tripId]);

  useEffect(() => {
    demoStateRef.current = demoState;
    if (!demoState) return;
    writeStoredDemoState(tripId, demoState);
    const expiresIn = new Date(demoState.expiresAt).getTime() - Date.now();
    if (expiresIn <= 0) {
      stopLiveDemo(true);
      return;
    }
    const timer = window.setTimeout(() => stopLiveDemo(true), expiresIn);
    return () => window.clearTimeout(timer);
  }, [demoState, stopLiveDemo, tripId]);

  function createDemoState(origin: LiveCoordinates): LiveDemoState {
    const started = new Date();
    const expires = new Date(started.getTime() + LIVE_DEMO_TTL_MS);
    const sessionId = `live-demo-${started.getTime().toString(36)}`;
    const offsets = [
      { title: "Demo Stop 1", north: 0, east: 0, radius: 35, minutes: 0 },
      { title: "Demo Stop 2", north: 85, east: 12, radius: 45, minutes: 3 },
      { title: "Demo Stop 3", north: 155, east: 24, radius: 55, minutes: 6 }
    ];
    return {
      sessionId,
      startedAt: started.toISOString(),
      expiresAt: expires.toISOString(),
      origin,
      pushSubscription: "active",
      lastGpsAt: started.toISOString(),
      lastEvent: null,
      lastPushResult: null,
      stops: offsets.map((stop, index) => {
        const point = offsetCoordinates(origin, stop.north, stop.east);
        return {
          id: `demo-stop-${index + 1}`,
          title: stop.title,
          latitude: point.latitude,
          longitude: point.longitude,
          radiusMeters: stop.radius,
          startAt: new Date(started.getTime() + stop.minutes * 60_000).toISOString(),
          status: "planned" as const,
          distanceMeters: index === 0 ? 0 : null,
          insideGeofence: index === 0
        };
      })
    };
  }

  const getFreshPosition = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0
      });
    });
  }, []);

  async function startLiveDemo() {
    if (!liveDemoEnabled) return;
    setDemoBusy("starting");
    setDemoError("");
    setDemoNotice("");
    setError("");

    try {
      if (!navigator.geolocation) {
        throw new Error("This browser does not support location sensing.");
      }

      const push = await ensurePushSubscription();
      if (!push.ok) throw new Error(push.error || "Push subscription could not be verified.");

      const settingsResponse = await fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationTrackingEnabled: true, notificationEnabled: true })
      });
      const settingsData = await settingsResponse.json().catch(() => null);
      if (!settingsResponse.ok) {
        throw new Error(settingsData?.error || "Location settings could not be enabled.");
      }

      const position = await getFreshPosition();
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: Number.isFinite(position.timestamp) ? new Date(position.timestamp).toISOString() : null
      };
      const nextDemo = createDemoState(nextLocation);
      demoStateRef.current = nextDemo;
      setDemoState(nextDemo);
      writeStoredDemoState(tripId, nextDemo);
      setPermission("granted");
      setLocation(nextLocation);

      await sendLocationUpdate(nextLocation, true, nextDemo);

      const alreadyWatching = watchIdRef.current != null;
      demoStartedWatchRef.current = !alreadyWatching;
      if (!alreadyWatching) {
        await startForegroundLocation();
      }

      setDemoNotice("Live Demo active. Walk toward Demo Stop 2, then Demo Stop 3.");
    } catch (err) {
      writeStoredDemoState(tripId, null);
      demoStateRef.current = null;
      setDemoState(null);
      setDemoError(localizeCustomerError(locale, err));
    } finally {
      setDemoBusy("");
    }
  }

  useEffect(() => stopForegroundLocation, [stopForegroundLocation]);

  const reconcileForeground = useCallback(() => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (foregroundRefreshTimerRef.current != null) return;

    foregroundRefreshTimerRef.current = window.setTimeout(() => {
      foregroundRefreshTimerRef.current = null;
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastForegroundRefreshRef.current < 1000) return;
      lastForegroundRefreshRef.current = now;

      // Server-rendered trip, activity, booking, entitlement, and lifecycle
      // props are authoritative. Refresh them as one bounded operation while
      // preserving local permission/location/UI state in this client.
      router.refresh();
    }, 150);
  }, [router]);

  useEffect(() => {
    const onResume = () => reconcileForeground();
    window.addEventListener("pageshow", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      window.removeEventListener("pageshow", onResume);
      document.removeEventListener("visibilitychange", onResume);
      if (foregroundRefreshTimerRef.current != null) {
        window.clearTimeout(foregroundRefreshTimerRef.current);
        foregroundRefreshTimerRef.current = null;
      }
    };
  }, [reconcileForeground]);

  // Resume foreground sensing after reload when permission is already granted.
  // The trip-window guard prevents sensing before or after the eligible window.
  useEffect(() => {
    if (!mobileRuntime || !tripWindowActive || paused || companionEnabled === false || permission !== "granted" || watching) return;
    void startForegroundLocation();
  }, [companionEnabled, mobileRuntime, paused, permission, startForegroundLocation, tripWindowActive, watching]);

  useEffect(() => {
    if (tripWindowActive && !paused && companionEnabled !== false) return;
    stopForegroundLocation();
  }, [companionEnabled, paused, stopForegroundLocation, tripWindowActive]);

  useEffect(() => {
    if (!nextActivity) return;
    if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
    routeTimerRef.current = window.setTimeout(() => {
      const key = [
        nextActivity.id,
        nextActivity.latitude,
        nextActivity.longitude,
        nextActivity.address,
        usableLocation?.latitude,
        usableLocation?.longitude,
        usableLocation?.capturedAt,
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
      if (!usableLocation) {
        setRoute(fallbackRouteStatus(nextActivity, "Location is unavailable. Open Maps for directions."));
        return;
      }

      setRouteBusy(true);
      void fetch(`/api/trips/${tripId}/live-companion/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originLatitude: usableLocation.latitude,
          originLongitude: usableLocation.longitude,
          accuracy: usableLocation.accuracy,
          capturedAt: usableLocation.capturedAt,
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
  }, [usableLocation, mapsHref, nextActivity, online, tripId]);

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
      setError(localizeCustomerError(locale, err));
    }
  }

  async function resumeCompanion() {
    try {
      await saveLiveControls({ liveCompanionEnabled: true, liveCompanionPausedUntil: null });
      setNotice("Live Companion resumed. Refresh if the paused badge remains.");
    } catch (err) {
      setError(localizeCustomerError(locale, err));
    }
  }

  const runAction = useCallback(async (activityId: string, action: "check-in" | "skip" | "complete", actionLocation?: LiveCoordinates | null) => {
    setBusy(activityId + action);
    setError("");
    const activeDemo = demoStateRef.current;
    if (activeDemo) {
      const nextStatus: ActivityRecord["status"] = action === "check-in" ? "checked_in" : action === "skip" ? "skipped" : "completed";
      const nextDemo: LiveDemoState = {
        ...activeDemo,
        stops: activeDemo.stops.map((stop) => (stop.id === activityId ? { ...stop, status: nextStatus } : stop))
      };
      demoStateRef.current = nextDemo;
      setDemoState(nextDemo);
      writeStoredDemoState(tripId, nextDemo);
      setBusy("");
      return;
    }
    const endpoint =
      action === "check-in"
        ? "/api/roamly/activities/check-in"
        : action === "skip"
          ? "/api/roamly/activities/skip"
          : "/api/roamly/activities/complete";
    const nextStatus = action === "check-in" ? "checked_in" : action === "skip" ? "skipped" : "completed";
    const currentActionLocation =
      actionLocation && isFreshLocationObservation(actionLocation.capturedAt) ? actionLocation : null;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          activityId,
          ...(currentActionLocation
            ? {
                latitude: currentActionLocation.latitude,
                longitude: currentActionLocation.longitude,
                accuracy: currentActionLocation.accuracy,
                capturedAt: currentActionLocation.capturedAt
              }
            : {})
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update activity.");
      const updatedTitle = typeof data?.activity?.title === "string" ? data.activity.title : "";
      if (action === "skip") {
        locallySkippedActivityIdsRef.current.add(activityId);
        persistSkippedActivityIds(tripId, locallySkippedActivityIdsRef.current);
      }
      setItems((current) => current.map((item) => (
        item.id === activityId ? { ...item, status: nextStatus } : item
      )));
      void clearActivityNotification(tripId, activityId);
      // queuedOffline is set by the service worker when this write was stored
      // in the offline outbox (Background Sync) instead of reaching the API.
      const queuedOffline = data?.queuedOffline === true;
      const confirmation = queuedOffline
        ? "Will sync when back online."
        : action === "check-in" ? "Check-in saved." : action === "skip" ? "Activity skipped." : "Activity marked done.";
      setNotice(!queuedOffline && updatedTitle ? `${confirmation} ${updatedTitle}` : confirmation);
    } catch (err) {
      setError(localizeCustomerError(locale, err));
    } finally {
      setBusy("");
    }
  }, [locale, tripId]);

  const notificationActionHandledRef = useRef<string>("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const activityId = params.get("activity") || "";
    const action = params.get("action");
    if (!activityId || action) return;

    const activity = liveActivities.find((item) => item.id === activityId);
    if (!activity) return;

    setDeepLinkedActivityId(activity.id);
    requestAnimationFrame(() => {
      const target = document.getElementById(`live-activity-${activity.id}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
  }, [liveActivities]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const activityId = params.get("activity") || "";
    const action = params.get("action") as "check-in" | "skip" | "complete" | null;
    if (!activityId || !action || !["check-in", "skip", "complete"].includes(action)) return;
    const key = `${activityId}:${action}`;
    if (notificationActionHandledRef.current === key) return;
    notificationActionHandledRef.current = key;

    void (async () => {
      try {
        let actionLocation = location;
        if (action === "check-in") {
          if (!navigator.geolocation) throw new Error("Location permission is required to check in from a notification.");
          const position = await getFreshPosition();
          actionLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: Number.isFinite(position.timestamp) ? new Date(position.timestamp).toISOString() : null
          };
          setLocation(actionLocation);
        }
        await runAction(activityId, action, actionLocation);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("activity");
        cleanUrl.searchParams.delete("action");
        window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
      } catch (err) {
        setError(localizeCustomerError(locale, err));
      }
    })();
  }, [getFreshPosition, locale, location, runAction]);

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
      setError(localizeCustomerError(locale, err));
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
  const demoNextStop =
    demoState?.stops.find((stop) => stop.status !== "nearby") ||
    demoState?.stops[demoState.stops.length - 1] ||
    null;
  const demoRows = demoState
    ? [
        ["Demo", "Active"],
        ["GPS", location ? "Connected" : watching ? "Waiting" : "Waiting"],
        ["Push subscription", demoState.pushSubscription === "active" ? "Active" : demoState.pushSubscription === "missing" ? "Missing" : "Checking"],
        ["Current accuracy", location?.accuracy != null ? formatMeters(location.accuracy) : "Waiting"],
        ["Next demo stop", demoNextStop?.title || "Complete"],
        ["Distance to next", formatMeters(demoNextStop?.distanceMeters)],
        ["Geofence radius", demoNextStop ? formatMeters(demoNextStop.radiusMeters) : "Waiting"],
        ["Inside geofence", demoNextStop?.insideGeofence ? "Yes" : "No"],
        ["Last GPS update", demoState.lastGpsAt ? new Date(demoState.lastGpsAt).toLocaleTimeString() : "Waiting"],
        ["Last Companion event", demoState.lastEvent?.title || "Waiting"],
        [
          "Last push result",
          demoState.lastPushResult
            ? `${demoState.lastPushResult.status} (${demoState.lastPushResult.sent} sent, ${demoState.lastPushResult.failed} failed)`
            : "Waiting"
        ]
      ]
    : [];

  const suppressFlightFraming = shouldSuppressFlightFraming({ transportationPreference, hasConfirmedFlight });
  const locationOff = permission !== "granted";
  const companionStartLabel = tripStartDate
    ? new Date(`${tripStartDate}T12:00:00`).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })
    : null;
  const nextTitleRaw = activityDisplayTitle(nextActivity, "", activeDestinationLabel, suppressFlightFraming, originLabel || "");
  const nextIsHollow = preTrip && !nextTitleRaw;
  const preTripNext = preTripPrepTitle(activeDestinationLabel, tripStartDate || "");
  const displayedNextTitle = nextIsHollow ? preTripNext : activityDisplayTitle(nextActivity, preTrip ? preTripNext : "Flexible time", activeDestinationLabel, suppressFlightFraming, originLabel || "");
  const displayedAddress = nextIsHollow || (preTrip && isHollowTravelerPlace(primaryAddress(nextActivity || currentActivity, activeDestinationLabel, suppressFlightFraming, originLabel || ""), activeDestinationLabel))
    ? preTripAddressCopy(locationOff)
    : primaryAddress(nextActivity || currentActivity, activeDestinationLabel, suppressFlightFraming, originLabel || "");

  // The alerts feed is a trip-day surface only (2026-10-23): outside the
  // active trip window none of it renders. Pre-trip the page is the plan
  // plus the state lines; a completed trip carries no live feed.
  const feedAlerts = tripWindowActive ? model.alerts : [];

  // Declutter (2026-10-23): this phone's setup state is stated exactly
  // once on the live view — the quiet line in the side card. The steps
  // themselves live in the Settings cascade; the line only names the
  // first unfinished one and points there. Location's on/off fact is
  // owned by the rows under the header, never restated here.
  const setupGap =
    !fieldTestMode && !setupComplete && !watching && !tripCompleted
      ? notificationPermission !== "granted" || !pushReady
        ? { copy: "Notifications aren't on for Roamly on this phone yet.", href: "/account#setup-step-2" }
        : permission !== "granted"
          ? { copy: "Location isn't allowed for Roamly on this phone yet.", href: "/account#setup-step-3" }
          : { copy: "Live Companion setup isn't finished on this phone.", href: "/account#setup" }
      : null;
  const showSetupCard = Boolean(!mobileRuntime || !isStandalone || fieldTestMode || tripCompleted || setupGap);

  // ——— Truth rebuild (2026-10-23): composition values for the mock-04
  // layout. Eyebrow day count, the Up Next row set (today's remaining
  // stops, terminal states excluded — the day record lives on the
  // itinerary), the single Directions target (the traveler's links for
  // the current mode; provider picked the platform way — Apple Maps on
  // iOS when offered, otherwise Google, otherwise Citymapper), the
  // Essentials count, and the current stop's end time when the data
  // carries one.
  const eyebrowDay = (() => {
    if (!activeTripStartDate || !activeTripEndDate) return null;
    const start = new Date(`${activeTripStartDate}T12:00:00`);
    const end = new Date(`${activeTripEndDate}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const total = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (total < 1) return null;
    const today = new Date(`${localDateInTimeZone(nowTick, timezone || "UTC")}T12:00:00`);
    const idx = Number.isNaN(today.getTime())
      ? 1
      : Math.min(Math.max(Math.round((today.getTime() - start.getTime()) / 86400000) + 1, 1), total);
    return { idx, total };
  })();
  const upcomingToday = todayActivities.filter(
    (activity) =>
      activity.id !== currentActivity?.id &&
      !["completed", "skipped", "checked_in", "missed"].includes(String(activity.status))
  );
  const directionsHref = (() => {
    const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (isIOS && directionLinks.apple) return directionLinks.apple;
    return directionLinks.google || directionLinks.apple || directionLinks.citymapper || null;
  })();
  const essentialsDone = checklist.filter((item) => item.is_done).length;
  const currentEndLabel = currentActivity?.endAt ? formatClock(currentActivity.endAt, timezone, locale) : null;
  const rowChevron = (
    <svg width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="#B7C1D2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M1.5 1.5 6.5 6.5 1.5 11.5" />
    </svg>
  );

  return (
    <div className="calm-enter mx-auto w-full max-w-5xl">
      {/* Title block — the NOW is the title (owner mock 04). No page
          H1 block, no marketing subline: eyebrow, the current stop as
          the large title, the until line when the stop carries an end
          time, then the status line (dot + word). */}
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">
        {preTrip
          ? `${activeDestinationLabel || t("ui.nav.trips")} · Starts ${companionStartLabel || "soon"}`
          : tripCompleted
            ? `${activeDestinationLabel || t("ui.nav.trips")} · Trip complete`
            : eyebrowDay
              ? `${activeDestinationLabel || t("ui.nav.trips")} · Day ${eyebrowDay.idx} of ${eyebrowDay.total}`
              : activeDestinationLabel || t("ui.nav.trips")}
      </p>
      <h1 className="mt-1.5 text-[34px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">
        {preTrip
          ? timingCopy(model.countdownMinutes, nextStart, timezone, locale)
          : tripCompleted
            ? "This trip is complete"
            : activityDisplayTitle(currentActivity, "Your next stop is not confirmed yet", activeDestinationLabel, suppressFlightFraming, originLabel || "")}
      </h1>
      {currentActivity && !preTrip && !tripCompleted && currentEndLabel ? (
        <p className="mt-[7px] text-[17px] font-semibold text-chead">
          Until {currentEndLabel}
          {nextActivity ? (
            <span className="font-normal text-cgray">
              {" "}· then {activityDisplayTitle(nextActivity, "", activeDestinationLabel, suppressFlightFraming, originLabel || "")}
            </span>
          ) : null}
        </p>
      ) : null}
      <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] font-normal text-cgray">
        <span
          aria-hidden
          className={classNames(
            "calm-dot h-2 w-2 rounded-full",
            model.activationStatus === "active" ? "bg-cgreen" : "bg-cgray2"
          )}
        />
        {statusLabel(model.activationStatus)}
        {permission === "granted" ? <span>· {gpsStatus.copy}</span> : null}
      </p>

      {/* Location state rows — same states, same actions as before,
          restated as quiet white cards under the status line. The grant
          ask itself still lives only in the Settings cascade. */}
      {preTrip ? (
        trackingEnabled ? (
          <div className="mt-3 rounded-[14px] bg-white px-4 py-3 shadow-calm">
            <p className="text-sm font-normal text-cink">
              Location on — Live Companion starts {companionStartLabel || "when your trip starts"}.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white px-4 py-3 shadow-calm">
            <p className="min-w-0 text-sm font-normal leading-6 text-cink">
              Location is off. Turn it on once — Live Companion will be ready when your trip starts.
            </p>
            <button
              type="button"
              onClick={() => enableLocation()}
              className="min-h-11 shrink-0 px-1 text-[15px] font-semibold text-cblue"
            >
              Turn on location
            </button>
          </div>
        )
      ) : tripWindowActive ? (
        !trackingEnabled ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white px-4 py-3 shadow-calm">
            <p className="min-w-0 text-sm font-normal leading-6 text-cink">
              Location is off — Live Companion can&apos;t follow along.
            </p>
            <button
              type="button"
              onClick={() => enableLocation()}
              className="min-h-11 shrink-0 px-1 text-[15px] font-semibold text-cblue"
            >
              Turn on location
            </button>
          </div>
        ) : permission === "denied" ? (
          <div className="mt-3 rounded-[14px] bg-white px-4 py-3 shadow-calm">
            <p className="text-sm font-normal leading-6 text-cink">
              Location is on, but your browser is blocking it. Allow location for Roamly in your browser settings, then return here.
            </p>
          </div>
        ) : permission !== "granted" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white px-4 py-3 shadow-calm">
            <p className="min-w-0 text-sm font-normal leading-6 text-cink">
              Location is on for this trip — this browser still needs to allow it.
            </p>
            <a
              href="/account#setup-step-3"
              className="inline-flex min-h-11 shrink-0 items-center px-1 text-[15px] font-semibold text-cblue"
            >
              Turn on in Settings
            </a>
          </div>
        ) : null
      ) : null}

      {/* Alerts — a trip-day surface only (feedAlerts is already
          window-gated above). One slim tint banner per alert, above
          the NOW card, exactly where mock 04 puts it. */}
      {feedAlerts.length || error || notice ? (
        <div className="mt-[15px] grid gap-2">
          {feedAlerts.slice(0, 2).map((alert) => (
            <p key={alert} className="calm-alert-in flex items-baseline gap-2 rounded-xl bg-cred/10 px-3.5 py-[11px] text-sm font-medium leading-[1.35] text-cink">
              <span aria-hidden className="shrink-0 font-bold text-cred">!</span>
              <span>{alert}</span>
            </p>
          ))}
          {error ? (
            <p role="alert" className="calm-alert-in flex items-baseline gap-2 rounded-xl bg-cred/10 px-3.5 py-[11px] text-sm font-semibold leading-[1.35] text-cred">
              <span aria-hidden className="shrink-0 font-bold">!</span>
              <span>{error}</span>
            </p>
          ) : null}
          {notice ? (
            <p role="status" aria-live="polite" className="calm-alert-in rounded-xl bg-cblue/10 px-3.5 py-[11px] text-sm font-medium leading-[1.35] text-cink">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* NOW — one white grouped card. Address row with the route as
          its right value, the description under a hairline, Timing as
          a hairline row. No nested tiles. */}
      <p className="mx-4 mb-[7px] mt-[17px] text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">
        {preTrip ? "Get ready" : tripCompleted ? "Completed" : t("ui.status.now", "Now")}
      </p>
      <section className="rounded-[14px] bg-white shadow-calm">
        <div className="flex min-h-11 items-center gap-2.5 px-4 py-2.5">
          <span className="min-w-0 text-[17px] font-normal text-cink">{displayedAddress}</span>
          {model.route.status === "verified" ? (
            <span className="ml-auto shrink-0 text-[17px] font-normal text-cgray">{routeBusy ? "Checking" : routeCopy(model.route)}</span>
          ) : null}
        </div>
        <div className="border-t border-chair px-4 py-[11px]">
          <p className="text-[15px] font-normal leading-[1.4] text-cink">
            {preTrip
              ? "This trip has not started. Review the plan and confirm anything still suggested."
              : tripCompleted
                ? "Live Companion does not start again after the trip ends. The saved plan stays here to review."
                : activityDisplayDescription(currentActivity, model.activationReason)}
          </p>
          {nextActivity?.openingHours ? (
            <p className="mt-1.5 text-[13px] font-normal text-cgray">{t("ui.status.hours")}: {nextActivity.openingHours}</p>
          ) : null}
        </div>
        {!preTrip ? (
          <div className="flex min-h-11 items-center gap-2.5 border-t border-chair px-4 py-2.5">
            <span className="shrink-0 text-[17px] font-normal text-cink">Timing</span>
            <span className="ml-auto min-w-0 text-right">
              <span className="block text-[17px] font-normal text-cgray">{timingCopy(model.countdownMinutes, nextStart, timezone, locale)}</span>
              {model.route.status === "verified" ? (
                <span className="mt-0.5 block text-[13px] font-normal text-cgray2">{routeBusy ? "Checking travel time" : `${routeCopy(model.route)} from your location`}</span>
              ) : nextActivity ? (
                <span className="mt-0.5 block text-[13px] font-normal text-cgray2">Travel time from your location is still uncertain</span>
              ) : null}
            </span>
          </div>
        ) : null}
        {nextActivity?.booking?.reference || nextActivity?.booking?.provider || nextActivity?.booking?.gate || nextActivity?.booking?.terminal ? (
          <details className="border-t border-chair px-4 py-[11px]">
            <summary className="cursor-pointer text-[15px] font-semibold text-chead">{t("ui.status.details")}</summary>
            <div className="mt-2 grid gap-1.5">
              {[
                [t("ui.status.provider"), nextActivity.booking?.provider],
                [t("ui.status.reference"), nextActivity.booking?.reference],
                [t("ui.status.terminal"), nextActivity.booking?.terminal],
                [t("ui.booking.gate"), nextActivity.booking?.gate]
              ]
                .filter((row): row is [string, string] => Boolean(row[1]))
                .map(([label, value]) => (
                  <p key={label} className="flex items-baseline justify-between gap-3 text-[15px] font-normal text-cink">
                    <span className="text-cgray">{label}</span>
                    <span className="text-right">{value}</span>
                  </p>
                ))}
            </div>
          </details>
        ) : null}
      </section>

      {/* Check In — the one filled action, full width under the NOW
          card (mock 04). Complete / Skip keep their handlers as quiet
          hairline rows beneath it. */}
      {currentActivity && !tripCompleted ? (
        <>
          <button
            type="button"
            onClick={() => void runAction(currentActivity.id, "check-in", location)}
            disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(String(currentActivity.status))}
            className="mt-3 min-h-[50px] w-full rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white disabled:opacity-45"
          >
            {t("ui.actions.checkIn")}
          </button>
          <section className="mt-3 divide-y divide-chair rounded-[14px] bg-white shadow-calm">
            <button
              type="button"
              onClick={() => void runAction(currentActivity.id, "complete")}
              disabled={Boolean(busy) || ["completed", "skipped"].includes(String(currentActivity.status))}
              className="flex min-h-11 w-full items-center px-4 py-2.5 text-left text-[17px] font-normal text-cink disabled:opacity-45"
            >
              Complete
            </button>
            <button
              type="button"
              onClick={() => void runAction(currentActivity.id, "skip")}
              disabled={Boolean(busy) || ["completed", "skipped"].includes(String(currentActivity.status))}
              className="flex min-h-11 w-full items-center px-4 py-2.5 text-left text-[17px] font-normal text-cink disabled:opacity-45"
            >
              Skip this activity
            </button>
          </section>
          <p className="mt-2 px-4 text-[13px] font-normal leading-[1.4] text-cgray">Skip or complete this stop. The rest of today keeps its scheduled times.</p>
        </>
      ) : null}

      {/* UP NEXT — hairline list rows (title + right-aligned gray
          time). The Directions row is the card's last row: ONE row,
          the traveler's links behind it. */}
      {upcomingToday.length || hasDirectionLinks ? (
        <>
          <p className="mx-4 mb-[7px] mt-[17px] text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Up Next</p>
          <section id="live-directions" className="scroll-mt-24 divide-y divide-chair rounded-[14px] bg-white shadow-calm">
            {upcomingToday.map((activity) => {
              const start = activityStartDate({ activity, tripStartDate: activeTripStartDate, timezone });
              return (
                <div key={activity.id} className="flex min-h-11 items-center gap-2.5 px-4 py-2.5">
                  <span className="min-w-0 truncate text-[17px] font-normal text-cink">
                    {timelineRowTitle(activity, displayedNextTitle, activeDestinationLabel, suppressFlightFraming, originLabel || "")}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-[5px] text-[17px] font-normal text-cgray">
                    {activity.id === nextActivity?.id && nextTimingStatus === "PLANNED" ? "Planned · " : ""}
                    {start ? formatClock(start.toISOString(), timezone, locale) : activity.timeLabel || ""}
                    {rowChevron}
                  </span>
                </div>
              );
            })}
            {hasDirectionLinks && directionsHref ? (
              <a href={directionsHref} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2.5 px-4 py-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-cblue">
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3.5 11.5 11.5 3.5M5 3.5h6.5V10" />
                  </svg>
                </span>
                <span className="text-[17px] font-normal text-cink">Directions</span>
                <span className="ml-auto flex shrink-0 items-center gap-[5px] text-[17px] font-normal text-cgray">
                  {model.route.status === "verified" ? routeCopy(model.route) : ""}
                  {rowChevron}
                </span>
              </a>
            ) : null}
          </section>
        </>
      ) : null}

      {/* Controls — quiet Settings-style rows in one grouped card
          (mock 04). Pause/Resume is one state row; Essentials keeps
          its checklist behind the count row. The mock's "End Day
          Early" row has no behavior anywhere in the app — it is not
          rendered rather than invented (see TRUTH-LIST). */}
      {!tripCompleted ? (
        <section className="mt-[17px] divide-y divide-chair rounded-[14px] bg-white shadow-calm">
          <button
            type="button"
            onClick={() => void (paused ? resumeCompanion() : pauseCompanion())}
            className="flex min-h-11 w-full items-center px-4 py-2.5 text-left text-[17px] font-normal text-cink"
          >
            {paused ? "Resume Companion" : "Pause Companion"}
          </button>
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 py-2.5 text-[17px] font-normal text-cink [&::-webkit-details-marker]:hidden">
              Essentials
              <span className="ml-auto flex shrink-0 items-center gap-[5px] text-[17px] font-normal text-cgray">
                {essentialsDone} of {checklist.length}
                {rowChevron}
              </span>
            </summary>
            <div className="border-t border-chair px-4 py-3">
              <div className="grid gap-2">
                {checklist.slice(0, 5).map((item) => (
                  <p key={item.id} className="text-sm font-normal text-cink">
                    {item.is_done ? "Done: " : ""}{item.item}
                  </p>
                ))}
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {showSetupCard ? (
      <section className="mt-5 rounded-[14px] bg-white p-4 shadow-calm">
        <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">{fieldTestMode ? t("ui.status.ready") : t("ui.status.liveCompanion")}</p>
        {!mobileRuntime ? (
          <div className="mt-3 rounded-xl bg-cbg p-4">
            <h3 className="text-[17px] font-semibold text-chead">Continue on your phone</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">Live Companion runs on your phone. Scan the code with your phone&apos;s camera to open this trip there.</p>
            {liveTripUrl ? (
              <div className="mt-4 flex flex-col items-center">
                <div className="rounded-xl bg-white p-3 shadow-calm">
                  <QRCodeSVG value={liveTripUrl} size={168} />
                </div>
                <div className="mt-4 grid w-full gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void copyTripLink()}
                    className="min-h-12 rounded-xl border border-chair bg-white px-4 py-3 text-sm font-semibold text-chead"
                  >
                    {tripLinkCopied ? "Link copied ✓" : "Copy trip link"}
                  </button>
                  {canNativeShare ? (
                    <button
                      type="button"
                      onClick={() => void shareTripLink()}
                      className="min-h-12 rounded-xl bg-cblue px-4 py-3 text-sm font-semibold text-white"
                    >
                      Send to my phone
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : !isStandalone ? (
          <div className="mt-3 rounded-xl bg-cbg p-4">
            <h3 className="text-[17px] font-semibold text-chead">Roamly reaches you through the app</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">
              Without the app, Roamly can&apos;t reach you in the moment — this trip still follows its
              schedule here. Adding the app is step 2 of setup, done once, in Settings.
            </p>
            <a
              href="/account#setup-step-2"
              className="mt-3 flex min-h-[50px] w-full items-center justify-center rounded-xl bg-cblue px-5 text-[15px] font-semibold text-white"
            >
              Finish setup in Settings
            </a>
          </div>
        ) : fieldTestMode && notificationPermission === "default" ? (
          <div className="mt-3 rounded-xl bg-amber-200/15 p-4">
            <h3 className="text-xl font-semibold text-amber-900">Notifications need your permission</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">Allow notifications so this phone can receive the field-test alert.</p>
            <button type="button" onClick={() => void enableFieldTestNotifications()} disabled={busy === "notifications"} className="mt-4 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-chead disabled:opacity-50">
              {busy === "notifications" ? "Enabling…" : "Enable notifications"}
            </button>
          </div>
        ) : fieldTestMode && notificationPermission === "denied" ? (
          <div className="mt-3 rounded-xl bg-coral/20 p-4">
            <h3 className="text-xl font-semibold text-coral">Notifications are blocked</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">In iPhone Settings, allow notifications for Roamly, then return to this field test. Roamly will not ask again here.</p>
          </div>
        ) : fieldTestMode && notificationPermission === "granted" && !pushReady ? (
          <div className="mt-3 rounded-xl bg-amber-200/15 p-4">
            <h3 className="text-xl font-semibold text-amber-900">Register this phone</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">Permission is granted, but the phone is not registered with Roamly yet.</p>
            <button type="button" onClick={() => void enableFieldTestNotifications()} disabled={busy === "notifications"} className="mt-4 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-chead disabled:opacity-50">
              {busy === "notifications" ? "Registering…" : "Retry registration"}
            </button>
          </div>
        ) : fieldTestMode && pushReady && !setupComplete ? (
          <div className="mt-3 rounded-xl bg-ocean/20 p-4">
            <h3 className="text-xl font-semibold text-chead">Notifications ready</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">This phone is registered. Continue with location setup for the field test.</p>
            {!watching ? (
              <button type="button" onClick={() => void setupLiveCompanion()} disabled={Boolean(busy) || paused || companionEnabled === false} className="mt-4 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-chead disabled:opacity-50">
                {busy === "setup" ? "Setting up…" : permission !== "granted" ? "Allow location" : "Open Live Companion"}
              </button>
            ) : null}
          </div>
        ) : fieldTestMode && setupComplete ? (
          <div className="mt-3 rounded-xl bg-ocean/20 p-4">
            <h3 className="text-xl font-semibold text-chead">{fieldTestMode ? "Notifications ready" : "Live Companion is on"}</h3>
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">Roamly will help you stay on track during your trip.</p>
          </div>
        ) : tripCompleted ? (
          <p className="mt-3 text-sm font-normal leading-[1.45] text-cink">This trip is complete. Live Companion stays off.</p>
        ) : fieldTestMode && !watching ? (
          <>
            <div className="mt-3 grid gap-2 text-sm font-semibold text-cink">
              <p>{fieldTestMode ? "Step 2 — Notifications" : "Step 1 — Notifications"} <span className="float-right font-normal text-cgray">{pushReady ? (fieldTestMode ? "✓" : "Ready") : fieldTestMode ? "Needs attention" : "Next"}</span></p>
              <p>{fieldTestMode ? "Step 3 — Location" : "Step 2 — Location"} <span className="float-right font-normal text-cgray">{trackingEnabled || permission === "granted" ? (fieldTestMode ? "✓" : "Ready") : fieldTestMode ? "Needs attention" : "Next"}</span></p>
              <p>{fieldTestMode ? "Step 4 — Ready" : "Step 3 — Ready"}</p>
            </div>
            <button type="button" onClick={() => void setupLiveCompanion()} disabled={Boolean(busy) || paused || companionEnabled === false} className="mt-4 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-chead disabled:opacity-50">
              {busy === "setup" ? "Setting up…" : fieldTestMode ? permission !== "granted" ? "Allow location" : "Open Live Companion" : "Continue setup"}
            </button>
          </>
        ) : setupGap ? (
          <p className="mt-3 text-sm font-normal leading-[1.45] text-cink">
            {setupGap.copy}{" "}
            <a href={setupGap.href} className="font-semibold text-cblue">
              Finish setup in Settings
            </a>
          </p>
        ) : null}
        {fieldTestMode ? (
        <p className="mt-2 text-xs font-normal leading-5 text-cgray">
          {watching ? "Live Companion is active while Roamly is open." : notificationPermission === "denied" ? "Notifications are blocked. Allow them for Roamly in your phone settings, then return here." : !pushReady ? "Roamly will register this phone for OS notifications." : permission === "denied" ? "Location is blocked. In your phone settings, allow location for Roamly, then return here." : backgroundLocationEnabled ? "Location access is ready for Live while Roamly is open." : permission === "granted" ? "Location is ready. Continue to turn on Live Companion." : trackingEnabled ? "Location is on — Live Companion will follow along while Roamly is open." : "Your choices are saved to your account when you continue."}
        </p>
        ) : null}
      </section>
      ) : null}

      {liveDemoEnabled ? (
        <section className="mt-5 rounded-2xl border border-amber-200/30 bg-amber-200/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/80">Live Demo</p>
              <p className="mt-1 text-sm font-black text-white">{demoState ? "Active" : "Ready"}</p>
            </div>
            <button
              type="button"
              onClick={() => (demoState ? stopLiveDemo() : void startLiveDemo())}
              disabled={Boolean(demoBusy)}
              className={classNames(
                "min-h-11 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50",
                demoState ? "border border-cloud bg-white text-ink" : "bg-amber-300 text-ink"
              )}
            >
              {demoBusy ? "Starting" : demoState ? "STOP LIVE DEMO" : "START LIVE DEMO"}
            </button>
          </div>

          {demoState ? (
            <div className="mt-3 grid gap-2">
              {demoRows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 rounded-xl border border-chair bg-white px-3 py-2">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-cgray">{label}</p>
                  <p className="min-w-0 break-words text-xs font-semibold text-cink">{value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {demoNotice ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-black leading-5 text-amber-900">{demoNotice}</p> : null}
          {demoError ? <p className="mt-3 rounded-xl bg-coral/10 px-3 py-2 text-xs font-black leading-5 text-coral">{demoError}</p> : null}
        </section>
      ) : null}

      <p className="mt-[13px] text-center text-[13px] font-normal text-cgray">
        Roamly is following along — it speaks up only when it matters.
      </p>

      <section
        className={deepLinkedActivityId ? "grid scroll-mt-24 gap-3" : "hidden"}
        aria-hidden={deepLinkedActivityId ? undefined : "true"}
      >
        {(deepLinkedActivityId
          ? liveActivities.filter((activity) => activity.id === deepLinkedActivityId)
          : liveActivities.slice(0, 6)
        ).map((activity) => (
          <article
            key={activity.id}
            id={`live-activity-${activity.id}`}
            tabIndex={deepLinkedActivityId === activity.id ? -1 : undefined}
            className={classNames(
              "rounded-[14px] border bg-white p-4 shadow-calm transition-shadow",
              deepLinkedActivityId === activity.id
                ? "border-cblue/40 bg-cblue/5 shadow-[0_0_0_3px_rgba(0,122,255,0.15)]"
                : activity.id === currentActivity?.id ? "border-cblue/40" : "border-chair"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-cgray">
                  {activity.timeLabel || "Flexible"} · {activity.id === currentActivity?.id ? "Now" : activity.id === nextActivity?.id ? "Next" : activity.status || "Planned"}
                </p>
                <h3 className="mt-1 text-[17px] font-semibold text-chead">{timelineRowTitle(activity, displayedNextTitle, activeDestinationLabel, suppressFlightFraming, originLabel || "")}</h3>
                <p className="mt-1 line-clamp-2 text-sm font-normal leading-[1.45] text-cink">{activity.shortDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => void runAction(activity.id, "check-in")}
                disabled={Boolean(busy) || activity.id !== actionableActivityId || ["checked_in", "completed", "skipped"].includes(String(activity.status))}
                className="min-h-11 shrink-0 rounded-xl bg-cblue px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
              >
                {t("ui.actions.checkIn")}
              </button>
            </div>
            <details className="mt-3 rounded-xl bg-cbg px-3 py-3">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.06em] text-cgray">More</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void runAction(activity.id, "complete")}
                  disabled={Boolean(busy) || activity.id !== actionableActivityId || ["completed", "skipped"].includes(String(activity.status))}
                  className="min-h-11 rounded-xl bg-cblue px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                >
                  {t("ui.actions.markDone")}
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(activity.id, "skip")}
                  disabled={Boolean(busy) || activity.id !== actionableActivityId || ["completed", "skipped"].includes(String(activity.status))}
                  className="min-h-11 rounded-xl border border-chair bg-white px-3 py-2 text-xs font-semibold text-cink disabled:opacity-45"
                >
                  {t("ui.actions.skip")}
                </button>
              </div>
            </details>
          </article>
        ))}
      </section>

      {canSimulateLocation ? (
        <details className="rounded-[14px] border border-chair bg-white p-4 shadow-calm">
          <summary className="cursor-pointer text-sm font-semibold text-chead">Tester location tools</summary>
          <div className="mt-4 grid gap-3">
            <select
              value={selectedPlaceId}
              onChange={(event) => setSelectedPlaceId(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-chair bg-white px-3 py-2 text-sm font-semibold text-chead"
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
                  className="min-h-11 rounded-xl border border-chair bg-cbg px-3 py-2 text-xs font-semibold text-chead disabled:opacity-60"
                >
                  {qaBusy === action.label ? "Running" : action.label}
                </button>
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
