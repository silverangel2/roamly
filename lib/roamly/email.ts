import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import {
  ROAMLY_PUBLIC_DOMAIN,
  escapeEmailHtml,
  renderRoamlyEmailShell
} from "@/lib/roamly/emailTemplates";

type EmailStatus = "pending" | "sent" | "failed" | "skipped";

type EmailTemplateType =
  | "welcome"
  | "contact_confirmation"
  | "support_notification"
  | "login_help"
  | "social_autopost_status"
  | "facebook_publishing_failure"
  | "weekly_automation_report"
  | "feature_announcement"
  | "newsletter"
  | "admin_test_email"
  | "general_admin_message"
  | "beta_invite"
  | "trip_reminder"
  | "live_trip_companion_reminder"
  | "support_reply"
  | "one_week_before"
  | "one_day_before"
  | "countdown_24h"
  | "travel_day_started"
  | "booking_reminder"
  | "packing_check"
  | "document_check"
  | "support_auto_reply"
  | "itinerary_email"
  | "booking_share"
  | "launch_contact_confirmation";

type SendRoamlyEmailParams = {
  to: string;
  subject: string;
  html?: string | null;
  text?: string | null;
  replyTo?: string | null;
  userId?: string | null;
  tripId?: string | null;
  notificationId?: string | null;
  metadata?: Record<string, unknown>;
};

type TemplateData = {
  subject?: string;
  preheader?: string;
  message?: string;
  tripTitle?: string | null;
  destination?: string | null;
  actionUrl?: string | null;
};

function provider() {
  return (process.env.ROAMLY_EMAIL_PROVIDER || "resend").trim().toLowerCase();
}

export function getRoamlySupportEmail() {
  return (process.env.ROAMLY_SUPPORT_EMAIL || "support@roamlyhq.com").trim();
}

export function getRoamlyFromEmail() {
  return (process.env.ROAMLY_FROM_EMAIL || getRoamlySupportEmail()).trim();
}

export function getRoamlyReplyToEmail() {
  return (process.env.ROAMLY_REPLY_TO_EMAIL || getRoamlySupportEmail()).trim();
}

function siteUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return ROAMLY_PUBLIC_DOMAIN;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function logEmail(params: SendRoamlyEmailParams & {
  status: EmailStatus;
  providerMessageId?: string | null;
  error?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  await admin
    .from("roamly_email_logs")
    .insert({
      user_id: params.userId || null,
      trip_id: params.tripId || null,
      notification_id: params.notificationId || null,
      to_email: params.to,
      subject: params.subject,
      provider: provider(),
      status: params.status,
      provider_message_id: params.providerMessageId || null,
      error: params.error || null,
      metadata: params.metadata || {},
      sent_at: params.status === "sent" ? new Date().toISOString() : null
    })
    .then((result) => {
      if (result.error && !result.error.message.includes("schema cache")) {
        console.error("[Roamly email] log failed", result.error.message);
      }
      return result;
    });
}

async function markNotificationEmail(
  notificationId: string | null | undefined,
  status: EmailStatus,
  error?: string | null
) {
  if (!notificationId) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await admin
    .from("roamly_notifications")
    .update({
      email_status: status,
      email_error: error || null,
      email_sent_at: status === "sent" ? new Date().toISOString() : null
    })
    .eq("id", notificationId)
    .then((result) => {
      if (result.error && !result.error.message.includes("schema cache")) {
        console.error("[Roamly email] notification update failed", result.error.message);
      }
      return result;
    });
}

export function isEmailConfigured() {
  const currentProvider = provider();
  const configured = currentProvider === "resend" && Boolean(process.env.RESEND_API_KEY);
  return {
    configured,
    provider: currentProvider,
    supportEmail: getRoamlySupportEmail(),
    fromEmail: getRoamlyFromEmail(),
    replyToEmail: getRoamlyReplyToEmail(),
    supportEmailConfigured: Boolean(process.env.ROAMLY_SUPPORT_EMAIL),
    fromEmailConfigured: Boolean(process.env.ROAMLY_FROM_EMAIL),
    remindersEnabled: process.env.ROAMLY_EMAIL_REMINDERS_ENABLED !== "false",
    reason: configured ? "" : currentProvider === "resend" ? "RESEND_API_KEY is missing." : "Unsupported email provider."
  };
}

export function renderEmailTemplate(type: EmailTemplateType, data: TemplateData) {
  const title = data.subject || "Roamly travel update";
  const preheader = data.preheader || "A Roamly trip reminder is ready.";
  const destination = data.destination || data.tripTitle || "your trip";
  const message = data.message || "Open Roamly to review your travel timeline and next steps.";
  const actionUrl = data.actionUrl?.startsWith("http") ? data.actionUrl : `${siteUrl()}${data.actionUrl || "/notifications"}`;
  const badge =
    type === "beta_invite"
      ? "Beta invite"
      : type === "support_auto_reply"
        ? "Support"
        : type === "launch_contact_confirmation"
          ? "Contact"
          : type === "itinerary_email"
            ? "Roamly itinerary"
            : type === "booking_share"
              ? "Booking organization"
      : type === "support_reply"
        ? "Support"
        : type.includes("packing")
          ? "Packing"
          : type.includes("document")
            ? "Documents"
            : "Trip reminder";
  const bodyHtml = `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#42526a;">${escapeEmailHtml(message)}</p>
    <p style="margin:0 0 16px;font-size:14px;font-weight:700;line-height:1.6;color:#526176;">Trip: ${escapeEmailHtml(destination)}</p>`;
  const bodyText = `${message}\n\nTrip: ${destination}`;

  return renderRoamlyEmailShell({
    subject: title,
    preheader,
    eyebrow: badge,
    title,
    bodyHtml,
    bodyText,
    ctaLabel: "Open Roamly",
    ctaUrl: actionUrl,
    supportEmail: getRoamlySupportEmail()
  });
}

export async function sendRoamlyEmail(params: SendRoamlyEmailParams) {
  const config = isEmailConfigured();
  const to = params.to.trim();

  if (!validEmail(to)) {
    await logEmail({ ...params, to, status: "failed", error: "Invalid recipient email." });
    await markNotificationEmail(params.notificationId, "failed", "Invalid recipient email.");
    return { ok: false, status: "failed" as const, error: "Invalid recipient email." };
  }

  if (!config.configured) {
    await logEmail({ ...params, to, status: "skipped", error: config.reason });
    await markNotificationEmail(params.notificationId, "skipped", config.reason);
    return { ok: false, status: "skipped" as const, error: config.reason };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: config.fromEmail,
        to: [to],
        subject: params.subject,
        html: params.html || undefined,
        text: params.text || undefined,
        reply_to: params.replyTo || config.replyToEmail
      })
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
    if (!response.ok) throw new Error(body.message || body.error || "Email provider failed.");
    await logEmail({ ...params, to, status: "sent", providerMessageId: body.id || null });
    await markNotificationEmail(params.notificationId, "sent");
    return { ok: true, status: "sent" as const, providerMessageId: body.id || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email failed.";
    await logEmail({ ...params, to, status: "failed", error: message });
    await markNotificationEmail(params.notificationId, "failed", message);
    return { ok: false, status: "failed" as const, error: message };
  }
}

export async function sendTestEmail({ to }: { to: string }) {
  const template = renderEmailTemplate("general_admin_message", {
    subject: "Roamly test email",
    preheader: "Your Roamly email provider is ready.",
    message: "This is a test email from the Roamly admin email console.",
    actionUrl: "/admin/email"
  });
  return sendRoamlyEmail({ to, subject: template.subject, html: template.html, text: template.text, metadata: { type: "test_email" } });
}

export async function sendTripReminderEmail({
  userId,
  tripId,
  notificationId
}: {
  userId: string;
  tripId?: string | null;
  notificationId?: string | null;
}) {
  if (process.env.ROAMLY_EMAIL_REMINDERS_ENABLED === "false") {
    return { ok: false, status: "skipped" as const, error: "Email reminders are disabled." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, status: "skipped" as const, error: "Supabase service role is not configured." };

  const [{ data: userResult }, { data: notification }, { data: trip }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    notificationId
      ? admin.from("roamly_notifications").select("id,title,body,type,action_url").eq("id", notificationId).maybeSingle()
      : Promise.resolve({ data: null }),
    tripId ? admin.from("roamly_trips").select("id,title,destination_name,metadata").eq("id", tripId).maybeSingle() : Promise.resolve({ data: null })
  ]);

  const to = userResult.user?.email || "";
  if (!to) {
    await markNotificationEmail(notificationId, "skipped", "User email is missing.");
    return { ok: false, status: "skipped" as const, error: "User email is missing." };
  }

  const template = renderEmailTemplate((notification?.type as EmailTemplateType) || "trip_reminder", {
    subject: notification?.title || "Roamly trip reminder",
    message: notification?.body || "Open Roamly to review your trip reminder.",
    tripTitle: trip?.title,
    destination: trip ? getTripDestinationLabel(trip) : null,
    actionUrl: notification?.action_url || (tripId ? `/trip/${tripId}/companion` : "/notifications")
  });

  return sendRoamlyEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    userId,
    tripId,
    notificationId,
    metadata: { type: "trip_reminder" }
  });
}
