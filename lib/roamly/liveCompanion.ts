export type LiveCoordinates = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
};

export type LiveLocationPermission = "granted" | "denied" | "prompt" | "unavailable";

export type LiveRouteStatus =
  | {
      status: "verified";
      provider: string;
      mode: "walking" | "transit" | "driving" | "rideshare";
      durationMinutes: number;
      retrievedAt: string;
      mapsUrl: string;
    }
  | {
      status: "unavailable" | "offline" | "permission_denied";
      provider?: string | null;
      mode?: "walking" | "transit" | "driving" | "rideshare" | null;
      durationMinutes?: null;
      retrievedAt?: string | null;
      mapsUrl: string;
      reason: string;
    };

export type LiveBookingDetails = {
  id?: string | null;
  title?: string | null;
  reference?: string | null;
  provider?: string | null;
  gate?: string | null;
  terminal?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  status?: "verified" | "estimated" | "stale" | "unknown";
  updatedAt?: string | null;
};

export type LiveCompanionActivity = {
  id: string;
  title: string;
  shortDescription?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  date?: string | null;
  dayNumber?: number | null;
  timeLabel?: string | null;
  address?: string | null;
  placeName?: string | null;
  openingHours?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
  status?: string | null;
  booking?: LiveBookingDetails | null;
};

export type LiveCompanionTrip = {
  id: string;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  enabled?: boolean;
  pausedUntil?: string | null;
  destination?: {
    label?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number | null;
  } | null;
};

export type LiveCompanionSettings = {
  reminderLeadMinutes: number;
  cooldownMinutes: number;
  maxNotificationsPerHour: number;
  lateThresholdMinutes: number;
  arrivalRadiusMeters: number;
  locationUpdateIntervalSeconds: number;
  departureBufferMinutes: number;
};

export type LiveNotificationType =
  | "trip_active"
  | "leave_by"
  | "arrival"
  | "late"
  | "booking_change"
  | "next_activity";

export type LiveNotificationHistoryItem = {
  key: string;
  eventType: LiveNotificationType;
  activityId?: string | null;
  sentAt: string;
};

export type LiveNotificationDecision = {
  eventTime: string;
  eventType: LiveNotificationType;
  activityId?: string | null;
  activityTitle?: string | null;
  locationState: string;
  notificationSent: boolean;
  suppressionReason?: string;
  reason: string;
  key: string;
};

export type LiveCompanionState = {
  activeWindow: boolean;
  activationStatus:
    | "active"
    | "future_trip"
    | "completed_trip"
    | "disabled"
    | "paused"
    | "permission_required"
    | "location_unavailable"
    | "too_far"
    | "schedule_only";
  activationReason: string;
  now: LiveCompanionActivity | null;
  next: LiveCompanionActivity | null;
  countdownMinutes: number | null;
  leaveBy: string | null;
  lateByMinutes: number | null;
  arrivalState: "arrived" | "nearby" | "away" | "unknown";
  route: LiveRouteStatus;
  alerts: string[];
};

export const DEFAULT_LIVE_COMPANION_SETTINGS: LiveCompanionSettings = {
  reminderLeadMinutes: 45,
  cooldownMinutes: 20,
  maxNotificationsPerHour: 4,
  lateThresholdMinutes: 8,
  arrivalRadiusMeters: 120,
  locationUpdateIntervalSeconds: 90,
  departureBufferMinutes: 10
};

const EARTH_RADIUS_METERS = 6371000;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function timezoneFromTripMetadata(metadata: unknown, fallback = "UTC") {
  const root = recordValue(metadata);
  const planning = recordValue(root?.planning) || recordValue(root?.tripPlanning) || root;
  const candidates = [
    planning?.timezone,
    planning?.destinationTimezone,
    planning?.destination_timezone,
    root?.timezone,
    root?.destinationTimezone,
    root?.destination_timezone
  ];
  const timezone = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return timezone || fallback;
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function datePartsInZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}

export function localDateInTimeZone(now: string | Date, timezone = "UTC") {
  const date = toDate(now) || new Date();
  const parts = datePartsInZone(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function compareIsoDate(a: string | null | undefined, b: string) {
  const value = (a || "").slice(0, 10);
  if (!value) return 0;
  return value.localeCompare(b);
}

export function isTodayWithinTripDates(params: {
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  now?: string | Date;
}) {
  if (!params.startDate || !params.endDate) return false;
  const today = localDateInTimeZone(params.now || new Date(), params.timezone || "UTC");
  return compareIsoDate(params.startDate, today) <= 0 && compareIsoDate(params.endDate, today) >= 0;
}

export function tripWindowState(params: {
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  now?: string | Date;
}) {
  const today = localDateInTimeZone(params.now || new Date(), params.timezone || "UTC");
  if (!params.startDate || !params.endDate) return "missing_dates" as const;
  if (compareIsoDate(params.startDate, today) > 0) return "future_trip" as const;
  if (compareIsoDate(params.endDate, today) < 0) return "completed_trip" as const;
  return "active" as const;
}

export function calculateDistanceMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(toLatitude - fromLatitude);
  const dLon = toRad(toLongitude - fromLongitude);
  const lat1 = toRad(fromLatitude);
  const lat2 = toRad(toLatitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function validCoordinates(value: { latitude?: number | null; longitude?: number | null } | null | undefined) {
  return (
    typeof value?.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude)
  );
}

export function parseClockMinutes(value?: string | null) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const first = raw.split(/[-–—]/)[0]?.trim() || raw;
  const military = first.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour = Number(military[1]);
    const minute = Number(military[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }
  const twelve = first.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!twelve) return null;
  let hour = Number(twelve[1]);
  const minute = Number(twelve[2] || "0");
  const period = twelve[3].toUpperCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function dateForDay(startDate: string | null | undefined, dayNumber: number | null | undefined) {
  if (!startDate || !dayNumber || dayNumber < 1) return null;
  const base = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + dayNumber - 1);
  return base.toISOString().slice(0, 10);
}

function zonedDateTimeToDate(dateIso: string, minutes: number, timezone: string) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const actualLocal = datePartsInZone(utcGuess, timezone);
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  const actual = Date.UTC(
    actualLocal.year,
    actualLocal.month - 1,
    actualLocal.day,
    actualLocal.hour,
    actualLocal.minute
  );
  return new Date(utcGuess.getTime() + (intended - actual));
}

export function activityStartDate(params: {
  activity: LiveCompanionActivity;
  tripStartDate?: string | null;
  timezone?: string | null;
}) {
  const direct = toDate(params.activity.booking?.startTime || params.activity.startAt || null);
  if (direct) return direct;
  const minutes = parseClockMinutes(params.activity.timeLabel);
  const date = params.activity.date || dateForDay(params.tripStartDate, params.activity.dayNumber);
  if (!date || minutes == null) return null;
  return zonedDateTimeToDate(date.slice(0, 10), minutes, params.timezone || "UTC");
}

function activityEndDate(params: {
  activity: LiveCompanionActivity;
  tripStartDate?: string | null;
  timezone?: string | null;
}) {
  const direct = toDate(params.activity.booking?.endTime || params.activity.endAt || null);
  if (direct) return direct;
  const start = activityStartDate(params);
  if (!start) return null;
  return new Date(start.getTime() + 90 * 60_000);
}

export function selectNowAndNextActivity(params: {
  activities: LiveCompanionActivity[];
  tripStartDate?: string | null;
  timezone?: string | null;
  now?: string | Date;
}) {
  const now = toDate(params.now || new Date()) || new Date();
  const activeStatuses = new Set(["active", "nearby", "checked_in"]);
  const doneStatuses = new Set(["completed", "skipped", "missed", "cancelled"]);
  const sorted = params.activities
    .filter((activity) => !doneStatuses.has(String(activity.status || "").toLowerCase()))
    .map((activity, index) => ({
      activity,
      index,
      start: activityStartDate({ activity, tripStartDate: params.tripStartDate, timezone: params.timezone }),
      end: activityEndDate({ activity, tripStartDate: params.tripStartDate, timezone: params.timezone })
    }))
    .sort((a, b) => {
      const aTime = a.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime === bTime ? a.index - b.index : aTime - bTime;
    });

  const statusNow = sorted.find(({ activity }) => activeStatuses.has(String(activity.status || "").toLowerCase()));
  const timeNow = sorted.find(({ start, end }) => start && end && start.getTime() <= now.getTime() && end.getTime() >= now.getTime());
  const previousRecent = sorted
    .filter(({ start }) => start && start.getTime() <= now.getTime())
    .sort((a, b) => (b.start?.getTime() || 0) - (a.start?.getTime() || 0))[0];
  const nowActivity = statusNow?.activity || timeNow?.activity || previousRecent?.activity || null;
  const nextActivity =
    sorted.find(({ activity, start }) => activity.id !== nowActivity?.id && (!start || start.getTime() >= now.getTime()))?.activity ||
    sorted.find(({ activity }) => activity.id !== nowActivity?.id)?.activity ||
    null;

  return { now: nowActivity, next: nextActivity };
}

export function countdownMinutesTo(value: string | Date | null | undefined, now: string | Date = new Date()) {
  const target = toDate(value);
  const current = toDate(now) || new Date();
  if (!target) return null;
  return Math.round((target.getTime() - current.getTime()) / 60_000);
}

export function calculateRecommendedDeparture(params: {
  nextStartAt?: string | Date | null;
  routeDurationMinutes?: number | null;
  bufferMinutes?: number | null;
}) {
  const start = toDate(params.nextStartAt || null);
  const route = params.routeDurationMinutes;
  if (!start || typeof route !== "number" || !Number.isFinite(route) || route < 0) return null;
  const buffer = Math.max(0, params.bufferMinutes ?? DEFAULT_LIVE_COMPANION_SETTINGS.departureBufferMinutes);
  return new Date(start.getTime() - (route + buffer) * 60_000);
}

export function evaluateLateUserAdjustment(params: {
  now?: string | Date;
  recommendedDepartureAt?: string | Date | null;
  nextStartAt?: string | Date | null;
  lateThresholdMinutes?: number;
}) {
  const now = toDate(params.now || new Date()) || new Date();
  const departure = toDate(params.recommendedDepartureAt || null);
  const start = toDate(params.nextStartAt || null);
  const threshold = params.lateThresholdMinutes ?? DEFAULT_LIVE_COMPANION_SETTINGS.lateThresholdMinutes;
  if (!departure || !start) return { late: false, lateByMinutes: 0, adjustment: "" };
  const lateByMinutes = Math.max(0, Math.round((now.getTime() - departure.getTime()) / 60_000));
  if (lateByMinutes <= threshold) return { late: false, lateByMinutes: 0, adjustment: "" };
  if (now.getTime() > start.getTime()) {
    return {
      late: true,
      lateByMinutes,
      adjustment: "You may miss the scheduled start. Keep the next booking fixed and move only flexible stops after it."
    };
  }
  return {
    late: true,
    lateByMinutes,
    adjustment: "Leave now and keep the next confirmed booking fixed. Adjust only flexible activities after it."
  };
}

export function detectArrival(params: {
  location?: LiveCoordinates | null;
  activity?: LiveCompanionActivity | null;
  radiusMeters?: number | null;
}) {
  const activity = params.activity;
  if (!params.location || !validCoordinates(activity)) {
    return { arrived: false, distanceMeters: null as number | null, radiusMeters: params.radiusMeters || null };
  }
  const radius = Math.max(20, params.radiusMeters || activity?.radiusMeters || DEFAULT_LIVE_COMPANION_SETTINGS.arrivalRadiusMeters);
  const distance = calculateDistanceMeters(
    params.location.latitude,
    params.location.longitude,
    Number(activity?.latitude),
    Number(activity?.longitude)
  );
  return { arrived: distance <= radius, distanceMeters: distance, radiusMeters: radius };
}

export function evaluateLiveCompanionActivation(params: {
  trip: LiveCompanionTrip;
  permission: LiveLocationPermission;
  location?: LiveCoordinates | null;
  scheduledArea?: LiveCompanionActivity | null;
  now?: string | Date;
}) {
  const now = toDate(params.now || new Date()) || new Date();
  const window = tripWindowState({
    startDate: params.trip.startDate,
    endDate: params.trip.endDate,
    timezone: params.trip.timezone,
    now
  });
  if (params.trip.enabled === false) return { active: false, status: "disabled" as const, reason: "Live Companion is disabled." };
  const paused = toDate(params.trip.pausedUntil || null);
  if (paused && paused.getTime() > now.getTime()) return { active: false, status: "paused" as const, reason: "Live Companion is paused." };
  if (window === "future_trip") return { active: false, status: "future_trip" as const, reason: "Trip has not started yet." };
  if (window === "completed_trip") return { active: false, status: "completed_trip" as const, reason: "Trip is already complete." };
  if (window !== "active") return { active: false, status: "future_trip" as const, reason: "Trip dates are required before Live Companion can activate." };
  if (params.permission !== "granted") return { active: false, status: "permission_required" as const, reason: "Location permission is required for live activation." };
  if (!params.location) return { active: false, status: "location_unavailable" as const, reason: "Location is unavailable; schedule-only mode is available." };

  const scheduled = params.scheduledArea;
  if (validCoordinates(scheduled)) {
    const distance = calculateDistanceMeters(
      params.location.latitude,
      params.location.longitude,
      Number(scheduled?.latitude),
      Number(scheduled?.longitude)
    );
    if (distance <= Math.max(250, scheduled?.radiusMeters || 1000)) {
      return { active: true, status: "active" as const, reason: "User is near the current scheduled area.", distanceMeters: distance };
    }
  }

  const destination = params.trip.destination;
  if (validCoordinates(destination)) {
    const distance = calculateDistanceMeters(
      params.location.latitude,
      params.location.longitude,
      Number(destination?.latitude),
      Number(destination?.longitude)
    );
    if (distance <= Math.max(10_000, destination?.radiusMeters || 50_000)) {
      return { active: true, status: "active" as const, reason: "User is near the trip destination.", distanceMeters: distance };
    }
    return { active: false, status: "too_far" as const, reason: "User is outside the trip destination area.", distanceMeters: distance };
  }

  return { active: true, status: "schedule_only" as const, reason: "Trip is active; using schedule-only mode until a verified destination location is available." };
}

export function mapsUrlForActivity(activity?: LiveCompanionActivity | null) {
  if (!activity) return "";
  const value = validCoordinates(activity)
    ? `${activity.latitude},${activity.longitude}`
    : [activity.placeName, activity.address, activity.title].filter(Boolean).join(" ");
  return value ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(value)}` : "";
}

export function fallbackRouteStatus(activity?: LiveCompanionActivity | null, reason = "Live route provider unavailable."): LiveRouteStatus {
  return {
    status: "unavailable",
    durationMinutes: null,
    mapsUrl: mapsUrlForActivity(activity),
    reason
  };
}

export function evaluateNotificationDecision(params: {
  eventType: LiveNotificationType;
  activity?: LiveCompanionActivity | null;
  now?: string | Date;
  settings?: Partial<LiveCompanionSettings>;
  history?: LiveNotificationHistoryItem[];
  activeWindow: boolean;
  paused?: boolean;
  locationState?: string;
  reason: string;
}) {
  const settings = { ...DEFAULT_LIVE_COMPANION_SETTINGS, ...(params.settings || {}) };
  const now = toDate(params.now || new Date()) || new Date();
  const sentAt = now.toISOString();
  const activityId = params.activity?.id || null;
  const key = `${params.eventType}:${activityId || "trip"}:${localDateInTimeZone(now, "UTC")}`;
  const history = params.history || [];
  const recent = history.filter((item) => now.getTime() - new Date(item.sentAt).getTime() < 60 * 60_000);
  const duplicate = history.find((item) => item.key === key);
  const cooldown = history.find((item) => {
    if (item.eventType !== params.eventType) return false;
    if ((item.activityId || null) !== activityId) return false;
    return now.getTime() - new Date(item.sentAt).getTime() < settings.cooldownMinutes * 60_000;
  });
  const onceOnly =
    params.eventType === "arrival" || params.eventType === "late" || params.eventType === "trip_active";
  let suppressionReason = "";
  if (!params.activeWindow) suppressionReason = "outside_active_trip_window";
  else if (params.paused) suppressionReason = "paused";
  else if (duplicate && onceOnly) suppressionReason = "duplicate_event";
  else if (cooldown) suppressionReason = "cooldown";
  else if (recent.length >= settings.maxNotificationsPerHour) suppressionReason = "hourly_limit";

  return {
    eventTime: sentAt,
    eventType: params.eventType,
    activityId,
    activityTitle: params.activity?.title || null,
    locationState: params.locationState || "unknown",
    notificationSent: !suppressionReason,
    suppressionReason: suppressionReason || undefined,
    reason: params.reason,
    key
  } satisfies LiveNotificationDecision;
}

export function applyVerifiedBookingOverride(
  activity: LiveCompanionActivity,
  bookings: LiveBookingDetails[]
) {
  const match = bookings.find((booking) => {
    const title = `${booking.title || ""}`.toLowerCase();
    return Boolean(
      booking.status === "verified" &&
        (booking.id === activity.booking?.id ||
          title === activity.title.toLowerCase() ||
          (title && activity.title.toLowerCase().includes(title)))
    );
  });
  if (!match) return activity;
  return {
    ...activity,
    startAt: match.startTime || activity.startAt,
    endAt: match.endTime || activity.endAt,
    booking: {
      ...(activity.booking || {}),
      ...match,
      status: "verified" as const
    }
  };
}

export function buildLiveCompanionState(params: {
  trip: LiveCompanionTrip;
  activities: LiveCompanionActivity[];
  permission: LiveLocationPermission;
  location?: LiveCoordinates | null;
  route?: LiveRouteStatus | null;
  settings?: Partial<LiveCompanionSettings>;
  now?: string | Date;
}) {
  const settings = { ...DEFAULT_LIVE_COMPANION_SETTINGS, ...(params.settings || {}) };
  const nowDate = toDate(params.now || new Date()) || new Date();
  const selection = selectNowAndNextActivity({
    activities: params.activities,
    tripStartDate: params.trip.startDate,
    timezone: params.trip.timezone,
    now: nowDate
  });
  const activeWindow = isTodayWithinTripDates({
    startDate: params.trip.startDate,
    endDate: params.trip.endDate,
    timezone: params.trip.timezone,
    now: nowDate
  });
  const activation = evaluateLiveCompanionActivation({
    trip: params.trip,
    permission: params.permission,
    location: params.location,
    scheduledArea: selection.now || selection.next,
    now: nowDate
  });
  const nextStart = selection.next
    ? activityStartDate({ activity: selection.next, tripStartDate: params.trip.startDate, timezone: params.trip.timezone })
    : null;
  const route = params.route || fallbackRouteStatus(selection.next);
  const departure =
    route.status === "verified"
      ? calculateRecommendedDeparture({
          nextStartAt: nextStart,
          routeDurationMinutes: route.durationMinutes,
          bufferMinutes: settings.departureBufferMinutes
        })
      : null;
  const late = evaluateLateUserAdjustment({
    now: nowDate,
    recommendedDepartureAt: departure,
    nextStartAt: nextStart,
    lateThresholdMinutes: settings.lateThresholdMinutes
  });
  const arrival = detectArrival({
    location: params.location,
    activity: selection.now || selection.next,
    radiusMeters: settings.arrivalRadiusMeters
  });
  const alerts = [
    activation.active ? "" : activation.reason,
    route.status === "verified" ? "" : route.reason,
    late.late ? late.adjustment : ""
  ].filter(Boolean);

  return {
    activeWindow,
    activationStatus: activation.status,
    activationReason: activation.reason,
    now: selection.now,
    next: selection.next,
    countdownMinutes: countdownMinutesTo(nextStart, nowDate),
    leaveBy: departure?.toISOString() || null,
    lateByMinutes: late.late ? late.lateByMinutes : null,
    arrivalState: arrival.arrived ? "arrived" : arrival.distanceMeters == null ? "unknown" : arrival.distanceMeters <= settings.arrivalRadiusMeters * 2 ? "nearby" : "away",
    route,
    alerts
  } satisfies LiveCompanionState;
}
