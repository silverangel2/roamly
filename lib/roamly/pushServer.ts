import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTripReminderEmail } from "@/lib/roamly/email";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import { tripWindowState } from "@/lib/roamly/liveCompanion";

export type NotificationPayload = {
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  type?: string;
  tripId?: string | null;
  eventId?: string | null;
  appleMapsUrl?: string | null;
  googleMapsUrl?: string | null;
  citymapperUrl?: string | null;
  checkInUrl?: string | null;
  skipUrl?: string | null;
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:junel.abellana@gmail.com", publicKey, privateKey);
  return true;
}

function isExpiredSubscriptionError(error: unknown) {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: number }).statusCode)
    : 0;
  return statusCode === 404 || statusCode === 410;
}

function fieldTestUrl(tripId: string, activityId: string | null, action?: string) {
  const url = new URL(`/field-test/${encodeURIComponent(tripId)}`, "https://roamly.invalid");
  if (activityId) url.searchParams.set("activity", activityId);
  if (action) url.searchParams.set("action", action);
  return `${url.pathname}${url.search}`;
}

function activityActionUrl(tripId: string, activityId: string, action: "check-in" | "skip") {
  const route = action === "check-in" ? "/api/roamly/activities/check-in" : "/api/roamly/activities/skip";
  const url = new URL(route, "https://roamly.invalid");
  url.searchParams.set("tripId", tripId);
  url.searchParams.set("activityId", activityId);
  return `${url.pathname}${url.search}`;
}

async function secureNotificationPayload(writer: SupabaseClient, payload: NotificationPayload) {
  const tripId = payload.tripId ? String(payload.tripId).trim() : "";
  if (!tripId) return payload;
  const { data } = await writer.from("roamly_trips").select("metadata").eq("id", tripId).maybeSingle();
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  if (metadata.field_test !== true || metadata.admin_test !== true) return payload;
  const activityId = payload.actionUrl?.match(/[?&]activity=([^&]+)/)?.[1] || null;
  return {
    ...payload,
    actionUrl: fieldTestUrl(tripId, activityId),
    checkInUrl: activityId ? activityActionUrl(tripId, activityId, "check-in") : null,
    skipUrl: activityId ? activityActionUrl(tripId, activityId, "skip") : null
  };
}

export async function createInAppNotification(
  supabase: SupabaseClient,
  params: {
    userId: string;
    tripId?: string | null;
    eventId?: string | null;
    type: string;
    title: string;
    body?: string | null;
    actionUrl?: string | null;
    scheduledFor?: string | null;
    status?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const writer = createSupabaseAdminClient() || supabase;
  return writer
    .from("roamly_notifications")
    .insert({
      user_id: params.userId,
      trip_id: params.tripId || null,
      event_id: params.eventId || null,
      type: params.type,
      title: params.title,
      body: params.body || null,
      action_url: params.actionUrl || null,
      status: params.status || "unread",
      scheduled_for: params.scheduledFor || null,
      metadata: params.metadata || {}
    })
    .select("id")
    .maybeSingle();
}

export async function sendPushNotification(
  supabase: SupabaseClient,
  userId: string,
  payload: NotificationPayload,
  options: {
    sendEmail?: boolean;
    notificationId?: string | null;
    createNotification?: boolean;
    subscriptionIds?: string[];
  } = {}
) {
  const writer = createSupabaseAdminClient() || supabase;
  const securedPayload = await secureNotificationPayload(writer, payload);
  const configured = configureWebPush();
  const existingNotificationId = options.notificationId ? String(options.notificationId).trim() : "";
  const createNotification = options.createNotification !== false;
  const notification = existingNotificationId
    ? { data: { id: existingNotificationId }, error: null }
    : !createNotification
      ? { data: null, error: null }
    : await createInAppNotification(writer, {
        userId,
        tripId: securedPayload.tripId || null,
        eventId: payload.eventId || null,
        type: securedPayload.type || "trip_reminder",
        title: securedPayload.title,
        body: securedPayload.body || null,
        actionUrl: securedPayload.actionUrl || null,
        status: "unread",
        metadata: { pushConfigured: configured, pushStatus: configured ? "pending" : "not_configured" }
      });
  const notificationId = notification.data?.id || null;
  if (existingNotificationId) {
    await writer
      .from("roamly_notifications")
      .update({
        push_status: configured ? "pending" : "not_configured",
        push_error: null
      })
      .eq("id", existingNotificationId)
      .eq("user_id", userId);
  }
  const emailResult =
    options.sendEmail !== false && notificationId
      ? await sendTripReminderEmail({
          userId,
          tripId: securedPayload.tripId || null,
          notificationId
        }).catch((error) => ({
          ok: false,
          status: "failed" as const,
          error:
            error instanceof Error
              ? error.message
              : "Email reminder failed."
        }))
      : null;
  if (!configured) {
    if (notification.data?.id) {
      await writer
        .from("roamly_notifications")
        .update({ push_status: "not_configured", push_error: "Web push is not configured." })
        .eq("id", notification.data.id);
    }
    return { ok: false, error: "Web push is not configured.", notification, emailResult };
  }

  let subscriptionsQuery = writer
    .from("roamly_push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (options.subscriptionIds?.length) subscriptionsQuery = subscriptionsQuery.in("id", options.subscriptionIds);
  const { data: subscriptions, error } = await subscriptionsQuery;
  if (error) {
    if (notification.data?.id) {
      await writer.from("roamly_notifications").update({ push_status: "failed", push_error: error.message }).eq("id", notification.data.id);
    }
    return { ok: false, error: error.message, notification, emailResult };
  }

  if (!subscriptions?.length) {
    if (notification.data?.id) {
      await writer
        .from("roamly_notifications")
        .update({ push_status: "no_subscription", push_error: "No push subscription found." })
        .eq("id", notification.data.id);
    }
    return { ok: false, error: "No push subscription found.", sent: 0, failed: 0, notification, emailResult };
  }

  const body = JSON.stringify({
    title: securedPayload.title,
    body: securedPayload.body || "",
    tripId: securedPayload.tripId || null,
    eventId: securedPayload.eventId || null,
    eventType: securedPayload.type || null,
    activityId: securedPayload.actionUrl?.match(/[?&]activity=([^&]+)/)?.[1] || null,
    actionUrl: securedPayload.actionUrl || "/notifications",
    appleMapsUrl: securedPayload.appleMapsUrl || null,
    googleMapsUrl: securedPayload.googleMapsUrl || null,
    citymapperUrl: securedPayload.citymapperUrl || null,
    checkInUrl: securedPayload.checkInUrl || null,
    skipUrl: securedPayload.skipUrl || null
  });

  const results = await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh || "", auth: subscription.auth || "" } },
        body
      );
      return { ok: true as const, subscription };
    } catch (error) {
      return { ok: false as const, subscription, error };
    }
  }));

  const failed = results.filter((result) => !result.ok).length;
  const expiredEndpoints = results.filter((result) => !result.ok && isExpiredSubscriptionError(result.error)).map((result) => result.subscription.endpoint);
  if (expiredEndpoints.length) {
    await writer.from("roamly_push_subscriptions").update({ enabled: false }).in("endpoint", expiredEndpoints);
  }
  if (notification.data?.id) {
    const firstFailure = results.find((result) => !result.ok);
    await writer
      .from("roamly_notifications")
      .update({
        sent_at: failed < results.length ? new Date().toISOString() : null,
        push_status: failed < results.length ? "sent" : "failed",
        push_error:
          firstFailure && !firstFailure.ok
            ? firstFailure.error instanceof Error
              ? firstFailure.error.message
              : String(firstFailure.error)
            : null
      })
      .eq("id", notification.data.id);
  }
  return { ok: failed < results.length, failed, sent: results.length - failed, notification, emailResult };
}

export async function markNotificationRead(supabase: SupabaseClient, userId: string, notificationId: string) {
  return supabase
    .from("roamly_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId);
}

export async function disablePushSubscription(supabase: SupabaseClient, userId: string, endpoint: string) {
  return supabase
    .from("roamly_push_subscriptions")
    .update({ enabled: false })
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
}

export async function sendScheduledTripNotifications() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, error: "Supabase service role is not configured." };

  const now = new Date().toISOString();
  const { data: events, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  let sent = 0;
  const touchedTrips = new Set<string>();
  for (const event of events || []) {
    const claimed = await supabase
      .from("roamly_trip_companion_events")
      .update({ status: "processing" })
      .eq("id", event.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();

    if (claimed.error || !claimed.data) continue;

    const tripResult = event.trip_id
      ? await supabase
          .from("roamly_trips")
          .select("id,user_id,start_date,end_date,status,tracking_unlocked,live_companion_unlocked,trip_companion_status,metadata")
          .eq("id", event.trip_id)
          .eq("user_id", event.user_id)
          .maybeSingle()
      : { data: null };
    if (event.trip_id && (!tripResult.data?.tracking_unlocked && !tripResult.data?.live_companion_unlocked)) {
      await supabase
        .from("roamly_trip_companion_events")
        .update({ status: "skipped", completed_at: new Date().toISOString() })
        .eq("id", event.id);
      continue;
    }

    if (event.trip_id && tripWindowState({
      startDate: tripResult.data?.start_date,
      endDate: tripResult.data?.end_date,
      timezone: tripResult.data?.metadata?.timezone,
      now: new Date()
    }) === "completed_trip") {
      await supabase.from("roamly_trips").update({ status: "completed", trip_companion_status: "completed" }).eq("id", event.trip_id);
      await supabase.from("roamly_trip_companion_events").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", event.id);
      continue;
    }
    if (event.trip_id) {
      const tripKey = `${event.user_id}:${event.trip_id}`;
      if (touchedTrips.has(tripKey)) {
        await supabase.from("roamly_trip_companion_events").update({ status: "scheduled", scheduled_for: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", event.id).eq("status", "processing");
        continue;
      }
      touchedTrips.add(tripKey);
      const preferences = await getCompanionPreferences({ supabase, userId: event.user_id, tripId: event.trip_id });
      if (!preferences.liveCompanionEnabled) {
        await supabase.from("roamly_trip_companion_events").update({ status: "skipped", completed_at: new Date().toISOString() }).eq("id", event.id);
        continue;
      }
      if (preferences.liveCompanionPausedUntil && new Date(preferences.liveCompanionPausedUntil).getTime() > Date.now()) {
        await supabase.from("roamly_trip_companion_events").update({ status: "scheduled", scheduled_for: preferences.liveCompanionPausedUntil }).eq("id", event.id).eq("status", "processing");
        continue;
      }
    }

    const eventMetadata = event.metadata && typeof event.metadata === "object"
      ? event.metadata as Record<string, unknown>
      : {};
    const activityId = typeof eventMetadata.activityId === "string"
      ? eventMetadata.activityId
      : typeof eventMetadata.activity_id === "string"
        ? eventMetadata.activity_id
        : null;
    const liveEventTypes = new Set(["nearby_activity", "up_next_activity", "departure_reminder", "running_late", "arrival_detected"]);
    const liveNotificationType = event.event_type === "up_next_activity"
      ? "next_activity"
      : event.event_type === "departure_reminder"
        ? "leave_by"
        : event.event_type === "running_late"
          ? "late"
          : event.event_type === "arrival_detected"
            ? "arrival"
            : event.event_type;

    let delivery;
    if (event.trip_id && activityId && liveEventTypes.has(event.event_type)) {
      const { liveCompanionNotificationIdentity, queueCompanionNotification, sendCompanionNotificationDelivery } = await import("@/lib/roamly/companionNotifications");
      const queued = await queueCompanionNotification({
        supabase,
        userId: event.user_id,
        tripId: event.trip_id,
        companionEventId: event.id,
        type: liveNotificationType as "nearby_activity" | "next_activity" | "leave_by" | "late" | "arrival",
        priority: "routine",
        title: event.title || "Roamly reminder",
        body: event.body,
        actionUrl: `/trip/${event.trip_id}/live?activity=${encodeURIComponent(activityId)}`,
        metadata: { ...eventMetadata, activityId, send_email: false, source: "scheduler" },
        idempotencyKey: liveCompanionNotificationIdentity({
          userId: event.user_id,
          tripId: event.trip_id,
          activityId,
          eventType: liveNotificationType
        }),
        dedupeParts: [liveCompanionNotificationIdentity({
          userId: event.user_id,
          tripId: event.trip_id,
          activityId,
          eventType: liveNotificationType
        })]
      });
      delivery = queued.ok && queued.delivery?.id
        ? await sendCompanionNotificationDelivery(queued.delivery.id)
        : queued;
    } else {
      delivery = await sendPushNotification(supabase, event.user_id, {
      title: event.title || "Roamly reminder",
      body: event.body,
      actionUrl: event.trip_id ? `/trip/${event.trip_id}/live` : "/notifications",
      type: event.event_type,
      tripId: event.trip_id,
      eventId: event.id
      });
    }
    const pushAccepted = "sent" in delivery
      ? delivery.ok && (delivery.sent ?? 0) > 0
      : delivery.ok;
    if (pushAccepted) {
      sent += 1;
      await supabase
        .from("roamly_trip_companion_events")
        .update({ status: "shown", completed_at: new Date().toISOString() })
        .eq("id", event.id)
        .eq("status", "processing");
    } else {
      await supabase
        .from("roamly_trip_companion_events")
        .update({ status: "scheduled", scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString() })
        .eq("id", event.id)
        .eq("status", "processing");
    }
  }
  return { ok: true, processed: (events || []).length, sent };
}
