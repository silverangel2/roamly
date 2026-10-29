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
import { cleanTravelerTimeLabel, confirmableStopTitle, isHollowTravelerPlace, looksLikeProviderSearchTitle, presentTravelerTitle, repairGarbledGettingTo, shouldSuppressFlightFraming } from "@/lib/roamly/itineraryPresentation";
import { evaluateLocationEvidence } from "@/lib/roamly/locationEvidence";
import { LocationPermissionRecovery } from "@/components/roamly/LocationPermissionRecovery";
import { TimeProvenanceLabel } from "@/components/roamly/TimeProvenanceLabel";
import { hasVerifiedLiveEvidence, isFreshEvidenceTimestamp, provenanceForLiveDayRow, provenanceForPreTripRow } from "@/lib/roamly/timeProvenance";
import { DirectionsPanel } from "@/components/trip/DirectionsPanel";
import { VenueThumb } from "@/components/roamly/VenueThumb";
import { venuePhotoForTitle, type VenuePhotoMap } from "@/lib/roamly/venuePhotos";

/** Timeline-row thumbnail: renders only when the map holds a photo. */
function LiveRowThumb({ venuePhotos, title }: { venuePhotos?: VenuePhotoMap; title: string }) {
  const thumb = venuePhotoForTitle(venuePhotos, title);
  if (!thumb) return null;
  return <VenueThumb photo={thumb} title={title} />;
}
import { formatTripDateRange, tripClockState, tripDayDateLabel } from "@/lib/roamly/tripClock";
import { UNKNOWN_TZ_LABEL } from "@/lib/roamly/tripTimezone";
import type { DayTimelineRow } from "@/lib/roamly/liveDayTimeline";
import { TripHeroCard, type TripHeroPhoto } from "@/components/roamly/TripHeroCard";
import { DESIGN_TOKENS } from "@/lib/roamly/designTokens";
import { buildAppleMapsUrl, buildGoogleMapsUrl } from "@/lib/roamly/navigationLinks";

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
  /**
   * Timezone round (2026-10-26): true when the page could not resolve
   * the trip's zone from metadata or the destination registry. The
   * client then renders UNKNOWN_TZ_LABEL under the hero instead of
   * silently showing UTC days.
   */
  timezoneUnknown?: boolean;
  companionEnabled?: boolean;
  companionPausedUntil?: string | null;
  backgroundLocationEnabled?: boolean;
  initialPermissionState?: LiveLocationPermission;
  initialTrackingEnabled?: boolean;
  initialLocation?: LiveCoordinates | null;
  bookingDetails?: LiveCompanionBookingDetail[];
  liveDemoEnabled?: boolean;
  fieldTestMode?: boolean;
  /** Round 2 hero photo (real destination-photo pipeline; null → bare header). */
  heroPhoto?: TripHeroPhoto | null;
  /** Round 2 pre-trip Day timeline rows, built server-side from the stored plan. */
  dayTimelineRows?: DayTimelineRow[];
  /** Round 2 Full Itinerary tab: all days' stops (title/time/status only).
   *  Correction phase (D5/D6): activities also carry the itinerary's
   *  map query + coordinates when present, so the Map tab can fall back
   *  to itinerary links when no live-activity link exists. */
  itineraryDays?: Array<{
    dayNumber: number;
    dateLabel: string | null;
    activities: Array<{ title: string; timeLabel: string | null; status: string | null; mapQuery?: string | null; latitude?: number | null; longitude?: number | null }>;
  }>;
  /** Stored day title for the pre-trip Day heading (e.g. "Plan for arrival and first exploration"). */
  dayPlanTitle?: string | null;
  /** Pipeline thumbnails for venue rows, keyed by normalized title. */
  venuePhotos?: VenuePhotoMap;
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

// Round 2: the old local timingCopy/formatShortDay countdown formatter is
// replaced by lib/roamly/liveTimingDisplay.ts (timingDisplay), which labels
// the countdown by its basis and separates it from travel time. Keeping two
// countdown formatters would let them drift apart again.

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

/** Owner-10 item 5 — the same title-echo rule as
 *  itineraryHome.stripTitleEcho, for in-progress activity
 *  descriptions ("{title} — planned for day N of this trip."). */
function stripLiveTitleEcho(title: string, detail: string): string {
  const text = (detail || "").trim();
  if (!text) return "";
  const plain = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (plain(text) === plain(title)) return "";
  let out = text;
  const rawTitle = (title || "").trim();
  if (rawTitle && text.toLowerCase().startsWith(rawTitle.toLowerCase())) {
    out = text.slice(rawTitle.length);
  } else if (rawTitle && plain(text).startsWith(plain(rawTitle))) {
    const dash = text.search(/[—–-]/);
    if (dash !== -1) out = text.slice(dash + 1);
  } else {
    return text;
  }
  out = out.trim().replace(/^[—–-]\s*/, "").trim();
  if (/^planned for day \d+ of this trip\.?$/i.test(out)) return "";
  return out;
}

/** Owner-10 item 5 — bare-acronym title + no real description. */
function isUnverifiedLiveStop(title: string, strippedDetail: string): boolean {
  return /^[A-Z0-9]{2,4}$/.test((title || "").trim()) && !strippedDetail.trim();
}

/** Walk/transfer legs: they are movements between stops, not
 *  activities — the compact upcoming list (owner-10 item 6) shows
 *  activities only; the live engine's own current item is still
 *  featured above the list whatever it is. */
function isWalkLiveActivity(activity: LiveCompanionActivity): boolean {
  const title = (activity.title || "").toLowerCase();
  const category = (activity.category || "").toLowerCase();
  if (/\b(transfer|transit)\b/.test(category)) return true;
  return /^(walk|transfer|transit|getting|travel|drive|take|go|ride|fly)\b/.test(title);
}

function activityDisplayDescription(activity: LiveCompanionActivity | null, fallback: string) {
  if (!activity?.shortDescription) return fallback;
  const stripped = stripLiveTitleEcho(activity.title || "", activity.shortDescription);
  if (!stripped) return fallback;
  return isUsablePlaceLabel(stripped) && !looksLikeProviderSearchTitle(stripped)
    ? stripped
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
  timezoneUnknown = false,
  companionEnabled = true,
  companionPausedUntil = null,
  backgroundLocationEnabled = false,
  initialPermissionState = "prompt",
  initialTrackingEnabled = false,
  initialLocation = null,
  bookingDetails = [],
  liveDemoEnabled = false,
  fieldTestMode = false,
  heroPhoto = null,
  dayTimelineRows = [],
  itineraryDays = [],
  dayPlanTitle = null,
  venuePhotos
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
  // Round 2 panel tabs (composite structure): Today / Full Itinerary /
  // Map / Essentials. Tab state is client-only; every panel's data is
  // the real trip data passed in as props.
  const [liveTab, setLiveTab] = useState<"today" | "itinerary" | "map" | "essentials">("today");
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
  // Round 2 panel 7 (DIRECTIONS): additive-only toggle for the
  // "Getting to your next stop" panel below the Up Next card. The
  // existing Directions link row is untouched.
  const [showDirectionsPanel, setShowDirectionsPanel] = useState(false);
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
  const mapsHref = useMemo(() => {
    const mapsTarget = currentActivity || nextActivity;
    return googleMapsUrlForActivity(mapsTarget, directionMode);
  }, [currentActivity, nextActivity, directionMode]);
  const directionLinks: LiveDirectionLinks = useMemo(
    () => directionLinksForActivity(currentActivity || nextActivity, directionMode),
    [currentActivity, nextActivity, directionMode]
  );
  const hasDirectionLinks = Boolean(directionLinks.google || directionLinks.apple || directionLinks.citymapper);
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

  // Round 2, CRITICAL 1 — Live side of the one evidence rule. A stored
  // "nearby" status is a past GPS mint, not current proof: it renders
  // as "nearby" only when fresh coordinates (live GPS or the persisted
  // fix, re-checked here) place the traveler within radius of THAT
  // activity on an active trip. Otherwise it reads "Planned" — the same
  // downgrade the Alerts timeline applies, through the same function.
  const displayStatusFor = (activity: {
    status?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number | null;
  }) => {
    if (activity.status !== "nearby") return activity.status || "Planned";
    const verified = evaluateLocationEvidence({
      tripActive: tripWindowActive,
      travelerLatitude: usableLocation?.latitude ?? null,
      travelerLongitude: usableLocation?.longitude ?? null,
      travelerObservedAt: usableLocation?.capturedAt ?? null,
      destinationLatitude: activity.latitude ?? null,
      destinationLongitude: activity.longitude ?? null,
      radiusMeters: activity.radiusMeters ?? null,
      now: nowTick.getTime()
    }).verified;
    return verified ? "nearby" : "Planned";
  };

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

  // Round 2 permission recovery: re-querying the Permissions API never
  // prompts, so it is safe after a denial — if the traveler has since
  // allowed Roamly in device/browser settings, this picks it up and
  // starts sensing; if still denied, state stays denied and the steps
  // stay on screen. It never attempts to bypass browser security.
  const recheckLocationPermission = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    try {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      setPermission(status.state as LiveLocationPermission);
      if (status.state === "granted") enableLocation();
    } catch {
      // Permissions API unavailable here: leave state untouched.
    }
  }, [enableLocation]);

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

  // Picture 4: the Pause/Resume control lived here and is removed with
  // its button (see the Today-tab removals). Pausing remains a
  // companion-preference write (PUT /api/trips/[id]/companion/preferences)
  // owned by Settings, not by this screen — no dead handler is kept
  // here to imply a control that does not exist.
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
  // Row-title fallback for the timeline: the next stop's traveler title
  // is borrowed only when a row is still the generic "Trip · city" label
  // (timelineRowTitle's own rule).
  const nextRowTitle = activityDisplayTitle(nextActivity, "", activeDestinationLabel, suppressFlightFraming, originLabel || "");
  // Acceptance-review round (2026-10-28), DISPLAY ONLY: the embedded
  // directions panel previously rendered the next stop's raw title
  // even when the timeline row itself flagged it "Unverified stop"
  // — same gap as the standalone screen. Same rule as the timeline
  // rows (bare-acronym title + no real description after echo strip).
  const nextUnverified = nextActivity
    ? isUnverifiedLiveStop(nextActivity.title || "", stripLiveTitleEcho(nextActivity.title || "", nextActivity.shortDescription || ""))
    : false;

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
  // Repair round item 1 — THE EVIDENCE GATE for in-progress times.
  // Today's times are recomputed for today from the live activity
  // records, so on their own they are Estimated, never Live-updated.
  // Live-updated requires verified live evidence inside the 10-minute
  // freshness window: a fresh location fix (usableLocation is null
  // unless the fix is fresh) or a fresh verified check-in event
  // (checked_in with a fresh checked_in_at). Location unavailable and
  // no fresh check-in — the tester renders' state — means every
  // recomputed time reads Estimated. A stale check-in falls back the
  // same way; it is never presented as current.
  const verifiedLiveEvidence = hasVerifiedLiveEvidence({
    freshLocationFix: usableLocation != null,
    freshCheckIn: items.some(
      (item) => item.status === "checked_in" && isFreshEvidenceTimestamp(item.checked_in_at ?? null, nowTick.getTime())
    )
  });
  const liveDayProvenanceFor = (activity: { booking?: { status?: string | null } | null; timing_status?: string | null }) =>
    provenanceForLiveDayRow({
      bookingVerified: activity.booking?.status === "verified" || activity.timing_status === "FACTUAL",
      verifiedLiveEvidence
    });
  // Picture 4 in-progress timeline: today's remaining stops, in the
  // same chronological sort as todayActivities. The first remaining
  // stop carries the UP NEXT pill; the current stop carries NOW.
  const remainingToday = todayActivities.filter(
    (activity) =>
      activity.id !== currentActivity?.id &&
      !["completed", "skipped", "checked_in", "missed"].includes(String(activity.status))
  );
  // Owner-10 item 6 — Live simplification. The Today tab shows ONE
  // featured card (the current stop, else the first remaining stop)
  // + a compact upcoming list (remaining activities, walk legs
  // excluded — they are movements, not activities). The live
  // engine's data is untouched; only this tab's presentation
  // changes, and the full list still lives on the Full Itinerary tab.
  const featuredActivity = currentActivity ?? remainingToday[0] ?? null;
  const upcomingActivities = todayActivities.filter(
    (activity) => activity.id !== featuredActivity?.id && !isWalkLiveActivity(activity)
  );
  const featuredStart = featuredActivity
    ? activityStartDate({ activity: featuredActivity, tripStartDate: activeTripStartDate, timezone })
    : null;
  const featuredTimeLabel = featuredActivity
    ? featuredStart
      ? formatClock(featuredStart.toISOString(), timezone, locale)
      : featuredActivity.timeLabel || ""
    : "";
  const featuredRawTitle = featuredActivity
    ? timelineRowTitle(featuredActivity, nextRowTitle, activeDestinationLabel, suppressFlightFraming, originLabel || "")
    : "";
  const featuredStripped = featuredActivity
    ? stripLiveTitleEcho(featuredRawTitle, featuredActivity.shortDescription || "")
    : "";
  const featuredUnverified = featuredActivity ? isUnverifiedLiveStop(featuredRawTitle, featuredStripped) : false;
  const featuredPill = !featuredActivity
    ? null
    : featuredActivity.id === currentActivity?.id
      ? "Now"
      : featuredActivity.id === remainingToday[0]?.id
        ? "Up next"
        : null;
  const directionsHref = (() => {
    const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (isIOS && directionLinks.apple) return directionLinks.apple;
    return directionLinks.google || directionLinks.apple || directionLinks.citymapper || null;
  })();
  // Correction phase (D6, 2026-10-28): the Map tab claimed "Maps links
  // are not available" while the Itinerary Map provided links for the
  // same stops — live links derive from tracked activities, itinerary
  // links from the itinerary. When no live link exists, fall back to
  // the current day's first itinerary stop (its map query, or its
  // coordinates when the stop carries verified ones; name-only when
  // coordinates are absent — never a claimed accuracy).
  const fallbackMapStop = (() => {
    if (directionsHref || mapsHref) return null;
    const day = itineraryDays.find((entry) => entry.dayNumber === eyebrowDay?.idx) || itineraryDays[0];
    const first = day?.activities?.[0];
    if (!first || !(first.mapQuery || first.title)) return null;
    return first;
  })();
  const fallbackGoogleHref = fallbackMapStop
    ? buildGoogleMapsUrl({ label: fallbackMapStop.mapQuery || fallbackMapStop.title, latitude: fallbackMapStop.latitude ?? null, longitude: fallbackMapStop.longitude ?? null })
    : "";
  const fallbackAppleHref = fallbackMapStop
    ? buildAppleMapsUrl({ label: fallbackMapStop.mapQuery || fallbackMapStop.title, latitude: fallbackMapStop.latitude ?? null, longitude: fallbackMapStop.longitude ?? null })
    : "";
  const mapDirectionsHref = directionsHref || fallbackGoogleHref || null;
  const mapMapsHref = mapsHref || fallbackAppleHref || fallbackGoogleHref || null;
  const essentialsDone = checklist.filter((item) => item.is_done).length;
  const rowChevron = (
    <svg width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="#B7C1D2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M1.5 1.5 6.5 6.5 1.5 11.5" />
    </svg>
  );

  // Picture 4 timeline icon: a colored circle + line glyph from the
  // row's own kind/category/mode/title — never a photo (no
  // per-activity photo source exists) and never a guessed place type:
  // unknown rows get the neutral pin. Travel legs use the plane only
  // for flight legs; other legs get the directions arrow.
  const timelineIcon = (input: { kind: "travel" | "stop"; title?: string | null; category?: string | null; mode?: string | null }) => {
    const strokeProps = {
      width: 20,
      height: 20,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "#fff",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    } as const;
    const text = `${input.title || ""} ${input.category || ""} ${input.mode || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (input.kind === "travel") {
      if (/flight|fly|plane|airport/.test(text)) {
        return {
          bg: DESIGN_TOKENS.color.primary,
          glyph: (
            <svg {...strokeProps}>
              <path d="M21 3 10 14M21 3l-6.5 18-4-9.5L2 8l19-5z" />
            </svg>
          )
        };
      }
      return {
        bg: DESIGN_TOKENS.color.primary,
        glyph: (
          <svg {...strokeProps}>
            <path d="M3.5 20.5 20.5 3.5M8 3.5h12.5V16" />
          </svg>
        )
      };
    }
    if (/hotel|lodging|arrival|stay|check.?in/.test(text)) {
      return {
        bg: DESIGN_TOKENS.color.success,
        glyph: (
          <svg {...strokeProps}>
            <path d="M3 20V10M8 20V10M13 20V10M18 20V10M2 10l9-6 9 6M3 20h18" />
          </svg>
        )
      };
    }
    if (/museum|market|historic|landmark|culture/.test(text)) {
      return {
        bg: DESIGN_TOKENS.color.activityOrange,
        glyph: (
          <svg {...strokeProps}>
            <path d="M3 20V10M8 20V10M13 20V10M18 20V10M2 10l9-6 9 6M3 20h18" />
          </svg>
        )
      };
    }
    if (/galler|art|exhibit/.test(text)) {
      return {
        bg: DESIGN_TOKENS.color.activityPurple,
        glyph: (
          <svg {...strokeProps}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 17l5-5 4 4 3-3 6 6" />
          </svg>
        )
      };
    }
    // Theatre before food: "theatre" contains "eat", so the food
    // branch would swallow every theatre stop if it ran first.
    if (/theatr|show|concert|performance|evening/.test(text)) {
      return {
        bg: DESIGN_TOKENS.color.primary,
        glyph: (
          <svg {...strokeProps}>
            <path d="M12 3l2.2 5.2 5.6.5-4.2 3.7 1.3 5.6L12 15.2 7.1 18l1.3-5.6L4.2 8.7l5.6-.5L12 3z" />
          </svg>
        )
      };
    }
    if (/restaurant|food|dining|cafe|eat|veg|bistro/.test(text)) {
      return {
        bg: DESIGN_TOKENS.color.activityOrange,
        glyph: (
          <svg {...strokeProps}>
            <path d="M6 3v7M10 3v7M6 5.5h4M6 10v11M17 3v6c0 3-3.5 3-3.5 0V3" />
          </svg>
        )
      };
    }
    return {
      bg: DESIGN_TOKENS.color.primary,
      glyph: (
        <svg {...strokeProps}>
          <path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z" />
          <circle cx="12" cy="11" r="2" />
        </svg>
      )
    };
  };

  return (
    <div className="calm-enter mx-auto w-full max-w-5xl">
      {/* Round 2 panel header (composite structure, real data): page
          title row, photo hero with the trip-state badge computed from
          the same clock as the Today tab, then the four tabs. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <a href={`/trip/${tripId}`} className="inline-flex min-h-11 items-center px-1 text-[22px] font-bold text-chead" aria-label="Back to trip">
          ‹
        </a>
        <h1 className="text-[20px] font-bold tracking-[-0.018em] text-chead">Live Companion</h1>
        <a href="/account" className="inline-flex min-h-11 items-center px-1 text-[15px] font-semibold text-cblue" aria-label="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
      </div>
      <TripHeroCard
        destination={activeDestinationLabel || t("ui.nav.trips")}
        dateLine={formatTripDateRange(activeTripStartDate, activeTripEndDate)}
        dayLine={eyebrowDay ? `Day ${eyebrowDay.idx} of ${eyebrowDay.total}` : null}
        badge={tripClockState({ startDate: activeTripStartDate, endDate: activeTripEndDate, timezone, now: nowTick }).badge}
        photo={heroPhoto}
      />
      {timezoneUnknown ? (
        <p className="mt-2 px-1 text-[13px] font-medium text-cgray">{UNKNOWN_TZ_LABEL}</p>
      ) : null}
      <div role="tablist" aria-label="Live Companion sections" className="mt-4 flex gap-5 border-b border-chair px-1">
        {([
          ["today", "Today"],
          ["itinerary", "Full Itinerary"],
          ["map", "Map"],
          ["essentials", "Essentials"]
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={liveTab === key}
            onClick={() => setLiveTab(key)}
            className={`-mb-px border-b-2 pb-2 text-[15px] font-semibold ${
              liveTab === key ? "border-cblue text-cblue" : "border-transparent text-cgray"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div hidden={liveTab !== "today"}>
      {/* Picture 4 — Live Companion, Today tab. Closed state, top to
          bottom, exactly the picture: banner · Day heading + subtitle ·
          timeline (time · icon · title · detail · chevron) · Directions
          + Open in Maps buttons. The Directions button opens the
          picture-7 directions panel (unchanged component, user-invoked);
          the closed state ends at the buttons. Pre-trip shows the
          stored plan timeline verbatim; in-progress shows today's live
          activities in the same timeline shape, with NOW / UP NEXT
          pills and the current stop's check-in / complete / skip
          actions. Anything the picture does not show lives nowhere on
          this tab for the customer: no NOW card, no UP NEXT list, no
          Pause row, no QR / phone-transfer card, no alerts feed, no
          footer line (field-test and deep-link lanes below are
          conditional only and never standing content). */}
      {preTrip ? (
        <>
          <div className="mt-3 flex items-start gap-3 rounded-2xl bg-cblue/10 px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cblue/15 text-cblue" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 3 10 14M21 3l-6.5 18-4-9.5L2 8l19-5z" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[17px] font-semibold leading-[1.3] text-chead">Trip hasn&apos;t started yet</span>
              <span className="mt-0.5 block text-[15px] font-normal leading-[1.45] text-cink">
                These are your planned activities for Day {eyebrowDay?.idx || 1}
                {tripDayDateLabel(activeTripStartDate, eyebrowDay?.idx || 1) ? ` (${tripDayDateLabel(activeTripStartDate, eyebrowDay?.idx || 1)})` : ""}.
                You&apos;ll get real-time updates when the trip begins.
              </span>
            </span>
          </div>
          <h2 className="mx-1 mb-1 mt-5 text-[22px] font-bold leading-[1.25] tracking-[-0.018em] text-chead">
            Day {eyebrowDay?.idx || 1}
            {tripDayDateLabel(activeTripStartDate, eyebrowDay?.idx || 1) ? ` · ${tripDayDateLabel(activeTripStartDate, eyebrowDay?.idx || 1)}` : ""}
          </h2>
          {dayPlanTitle ? (
            <p className="mx-1 mb-3 text-[15px] font-normal leading-[1.45] text-cgray">{dayPlanTitle}</p>
          ) : null}
          <section className="relative">
            {dayTimelineRows.length ? (
              <div aria-hidden className="absolute bottom-5 left-24 top-5 w-0 border-l-2 border-dotted border-chair" />
            ) : null}
            {dayTimelineRows.length ? (
              dayTimelineRows.map((row, rowIndex) => {
                const icon = timelineIcon({ kind: row.kind, title: row.title, category: row.category, mode: row.mode });
                const displayTitle = row.unverified ? "Unverified stop" : row.title;
                const displayDetail = row.unverified && row.planTitle
                  ? `Plan title: ${row.planTitle}${row.detail ? ` · ${row.detail}` : ""}`
                  : row.detail;
                return (
                  <div key={`${row.title}-${rowIndex}`} className="relative flex items-start gap-3 py-3">
                    {/* Conditional-acceptance item 1: every pre-trip time
                        carries its provenance. Travel legs whose time is
                        plan-derived already carry the mock's Planned pill
                        under the title, so they get no second label; every
                        other row labels its time here (Planned when the
                        builder marked it schedule-derived, Confirmed when
                        it is verified/FACTUAL). Rows with no time get no
                        label — there is no time to label. */}
                    <span className="flex w-[88px] shrink-0 flex-col pt-2">
                      <span className="text-[15px] font-semibold text-chead">{row.time || ""}</span>
                      {row.time && !(row.kind === "travel" && row.planned) ? (
                        <TimeProvenanceLabel kind={provenanceForPreTripRow(row.planned)} />
                      ) : null}
                    </span>
                    <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: icon.bg }} aria-hidden="true">
                      {icon.glyph}
                    </span>
                    {!row.unverified ? <LiveRowThumb venuePhotos={venuePhotos} title={row.title} /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[17px] font-semibold leading-[1.3] text-chead">{displayTitle}</span>
                      {row.kind === "travel" && row.planned ? (
                        <span className="mt-1 inline-block rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead">Planned</span>
                      ) : null}
                      {displayDetail ? (
                        <span className="mt-0.5 block break-words text-[15px] font-normal leading-[1.4] text-cgray">{displayDetail}</span>
                      ) : null}
                    </span>
                    {rowChevron}
                  </div>
                );
              })
            ) : (
              <p className="rounded-2xl bg-white px-4 py-3 text-[15px] font-normal leading-[1.45] text-cgray shadow-calm">
                Day plan details are not available yet.
              </p>
            )}
          </section>
          {directionsHref || mapsHref ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {hasDirectionLinks && directionsHref ? (
                <button
                  type="button"
                  onClick={() => setShowDirectionsPanel((value) => !value)}
                  aria-expanded={showDirectionsPanel}
                  aria-label="Getting to your next stop"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-chead shadow-calm"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-cblue" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3.5 11.5 11.5 3.5M5 3.5h6.5V10" />
                    </svg>
                  </span>Directions</button>
              ) : null}
              {mapsHref ? (
                <a href={mapsHref} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-chead shadow-calm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#E8F5E9]" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z" />
                      <circle cx="12" cy="11" r="2" />
                    </svg>
                  </span>
                  Open in Maps
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      ) : tripCompleted ? (
        <div className="mt-3 rounded-2xl bg-white px-4 py-3 shadow-calm">
          <p className="text-[17px] font-semibold text-chead">Trip complete</p>
          <p className="mt-1 text-[15px] font-normal leading-[1.45] text-cink">
            Live Companion is closed for this trip. The saved plan stays here to review.
          </p>
        </div>
      ) : (
        <>
          {/* Repair round P3: the banner title "Trip in progress"
              duplicated the hero badge word-for-word, so it is gone.
              The hero above is the Live view's ONE destination/state
              header; this banner keeps only its day context + the
              timing-truth line. */}
          <div className="mt-3 flex items-start gap-3 rounded-2xl bg-cblue/10 px-4 py-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cgreen" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[15px] font-normal leading-[1.45] text-cink">
                Live updates for Day {eyebrowDay?.idx || 1}
                {tripDayDateLabel(activeTripStartDate, eyebrowDay?.idx || 1) ? ` (${tripDayDateLabel(activeTripStartDate, eyebrowDay?.idx || 1)})` : ""}.
                Times below are estimates unless labeled otherwise: a time reads Live-updated only with a fresh location fix or check-in, and Confirmed only for a verified booking. Check in as you go.
              </span>
            </span>
          </div>
          {error ? (
            <p role="alert" className="mt-3 rounded-xl bg-cred/10 px-3.5 py-[11px] text-sm font-semibold leading-[1.35] text-cred">{error}</p>
          ) : null}
          {notice ? (
            <p role="status" aria-live="polite" className="mt-3 rounded-xl bg-cblue/10 px-3.5 py-[11px] text-sm font-medium leading-[1.35] text-cink">{notice}</p>
          ) : null}
          {!trackingEnabled ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-calm">
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
            /* Owner-10 item 6: permission recovery stays reachable
               but renders as ONE compact control — the full
               step-by-step recovery sits behind the tap, not as a
               wall of text on the Live screen. */
            <details className="mt-3 rounded-2xl bg-white px-4 py-3 shadow-calm">
              <summary className="cursor-pointer text-[15px] font-semibold text-chead">Location is off — fix it</summary>
              <div className="mt-2">
                <LocationPermissionRecovery
                  permission="denied"
                  onRetry={enableLocation}
                  onRecheck={() => void recheckLocationPermission()}
                />
              </div>
            </details>
          ) : permission !== "granted" ? (
            <details className="mt-3 rounded-2xl bg-white px-4 py-3 shadow-calm">
              <summary className="cursor-pointer text-[15px] font-semibold text-chead">Location is off — fix it</summary>
              <div className="mt-2">
                <LocationPermissionRecovery
                  permission="prompt"
                  onRetry={enableLocation}
                  onRecheck={() => void recheckLocationPermission()}
                />
              </div>
            </details>
          ) : null}
          {/* Owner-10 item 6: the Today tab is now the status banner
              (above) + ONE featured card + a compact upcoming list.
              The full walk-inserted timeline still lives on the Full
              Itinerary tab; nothing was deleted, only restructured. */}
          {featuredActivity ? (
            <section className="mt-5 rounded-2xl bg-white p-4 shadow-calm">
              <span className="text-[13px] font-semibold uppercase tracking-wide text-cgray">Next relevant activity</span>
              <span className="mt-1 block break-words text-[19px] font-bold leading-[1.3] text-chead">
                {featuredUnverified ? "Unverified stop" : featuredRawTitle}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                {featuredTimeLabel ? <span className="text-[15px] font-semibold text-chead">{featuredTimeLabel}</span> : null}
                {/* Repair round item 1: the featured time is recomputed
                    for today, so it is Estimated unless the evidence
                    gate passes (fresh location fix or fresh check-in)
                    or a verified booking supplied it (Confirmed). */}
                {featuredTimeLabel && featuredActivity ? (
                  <TimeProvenanceLabel kind={liveDayProvenanceFor(featuredActivity)} />
                ) : null}
                {featuredPill ? (
                  <span className="rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead">{featuredPill}</span>
                ) : null}
              </span>
              {featuredUnverified && featuredRawTitle ? (
                <span className="mt-1 block break-words text-[14px] font-normal text-cgray">Plan title: {featuredRawTitle}</span>
              ) : null}
              {!featuredUnverified ? (
                <span className="mt-1 block break-words text-[15px] font-normal leading-[1.4] text-cgray">
                  {activityDisplayDescription(featuredActivity, featuredActivity.category || "")}
                </span>
              ) : null}
            </section>
          ) : null}
          <section className="mt-3">
            {upcomingActivities.length ? (
              upcomingActivities.map((activity) => {
                const start = activityStartDate({ activity, tripStartDate: activeTripStartDate, timezone });
                const timeLabel = start ? formatClock(start.toISOString(), timezone, locale) : activity.timeLabel || "";
                const rawTitle = timelineRowTitle(activity, nextRowTitle, activeDestinationLabel, suppressFlightFraming, originLabel || "");
                const stripped = stripLiveTitleEcho(rawTitle, activity.shortDescription || "");
                const unverified = isUnverifiedLiveStop(rawTitle, stripped);
                const isUpNext = activity.id === remainingToday[0]?.id;
                return (
                  <div key={activity.id} className="flex items-start gap-3 border-b border-chair py-3 last:border-b-0">
                    {/* Repair round item 1: upcoming times are recomputed
                        for today, so each carries Estimated unless the
                        evidence gate passes or a verified booking
                        supplied it. Rows with no time get no label. */}
                    <span className="flex w-[88px] shrink-0 flex-col pt-0.5">
                      <span className="text-[15px] font-semibold text-chead">{timeLabel}</span>
                      {timeLabel ? (
                        <TimeProvenanceLabel kind={liveDayProvenanceFor(activity)} />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[17px] font-semibold leading-[1.3] text-chead">{unverified ? "Unverified stop" : rawTitle}</span>
                      {unverified && rawTitle ? (
                        <span className="mt-0.5 block break-words text-[13px] font-normal text-cgray">Plan title: {rawTitle}</span>
                      ) : null}
                      {isUpNext ? (
                        <span className="mt-1 inline-block rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead">Up next</span>
                      ) : null}
                    </span>
                  </div>
                );
              })
            ) : todayActivities.length ? null : dayTimelineRows.length ? (
              <div>
                <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-cgray">Today&apos;s plan · from your itinerary</p>
                {dayTimelineRows.map((row, rowIndex) => {
                  const icon = timelineIcon({ kind: row.kind, title: row.title, category: row.category, mode: row.mode });
                  const displayTitle = row.unverified ? "Unverified stop" : row.title;
                  const displayDetail = row.unverified && row.planTitle
                    ? `Plan title: ${row.planTitle}${row.detail ? ` · ${row.detail}` : ""}`
                    : row.detail;
                  return (
                    <div key={`${row.title}-${rowIndex}`} className="flex items-start gap-3 border-b border-chair py-3 last:border-b-0">
                      <span className="flex w-[88px] shrink-0 flex-col pt-0.5">
                        <span className="text-[15px] font-semibold text-chead">{row.time || ""}</span>
                        {row.time && !(row.kind === "travel" && row.planned) ? (
                          <TimeProvenanceLabel kind={provenanceForPreTripRow(row.planned)} />
                        ) : null}
                      </span>
                      <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: icon.bg }} aria-hidden="true">
                        {icon.glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[17px] font-semibold leading-[1.3] text-chead">{displayTitle}</span>
                        {row.kind === "travel" && row.planned ? (
                          <span className="mt-1 inline-block rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead">Planned</span>
                        ) : null}
                        {displayDetail ? (
                          <span className="mt-0.5 block break-words text-[15px] font-normal leading-[1.4] text-cgray">{displayDetail}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-2xl bg-white px-4 py-3 text-[15px] font-normal leading-[1.45] text-cgray shadow-calm">
                Today&apos;s plan is not available yet.
              </p>
            )}
          </section>
          {!tripCompleted ? <section className="mt-3 rounded-2xl bg-white shadow-calm">
            {currentActivity && !tripCompleted ? (
              /* Owner-10 item 6: Check in / Complete / Skip stay
                 reachable, behind the featured card — one tap on
                 "Stop actions" — instead of a standing action block. */
              <details className="px-1 pb-1">
                <summary className="cursor-pointer px-3 py-2.5 text-[15px] font-semibold text-chead">Stop actions</summary>
                <button
                  type="button"
                  onClick={() => void runAction(currentActivity.id, "check-in", location)}
                  disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(String(currentActivity.status))}
                  className="min-h-[50px] w-full rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white disabled:opacity-45"
                >
                  {t("ui.actions.checkIn")}
                </button>
                <div className="divide-y divide-chair">
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
                </div>
              </details>
            ) : null}
            <p className="px-4 py-2.5 text-[13px] font-normal leading-[1.4] text-cgray">
              {!currentActivity ? "Review the plan and confirm anything still suggested." : "Skip or complete this stop. The rest of today's times stay as labeled."}
            </p>
          </section> : null}
          {directionsHref || mapsHref ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {hasDirectionLinks && directionsHref ? (
                <button
                  type="button"
                  onClick={() => setShowDirectionsPanel((value) => !value)}
                  aria-expanded={showDirectionsPanel}
                  aria-label="Getting to your next stop"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-chead shadow-calm"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-cblue" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3.5 11.5 11.5 3.5M5 3.5h6.5V10" />
                    </svg>
                  </span>Directions</button>
              ) : null}
              {mapsHref ? (
                <a href={mapsHref} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-chead shadow-calm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#E8F5E9]" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z" />
                      <circle cx="12" cy="11" r="2" />
                    </svg>
                  </span>
                  Open in Maps
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {/* Picture-7 directions panel, user-invoked only: the Directions
          button above opens it for the next stop. Closed, the Today
          tab ends at the buttons. The panel's own standalone link
          (standaloneHref) is this picture's Live entry point to the
          standalone directions screen; the toggle behavior and the
          panel's mount props are otherwise unchanged. */}
      {nextActivity ? (
        showDirectionsPanel ? (
          <div className="mt-3 overflow-hidden rounded-2xl shadow-calm">
            <DirectionsPanel
              tripId={tripId}
              destination={{
                id: nextActivity.id,
                title: nextActivity.title,
                address: nextActivity.address,
                placeName: nextActivity.placeName,
                latitude: nextActivity.latitude,
                longitude: nextActivity.longitude,
                radiusMeters: nextActivity.radiusMeters
              }}
              originItemId={currentActivity?.id ?? null}
              dayNumber={eyebrowDay?.idx ?? null}
              dayDate={nextActivity.date ?? null}
              tripDestinationLabel={activeDestinationLabel}
              tripStartDate={activeTripStartDate}
              tripEndDate={activeTripEndDate}
              tripOriginLabel={originLabel}
              mode={directionMode}
              permission={permission}
              location={usableLocation}
              liveRoute={model.route}
              routeEvidence={null}
              steps={null}
              onBack={() => setShowDirectionsPanel(false)}
              onRequestLocation={() => enableLocation()}
              unverified={nextUnverified}
              planTitle={nextUnverified ? nextActivity.title : null}
              standaloneHref={`/trip/${tripId}/directions/${nextActivity.id}?from=live`}
            />
          </div>
        ) : null
      ) : null}

      {fieldTestMode && showSetupCard ? (
      <section className="mt-5 rounded-2xl bg-white p-4 shadow-calm">
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
            <p className="mt-1 text-sm font-normal leading-[1.45] text-cink">In iPhone Settings, allow notifications for Roamly, then return to the field test. Roamly will not ask again here.</p>
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

      {fieldTestMode ? (
        <p className="mt-[13px] text-center text-[13px] font-normal text-cgray">
          Roamly is following along — it speaks up only when it matters.
        </p>
      ) : null}

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
              "rounded-2xl border bg-white p-4 shadow-calm transition-shadow",
              deepLinkedActivityId === activity.id
                ? "border-cblue/40 bg-cblue/5 shadow-[0_0_0_3px_rgba(0,122,255,0.15)]"
                : activity.id === currentActivity?.id ? "border-cblue/40" : "border-chair"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-cgray">
                  {activity.timeLabel || "Flexible"} · {activity.id === currentActivity?.id ? "Now" : activity.id === nextActivity?.id ? "Next" : displayStatusFor(activity)}
                </p>
                <h3 className="mt-1 text-[17px] font-semibold text-chead">{timelineRowTitle(activity, nextRowTitle, activeDestinationLabel, suppressFlightFraming, originLabel || "")}</h3>
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

      </div>

      {/* Round 2 tab panels (composite structure, real data). The
          itinerary tab's rows carry no coordinates, so a stored
          "nearby" status there can never render as nearby — it reads
          "Planned", fail-closed, same as every other surface. */}
      {liveTab === "itinerary" ? (
        <section className="mt-4">
          <p className="mx-4 mb-[7px] text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Full Itinerary</p>
          {itineraryDays.length ? (
            <div className="grid gap-4">
              {itineraryDays.map((day) => (
                <div key={day.dayNumber} className="rounded-2xl bg-white p-4 shadow-calm">
                  <p className="text-[17px] font-semibold text-chead">
                    Day {day.dayNumber}{day.dateLabel ? ` · ${day.dateLabel}` : ""}
                  </p>
                  <div className="mt-2 divide-y divide-chair">
                    {day.activities.map((activity, activityIndex) => (
                      <div key={`${activity.title}-${activityIndex}`} className="flex items-baseline gap-3 py-2">
                        <span className="w-[88px] shrink-0 text-[15px] font-semibold text-chead">{activity.timeLabel || ""}</span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-normal text-cink">{activity.title}</span>
                        <span className="shrink-0 text-[13px] font-normal text-cgray">
                          {activity.status === "nearby" ? "Planned" : activity.status || "Planned"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-white p-4 text-[15px] font-normal leading-[1.45] text-cgray shadow-calm">
              The full itinerary for this trip is not available here yet.
            </p>
          )}
          <a href={`/trip/${tripId}`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cblue px-5 text-[15px] font-semibold text-white">
            See the full itinerary
          </a>
        </section>
      ) : null}
      {/* Picture 4, Map tab — honest unavailable state (named gap):
          no map component or map dependency exists in this codebase,
          so no map image, tile, or static-map frame is ever rendered
          here. The real external-maps links for the current/next stop
          remain as the way to see the stops on a map — links, not a
          map. */}
      {liveTab === "map" ? (
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-calm">
          <p className="text-[17px] font-semibold text-chead">Map</p>
          <p className="mt-1 text-[15px] font-normal leading-[1.45] text-cink">
            An in-app map is not available for this trip yet — no map component exists in the app, so no map is shown here.
          </p>
          {mapDirectionsHref || mapMapsHref ? (
            <>
              <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
                {directionsHref || mapsHref ? "Open this trip's stops in your maps app instead:" : "Open today's first stop in your maps app instead:"}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {mapDirectionsHref ? (
                  <a href={mapDirectionsHref} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cbg px-4 text-[15px] font-semibold text-chead">
                    Directions
                  </a>
                ) : null}
                {mapMapsHref ? (
                  <a href={mapMapsHref} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cbg px-4 text-[15px] font-semibold text-chead">
                    Open in Maps
                  </a>
                ) : null}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
              Maps links are not available for this trip yet.
            </p>
          )}
        </section>
      ) : null}
      {liveTab === "essentials" ? (
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-calm">
          <p className="text-[17px] font-semibold text-chead">
            Essentials · {essentialsDone} of {checklist.length}
          </p>
          {checklist.length ? (
            <div className="mt-2 grid gap-2">
              {checklist.map((item) => (
                <p key={item.id} className="text-sm font-normal text-cink">
                  {item.is_done ? "Done: " : ""}{item.item}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cgray">
              No essentials for this trip yet.
            </p>
          )}
        </section>
      ) : null}

      {canSimulateLocation ? (
        <details className="rounded-2xl border border-chair bg-white p-4 shadow-calm">
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
