import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendRoamlyEmail } from "@/lib/roamly/email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CompanionNotificationType =
  | "booking_detected"
  | "booking_confirmed"
  | "flight_delay"
  | "flight_cancelled"
  | "booking_changed"
  | "repair_proposed"
  | "repair_applied"
  | "approval_required"
  | "daily_briefing"
  | "final_day_briefing"
  | "check_in_reminder"
  | "trip_completed"
  | "feedback_request";

export type CompanionNotificationPriority =
  | "critical"
  | "important"
  | "routine"
  | "minor";

type QueueCompanionNotificationParams = {
  supabase: SupabaseClient;
  userId: string;
  tripId?: string | null;
  bookingId?: string | null;
  companionEventId?: string | null;
  repairProposalId?: string | null;
  type: CompanionNotificationType;
  priority: CompanionNotificationPriority;
  title: string;
  body: string;
  actionLabel?: string | null;
  actionUrl?: string | null;
  scheduledFor?: string | null;
  isTest?: boolean;
  metadata?: Record<string, unknown>;
  dedupeParts?: unknown[];
};

type DeliveryRow = {
  id: string;
  user_id: string;
  trip_id: string | null;
  booking_id: string | null;
  companion_event_id: string | null;
  repair_proposal_id: string | null;
  notification_id: string | null;
  notification_type: CompanionNotificationType;
  priority: CompanionNotificationPriority;
  title: string;
  body: string;
  action_label: string | null;
  action_url: string | null;
  status: string;
  idempotency_key: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  is_test: boolean;
  metadata_json: Record<string, unknown> | null;
};

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function absoluteUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.ROAMLY_APP_URL ||
    "https://roamlyhq.com";

  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function renderCompanionEmail(delivery: DeliveryRow): {
  subject: string;
  html: string;
  text: string;
} {
  const subjectPrefix = delivery.is_test ? "[TEST] " : "";
  const subject = `${subjectPrefix}${delivery.title}`;
  const actionUrl = absoluteUrl(delivery.action_url);

  const actionHtml =
    actionUrl && delivery.action_label
      ? `
        <p style="margin:24px 0 0">
          <a
            href="${escapeHtml(actionUrl)}"
            style="display:inline-block;padding:13px 18px;border-radius:14px;background:#0f6f8f;color:#fff;text-decoration:none;font-weight:700"
          >
            ${escapeHtml(delivery.action_label)}
          </a>
        </p>
      `
      : "";

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f6f8fa;font-family:Arial,sans-serif;color:#17212b">
        <div style="max-width:600px;margin:0 auto;padding:24px">
          <div style="background:#fff;border:1px solid #e5e9ed;border-radius:20px;padding:24px">
            <p style="margin:0 0 8px;color:#0f6f8f;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">
              Roamly Companion
            </p>
            <h1 style="margin:0;font-size:24px;line-height:1.25">
              ${escapeHtml(delivery.title)}
            </h1>
            <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#44515c">
              ${escapeHtml(delivery.body)}
            </p>
            ${actionHtml}
          </div>
          <p style="margin:14px 4px 0;font-size:12px;line-height:1.5;color:#7a8791">
            Roamly sends travel-service messages for active trips. Marketing preferences are managed separately.
          </p>
        </div>
      </body>
    </html>
  `;

  const text = [
    delivery.title,
    "",
    delivery.body,
    actionUrl && delivery.action_label
      ? `\n${delivery.action_label}: ${actionUrl}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(3600, 60 * Math.pow(2, Math.max(0, attempt - 1)));
}

export async function queueCompanionNotification(
  params: QueueCompanionNotificationParams
) {
  const idempotencyKey = hash([
    "roamly_companion_notification",
    params.userId,
    params.tripId || null,
    params.type,
    params.companionEventId || null,
    params.repairProposalId || null,
    ...(params.dedupeParts || [])
  ]);

  // Claim the unique delivery row before creating the in-app notification.
  // A read-then-insert sequence creates duplicate notifications when two cron
  // workers overlap. The unique idempotency index is the concurrency guard.
  const deliveryInsert = await params.supabase
    .from("roamly_companion_notification_deliveries")
    .insert({
      user_id: params.userId,
      trip_id: params.tripId || null,
      booking_id: params.bookingId || null,
      companion_event_id: params.companionEventId || null,
      repair_proposal_id: params.repairProposalId || null,
      notification_id: null,
      notification_type: params.type,
      priority: params.priority,
      channel: "email",
      title: params.title,
      body: params.body,
      action_label: params.actionLabel || null,
      action_url: params.actionUrl || null,
      status: "queued",
      idempotency_key: idempotencyKey,
      scheduled_for: params.scheduledFor || new Date().toISOString(),
      next_attempt_at: params.scheduledFor || new Date().toISOString(),
      is_test: params.isTest === true,
      metadata_json: params.metadata || {}
    })
    .select("*")
    .single();

  if (deliveryInsert.error) {
    if (deliveryInsert.error.code === "23505") {
      const existing = await params.supabase
        .from("roamly_companion_notification_deliveries")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing.data) {
        return { ok: true as const, delivery: existing.data, deduplicated: true };
      }
    }
    return {
      ok: false as const,
      error: deliveryInsert.error.message
    };
  }

  const notificationInsert = await params.supabase
    .from("roamly_notifications")
    .insert({
      user_id: params.userId,
      trip_id: params.tripId || null,
      event_id: params.companionEventId || null,
      title: params.title,
      body: params.body,
      type: params.type,
      action_url: params.actionUrl || null,
      status: "unread"
    })
    .select("id")
    .single();

  if (notificationInsert.error) {
    await params.supabase
      .from("roamly_companion_notification_deliveries")
      .update({ status: "suppressed", suppression_reason: "In-app notification could not be created." })
      .eq("id", deliveryInsert.data.id)
      .eq("idempotency_key", idempotencyKey);
    return { ok: false as const, error: notificationInsert.error.message };
  }

  const linked = await params.supabase
    .from("roamly_companion_notification_deliveries")
    .update({ notification_id: notificationInsert.data.id })
    .eq("id", deliveryInsert.data.id)
    .eq("idempotency_key", idempotencyKey)
    .select("*")
    .single();

  if (linked.error) {
    return { ok: false as const, error: linked.error.message };
  }

  return {
    ok: true as const,
    delivery: linked.data,
    deduplicated: false
  };
}

export async function sendCompanionNotificationDelivery(
  deliveryId: string
) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      ok: false as const,
      error: "Supabase service role is not configured."
    };
  }

  const deliveryResult = await admin
    .from("roamly_companion_notification_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .maybeSingle();

  if (deliveryResult.error) {
    return {
      ok: false as const,
      error: deliveryResult.error.message
    };
  }

  if (!deliveryResult.data) {
    return {
      ok: false as const,
      error: "COMPANION_DELIVERY_NOT_FOUND"
    };
  }

  const delivery = deliveryResult.data as DeliveryRow;

  if (
    ["sent", "delivered", "captured", "suppressed", "deduplicated"].includes(
      delivery.status
    )
  ) {
    return {
      ok: true as const,
      delivery,
      alreadyFinished: true
    };
  }

  const userResult = await admin.auth.admin.getUserById(delivery.user_id);
  const recipient = userResult.data.user?.email || "";

  if (!recipient) {
    await admin
      .from("roamly_companion_notification_deliveries")
      .update({
        status: "suppressed",
        suppression_reason: "User email is missing."
      })
      .eq("id", delivery.id);

    return {
      ok: false as const,
      error: "User email is missing."
    };
  }

  if (delivery.attempt_count >= delivery.max_attempts) {
    return { ok: false as const, error: "COMPANION_DELIVERY_ATTEMPTS_EXHAUSTED", alreadyFinished: true };
  }

  // Claim the row atomically. If another worker claimed it first, do not send
  // a second email. Resend and local capture also receive the same idempotency
  // key, covering the crash window after provider acceptance.
  const claimed = await admin
    .from("roamly_companion_notification_deliveries")
    .update({
      status: "sending",
      attempt_count: delivery.attempt_count + 1,
      last_error: null
    })
    .eq("id", delivery.id)
    .eq("status", delivery.status)
    .eq("attempt_count", delivery.attempt_count)
    .select("*")
    .maybeSingle();

  if (claimed.error) return { ok: false as const, error: claimed.error.message };
  if (!claimed.data) return { ok: true as const, alreadyClaimed: true };

  const claimedDelivery = claimed.data as DeliveryRow;
  const claimedAttempt = claimedDelivery.attempt_count;

  const template = renderCompanionEmail(claimedDelivery);

  const result = await sendRoamlyEmail({
    to: recipient,
    subject: template.subject,
    html: template.html,
    text: template.text,
    userId: claimedDelivery.user_id,
    tripId: claimedDelivery.trip_id,
    notificationId: claimedDelivery.notification_id,
    idempotencyKey: claimedDelivery.idempotency_key,
    metadata: {
      type: claimedDelivery.notification_type,
      template: "companion_transactional",
      deliveryId: claimedDelivery.id,
      isTest: claimedDelivery.is_test,
      ...(claimedDelivery.metadata_json || {})
    }
  });

  if (result.ok) {
    const status = result.status === "captured" ? "captured" : "sent";

    await admin
      .from("roamly_companion_notification_deliveries")
      .update({
        status,
        provider_name: result.provider,
        provider_message_id: result.providerMessageId || null,
        sent_at: new Date().toISOString(),
        last_error: null
      })
      .eq("id", claimedDelivery.id)
      .eq("status", "sending");

    return { ok: true as const, result };
  }

  const nextAttempt = new Date(
    Date.now() +
      retryDelaySeconds(claimedAttempt) * 1000
  ).toISOString();

  const exhausted =
    result.permanent ||
    claimedAttempt >= claimedDelivery.max_attempts;

  await admin
    .from("roamly_companion_notification_deliveries")
    .update({
      status: exhausted ? "failed" : "retrying",
      next_attempt_at: exhausted ? claimedDelivery.next_attempt_at : nextAttempt,
      failed_at: exhausted ? new Date().toISOString() : null,
      last_error: result.error || "Email failed.",
      provider_name: result.provider
    })
    .eq("id", claimedDelivery.id)
    .eq("status", "sending");

  return {
    ok: false as const,
    error: result.error || "Email failed.",
    retryable: !exhausted
  };
}

export async function processQueuedCompanionNotifications(params?: {
  limit?: number;
}) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      ok: false as const,
      error: "Supabase service role is not configured."
    };
  }

  const now = new Date().toISOString();
  const staleSendingAt = new Date(Date.now() - 15 * 60_000).toISOString();
  await admin
    .from("roamly_companion_notification_deliveries")
    .update({ status: "retrying", next_attempt_at: now, last_error: "Recovered stale sending claim." })
    .eq("status", "sending")
    .lt("updated_at", staleSendingAt);
  const limit = Math.max(1, Math.min(params?.limit || 20, 100));

  const queued = await admin
    .from("roamly_companion_notification_deliveries")
    .select("id")
    .in("status", ["queued", "retrying"])
    .lte("scheduled_for", now)
    .lte("next_attempt_at", now)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (queued.error) {
    return {
      ok: false as const,
      error: queued.error.message
    };
  }

  const results = [];

  for (const row of queued.data || []) {
    results.push({
      id: row.id,
      result: await sendCompanionNotificationDelivery(row.id)
    });
  }

  return {
    ok: true as const,
    processed: results.length,
    results
  };
}
