import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateDistanceMeters, type LocationInput } from "@/lib/roamly/location";
import {
  buildLiveCompanionState,
  evaluateNotificationDecision,
  timezoneFromTripMetadata,
  type LiveCompanionActivity,
  type LiveNotificationHistoryItem,
  type LiveNotificationType
} from "@/lib/roamly/liveCompanion";
import { sendPushNotification } from "@/lib/roamly/pushServer";

type DemoStop = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  startAt: string;
};

type DemoPayload = {
  sessionId: string;
  startedAt: string;
  expiresAt: string;
  stops: DemoStop[];
};

type DemoTrip = {
  id: string;
  user_id: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
};

type DemoHistoryEvent = {
  event_type?: string | null;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DemoPushResult = {
  ok: boolean;
  sent: number;
  failed: number;
  status: "sent" | "no_subscription" | "not_configured" | "failed";
};

const MAX_DEMO_STOPS = 3;
const MAX_DEMO_TTL_MS = 30 * 60_000;
const DEMO_DECISION_SETTINGS = {
  cooldownMinutes: 1,
  maxNotificationsPerHour: 12,
  arrivalRadiusMeters: 60,
  reminderLeadMinutes: 10
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanString(value: unknown, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDemoStop(value: unknown, index: number): DemoStop | null {
  const record = recordValue(value);
  if (!record) return null;
  const latitude = cleanNumber(record.latitude);
  const longitude = cleanNumber(record.longitude);
  const radiusMeters = cleanNumber(record.radiusMeters);
  const startAt = cleanString(record.startAt, 80);
  if (latitude == null || longitude == null || radiusMeters == null || !startAt) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    id: cleanString(record.id, 80) || `demo-stop-${index + 1}`,
    title: cleanString(record.title, 80) || `Demo Stop ${index + 1}`,
    latitude,
    longitude,
    radiusMeters: Math.min(75, Math.max(20, Math.round(radiusMeters))),
    startAt
  };
}

function normalizeDemoPayload(value: unknown): { ok: true; demo: DemoPayload } | { ok: false; error: string } {
  const record = recordValue(value);
  if (!record) return { ok: false, error: "Live demo payload is required." };
  const sessionId = cleanString(record.sessionId, 120);
  const startedAt = cleanString(record.startedAt, 80);
  const expiresAt = cleanString(record.expiresAt, 80);
  const started = new Date(startedAt).getTime();
  const expires = new Date(expiresAt).getTime();
  const now = Date.now();
  if (!sessionId || !Number.isFinite(started) || !Number.isFinite(expires)) {
    return { ok: false, error: "Live demo session is invalid." };
  }
  if (expires <= now) return { ok: false, error: "Live demo session expired." };
  if (expires - started > MAX_DEMO_TTL_MS || started - now > 60_000) {
    return { ok: false, error: "Live demo session window is invalid." };
  }
  const stops = Array.isArray(record.stops)
    ? record.stops.slice(0, MAX_DEMO_STOPS).map(normalizeDemoStop).filter((stop): stop is DemoStop => Boolean(stop))
    : [];
  if (stops.length !== MAX_DEMO_STOPS) {
    return { ok: false, error: "Live demo requires three valid checkpoints." };
  }
  return { ok: true, demo: { sessionId, startedAt, expiresAt, stops } };
}

function toActivity(stop: DemoStop): LiveCompanionActivity {
  return {
    id: stop.id,
    title: stop.title,
    shortDescription: "Temporary Live Companion demo checkpoint.",
    startAt: stop.startAt,
    address: stop.title,
    placeName: stop.title,
    latitude: stop.latitude,
    longitude: stop.longitude,
    radiusMeters: stop.radiusMeters,
    status: "planned"
  };
}

function isLiveNotificationType(value: unknown): value is LiveNotificationType {
  return value === "arrival" || value === "next_activity" || value === "leave_by" || value === "late" || value === "trip_active" || value === "booking_change";
}

function companionEventTypeFor(type: LiveNotificationType) {
  if (type === "next_activity") return "up_next_activity";
  if (type === "leave_by") return "departure_reminder";
  if (type === "late") return "running_late";
  return "nearby_activity";
}

function pushResultSummary(result: Awaited<ReturnType<typeof sendPushNotification>>): DemoPushResult {
  const sent = Number(result.sent || 0);
  const failed = Number(result.failed || 0);
  const error = String(result.error || "");
  return {
    ok: Boolean(result.ok),
    sent,
    failed,
    status: sent > 0 ? "sent" : /not configured/i.test(error) ? "not_configured" : /subscription/i.test(error) ? "no_subscription" : "failed"
  };
}

function stopDistances(stops: DemoStop[], location: LocationInput) {
  return stops.map((stop, index) => {
    const distanceMeters = calculateDistanceMeters(location.latitude, location.longitude, stop.latitude, stop.longitude);
    return {
      ...stop,
      index,
      distanceMeters,
      insideGeofence: distanceMeters <= stop.radiusMeters
    };
  });
}

function historyItem(event: DemoHistoryEvent): LiveNotificationHistoryItem | null {
  const metadata = recordValue(event.metadata);
  const type = metadata?.liveNotificationType;
  if (!isLiveNotificationType(type)) return null;
  return {
    eventType: type,
    activityId: cleanString(metadata?.demoStopId, 80) || null,
    sentAt: cleanString(event.created_at, 80) || new Date().toISOString(),
    key: cleanString(metadata?.liveNotificationKey, 160) || `${type}:${cleanString(metadata?.demoStopId, 80) || "demo"}`
  };
}

async function loadDemoHistory(supabase: SupabaseClient, userId: string, tripId: string, sessionId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("event_type,title,body,created_at,metadata")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .eq("metadata->>liveDemo", "true")
    .eq("metadata->>demoSessionId", sessionId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { events: [] as DemoHistoryEvent[], history: [] as LiveNotificationHistoryItem[], error: error.message };
  const events = (data || []) as DemoHistoryEvent[];
  return {
    events,
    history: events.map(historyItem).filter((item): item is LiveNotificationHistoryItem => Boolean(item)),
    error: null as string | null
  };
}

export async function processLiveCompanionDemoUpdate(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  location: LocationInput;
  payload: unknown;
}) {
  const normalized = normalizeDemoPayload(params.payload);
  if (!normalized.ok) return { ok: false as const, error: normalized.error };
  const demo = normalized.demo;

  const [tripResult, pushSubscriptions] = await Promise.all([
    params.supabase
      .from("roamly_trips")
      .select("id,user_id,title,metadata")
      .eq("id", params.tripId)
      .eq("user_id", params.userId)
      .maybeSingle(),
    params.supabase
      .from("roamly_push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", params.userId)
      .eq("enabled", true)
  ]);

  if (tripResult.error) return { ok: false as const, error: tripResult.error.message };
  const trip = tripResult.data as DemoTrip | null;
  if (!trip) return { ok: false as const, error: "Trip not found for Live Demo." };
  if (pushSubscriptions.error) return { ok: false as const, error: pushSubscriptions.error.message };
  if (!pushSubscriptions.count) return { ok: false as const, error: "No active push subscription found for this device/account." };

  const loadedHistory = await loadDemoHistory(params.supabase, params.userId, params.tripId, demo.sessionId);
  const events = loadedHistory.events;
  const history = loadedHistory.history;
  const distances = stopDistances(demo.stops, params.location);
  const insideStop = distances.find((stop) => stop.insideGeofence) || null;
  const arrivedIds = new Set(
    events
      .map((event) => recordValue(event.metadata))
      .filter((metadata) => metadata?.liveNotificationType === "arrival")
      .map((metadata) => cleanString(metadata?.demoStopId, 80))
      .filter(Boolean)
  );
  let lastPushResult: DemoPushResult | null = null;
  let lastEvent: { type: string; title: string; stopId: string | null; createdAt: string | null } | null = null;

  const today = new Date().toISOString().slice(0, 10);
  const state = buildLiveCompanionState({
    trip: {
      id: trip.id,
      title: trip.title,
      startDate: today,
      endDate: today,
      timezone: timezoneFromTripMetadata(trip.metadata),
      enabled: true
    },
    activities: demo.stops.map(toActivity),
    permission: "granted",
    location: params.location,
    settings: DEMO_DECISION_SETTINGS,
    now: new Date()
  });

  async function persistAndPush(input: {
    eventType: LiveNotificationType;
    stop: DemoStop;
    title: string;
    body: string;
    reason: string;
    distanceMeters: number | null;
    locationState: "arrived" | "nearby" | "away" | "unknown";
  }) {
    const decision = evaluateNotificationDecision({
      eventType: input.eventType,
      activity: toActivity(input.stop),
      history,
      activeWindow: true,
      paused: false,
      locationState: input.locationState,
      reason: input.reason,
      settings: DEMO_DECISION_SETTINGS
    });

    if (!decision.notificationSent || history.some((item) => item.key === decision.key)) return false;

    const now = new Date().toISOString();
    const eventType = companionEventTypeFor(input.eventType);

    /*
     * A demo checkpoint is considered delivered only after a real
     * web-push delivery succeeds. Failed/expired subscriptions must
     * remain retryable on later GPS updates.
     */
    const push = await sendPushNotification(
      params.supabase,
      params.userId,
      {
        tripId: params.tripId,
        eventId: null,
        type: eventType,
        title: input.title,
        body: input.body,
        actionUrl: `/trip/${params.tripId}/live?liveDemo=${encodeURIComponent(demo.sessionId)}&activity=${encodeURIComponent(input.stop.id)}`
      },
      { sendEmail: false }
    );

    lastPushResult = pushResultSummary(push);

    if ((push.sent ?? 0) <= 0) {
      return false;
    }

    const event = await params.supabase
      .from("roamly_trip_companion_events")
      .insert({
        user_id: params.userId,
        trip_id: params.tripId,
        event_type: eventType,
        title: input.title,
        body: input.body,
        scheduled_for: now,
        completed_at: now,
        status: "shown",
        metadata: {
          liveDemo: true,
          demoSessionId: demo.sessionId,
          demoStopId: input.stop.id,
          demoStopTitle: input.stop.title,
          liveNotificationType: input.eventType,
          liveNotificationKey: decision.key,
          notificationReason: input.reason,
          distanceMeters: input.distanceMeters,
          radiusMeters: input.stop.radiusMeters,
          expiresAt: demo.expiresAt
        }
      })
      .select("id,created_at")
      .maybeSingle();

    if (event.error) {
      lastEvent = {
        type: eventType,
        title: input.title,
        stopId: input.stop.id,
        createdAt: null
      };
      return false;
    }

    lastEvent = {
      type: eventType,
      title: input.title,
      stopId: input.stop.id,
      createdAt: event.data?.created_at || now
    };

    history.push({
      eventType: input.eventType,
      activityId: input.stop.id,
      sentAt: decision.eventTime,
      key: decision.key
    });

    return true;
  }

  if (insideStop && !arrivedIds.has(insideStop.id)) {
    await persistAndPush({
      eventType: "arrival",
      stop: insideStop,
      title: `You've arrived at ${insideStop.title}`,
      body: `You're inside the ${insideStop.title} demo geofence. Roamly will keep the next stop ready.`,
      reason: "demo_arrival_radius_entered",
      distanceMeters: insideStop.distanceMeters,
      locationState: "arrived"
    });
    arrivedIds.add(insideStop.id);
  }

  const latestArrivedIndex = Math.max(
    -1,
    ...demo.stops.map((stop, index) => (arrivedIds.has(stop.id) ? index : -1))
  );
  const nextStop = demo.stops[latestArrivedIndex + 1] || null;
  if (nextStop) {
    const nextDistance = distances.find((stop) => stop.id === nextStop.id)?.distanceMeters ?? null;
    await persistAndPush({
      eventType: "next_activity",
      stop: nextStop,
      title: `Up next: ${nextStop.title}`,
      body: `${nextStop.title} is the next Live Demo checkpoint.`,
      reason: "demo_up_next_after_arrival",
      distanceMeters: nextDistance,
      locationState: nextDistance == null ? "unknown" : nextDistance <= nextStop.radiusMeters ? "arrived" : nextDistance <= nextStop.radiusMeters * 2 ? "nearby" : "away"
    });
  }

  const refreshedArrivedIndex = Math.max(
    -1,
    ...demo.stops.map((stop, index) => (arrivedIds.has(stop.id) ? index : -1))
  );
  const displayNextStop = demo.stops[refreshedArrivedIndex + 1] || demo.stops[demo.stops.length - 1] || null;
  const displayDistance = displayNextStop
    ? distances.find((stop) => stop.id === displayNextStop.id)?.distanceMeters ?? null
    : null;

  if (!lastEvent) {
    const existing = events[0];
    const metadata = recordValue(existing?.metadata);
    if (existing) {
      lastEvent = {
        type: cleanString(existing.event_type, 80),
        title: cleanString(existing.title, 160),
        stopId: cleanString(metadata?.demoStopId, 80) || null,
        createdAt: cleanString(existing.created_at, 80) || null
      };
    }
  }

  return {
    ok: true as const,
    demo: {
      active: true,
      sessionId: demo.sessionId,
      expiresAt: demo.expiresAt,
      pushSubscription: "active" as const,
      activeWindow: state.activeWindow,
      nextStop: displayNextStop
        ? {
            id: displayNextStop.id,
            title: displayNextStop.title,
            radiusMeters: displayNextStop.radiusMeters,
            distanceMeters: displayDistance,
            insideGeofence: displayDistance != null && displayDistance <= displayNextStop.radiusMeters
          }
        : null,
      stops: distances.map((stop) => ({
        id: stop.id,
        title: stop.title,
        radiusMeters: stop.radiusMeters,
        distanceMeters: stop.distanceMeters,
        insideGeofence: stop.insideGeofence
      })),
      lastEvent,
      lastPushResult,
      historyError: loadedHistory.error
    }
  };
}
