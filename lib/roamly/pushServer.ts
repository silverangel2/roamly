import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTripReminderEmail } from "@/lib/roamly/email";

export type NotificationPayload = {
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  type?: string;
  tripId?: string | null;
  eventId?: string | null;
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:junel.abellana@gmail.com", publicKey, privateKey);
  return true;
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

export async function sendPushNotification(supabase: SupabaseClient, userId: string, payload: NotificationPayload) {
  const writer = createSupabaseAdminClient() || supabase;
  const configured = configureWebPush();
  const notification = await createInAppNotification(writer, {
    userId,
    tripId: payload.tripId || null,
    eventId: payload.eventId || null,
    type: payload.type || "trip_reminder",
    title: payload.title,
    body: payload.body || null,
    actionUrl: payload.actionUrl || null,
    status: "unread",
    metadata: { pushConfigured: configured, pushStatus: configured ? "pending" : "not_configured" }
  });
  const notificationId = notification.data?.id || null;
  const emailResult = notificationId
    ? await sendTripReminderEmail({
        userId,
        tripId: payload.tripId || null,
        notificationId
      }).catch((error) => ({
        ok: false,
        status: "failed" as const,
        error: error instanceof Error ? error.message : "Email reminder failed."
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

  const { data: subscriptions, error } = await writer
    .from("roamly_push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
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
    title: payload.title,
    body: payload.body || "",
    actionUrl: payload.actionUrl || "/notifications"
  });

  const results = await Promise.allSettled(
    (subscriptions || []).map((subscription) =>
      webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh || "",
            auth: subscription.auth || ""
          }
        },
        body
      )
    )
  );

  const failed = results.filter((result) => result.status === "rejected").length;
  if (notification.data?.id) {
    const firstFailure = results.find((result) => result.status === "rejected");
    await writer
      .from("roamly_notifications")
      .update({
        sent_at: failed < results.length ? new Date().toISOString() : null,
        push_status: failed < results.length ? "sent" : "failed",
        push_error:
          firstFailure && firstFailure.status === "rejected"
            ? firstFailure.reason instanceof Error
              ? firstFailure.reason.message
              : String(firstFailure.reason)
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

export async function disablePushSubscription(supabase: SupabaseClient, userId: string, endpoint?: string) {
  let query = supabase.from("roamly_push_subscriptions").update({ enabled: false }).eq("user_id", userId);
  if (endpoint) query = query.eq("endpoint", endpoint);
  return query;
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
    .limit(50);

  if (error) return { ok: false, error: error.message };
  let sent = 0;
  for (const event of events || []) {
    const tripResult = event.trip_id
      ? await supabase
          .from("roamly_trips")
          .select("tracking_unlocked")
          .eq("id", event.trip_id)
          .eq("user_id", event.user_id)
          .maybeSingle()
      : { data: null };
    if (
      event.trip_id &&
      !tripResult.data?.tracking_unlocked
    ) {
      await supabase
        .from("roamly_trip_companion_events")
        .update({ status: "skipped", completed_at: new Date().toISOString() })
        .eq("id", event.id);
      continue;
    }

    const duplicate = await supabase
      .from("roamly_notifications")
      .select("id")
      .eq("event_id", event.id)
      .limit(1)
      .maybeSingle();
    if (!duplicate.data) {
      await sendPushNotification(supabase, event.user_id, {
        title: event.title || "Roamly reminder",
        body: event.body,
        actionUrl: event.trip_id ? `/trip/${event.trip_id}/companion` : "/notifications",
        type: event.event_type,
        tripId: event.trip_id,
        eventId: event.id
      });
      sent += 1;
    }
    await supabase
      .from("roamly_trip_companion_events")
      .update({ status: "shown", completed_at: new Date().toISOString() })
      .eq("id", event.id);
  }
  return { ok: true, processed: (events || []).length, sent };
}
