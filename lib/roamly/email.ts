import * as dns from "node:dns/promises";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import {
  ROAMLY_PUBLIC_DOMAIN,
  escapeEmailHtml,
  renderEmailBodyCopy,
  renderRoamlyEmailShell,
  toRoamlyAbsoluteUrl
} from "@/lib/roamly/emailTemplates";

type EmailStatus = "pending" | "sent" | "failed" | "skipped" | "captured";
type ActiveEmailProvider = "smtp" | "resend" | "capture" | "none";

export type EmailTemplateType =
  | "welcome"
  | "contact_confirmation"
  | "support_notification"
  | "login_help"
  | "trip_reminder"
  | "itinerary_ready"
  | "itinerary_generation_failure"
  | "facebook_autopost_failure"
  | "weekly_automation_report"
  | "billing_notification"
  | "feature_announcement"
  | "admin_test_email"
  | "social_autopost_status"
  | "facebook_publishing_failure"
  | "newsletter"
  | "general_admin_message"
  | "beta_invite"
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
  idempotencyKey?: string | null;
};

export type SendRoamlyEmailResult =
  | {
      ok: true;
      status: "sent" | "captured";
      provider: ActiveEmailProvider;
      providerMessageId: string | null;
      logId?: string | null;
      captured?: boolean;
      permanent: false;
      retryable: false;
    }
  | {
      ok: false;
      status: "failed" | "skipped";
      provider: ActiveEmailProvider;
      error: string;
      logId?: string | null;
      permanent?: boolean;
      retryable?: boolean;
    };

type TemplateData = {
  subject?: string;
  preheader?: string;
  message?: string;
  tripTitle?: string | null;
  destination?: string | null;
  actionUrl?: string | null;
};

type EmailVerificationCheck = {
  label: string;
  status: "Ready" | "Authentication failed" | "Connection failed" | "Sender configuration invalid" | "Missing variable" | "Provider unavailable" | "Not checked";
  detail?: string;
};

export type EmailVerificationResult = {
  ok: boolean;
  checkedAt: string;
  provider: ActiveEmailProvider;
  activeProviderLabel: string;
  status: "Ready" | "Authentication failed" | "Connection failed" | "Sender configuration invalid" | "Missing variable" | "Provider unavailable";
  checks: EmailVerificationCheck[];
  missingVariables: string[];
  message: string;
};

const EXPECTED_SMTP_USER = "support@roamlyhq.com";

function readEnv(key: string) {
  return (process.env[key] || "").trim();
}

function providerPreference() {
  return readEnv("ROAMLY_EMAIL_PROVIDER").toLowerCase() || "smtp";
}

function emailCaptureEnabled() {
  const currentProvider = providerPreference();
  return (
    currentProvider === "log" ||
    currentProvider === "console" ||
    /^(true|1|enabled)$/i.test(readEnv("ROAMLY_EMAIL_CAPTURE_ENABLED"))
  );
}

export function getRoamlySupportEmail() {
  return readEnv("ROAMLY_SUPPORT_EMAIL") || "support@roamlyhq.com";
}

export function getRoamlyFromEmail() {
  const senderName = readEnv("ROAMLY_FROM_NAME") || "Roamly";
  const from = readEnv("ROAMLY_FROM_EMAIL") || getRoamlySupportEmail();
  return senderName && validEmail(from) ? `${senderName} <${from}>` : from;
}

export function getRoamlyReplyToEmail() {
  return readEnv("ROAMLY_REPLY_TO_EMAIL") || getRoamlySupportEmail();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function emailAddressFromHeader(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
}

function senderDomain(value: string) {
  const address = emailAddressFromHeader(value);
  return address.includes("@") ? address.split("@").pop()?.toLowerCase() || "" : "";
}

function parsePort(value: string) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function parseBoolean(value: string, fallback = false) {
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  return fallback;
}

function getSmtpEnvironment() {
  const host = readEnv("SMTP_HOST");
  const portRaw = readEnv("SMTP_PORT");
  const port = parsePort(portRaw);
  const user = readEnv("SMTP_USER");
  const password = readEnv("SMTP_PASSWORD");
  const secure = parseBoolean(readEnv("SMTP_SECURE"), port === 465);
  const missingVariables = [
    ["SMTP_HOST", host],
    ["SMTP_PORT", portRaw],
    ["SMTP_USER", user],
    ["SMTP_PASSWORD", password]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (portRaw && !port) missingVariables.push("SMTP_PORT");

  return {
    host,
    port,
    portRaw,
    secure,
    user,
    password,
    passwordConfigured: Boolean(password),
    missingVariables: Array.from(new Set(missingVariables))
  };
}

function activeProviderLabel(provider: ActiveEmailProvider) {
  if (provider === "smtp") return "Google Workspace SMTP";
  if (provider === "resend") return "Resend";
  if (provider === "capture") return "Local capture";
  return "Not configured";
}

function resolveProvider(): ActiveEmailProvider {
  const preference = providerPreference();
  if (emailCaptureEnabled()) return "capture";
  if (preference === "smtp") return "smtp";
  if (preference === "resend") return "resend";
  return "none";
}

function isSchemaColumnMissing(message: string) {
  return /schema cache|column|template|attempt_count|last_error|idempotency_key/i.test(message);
}

function isLikelyPermanentProviderError(status: number, message: string) {
  if (status === 401 || status === 403 || status === 422) return true;
  return /\b(api key|unauthorized|forbidden|invalid|domain|sender|verified|verification|from address|authentication|auth|credentials|password)\b/i.test(message);
}

function sanitizeProviderError(error: unknown) {
  if (!(error instanceof Error)) return "Email provider failed.";
  const providerError = error as Error & { code?: unknown; responseCode?: unknown };
  const code = typeof providerError.code === "string" ? providerError.code : "";
  const responseCode =
    typeof providerError.responseCode === "number" ? providerError.responseCode : 0;

  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) return "Authentication failed.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Connection failed.";
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ECONNREFUSED") return "Connection failed.";
  if (/tls|certificate|ssl/i.test(error.message)) return "TLS connection failed.";
  if (responseCode >= 500) return "Email provider rejected the message.";
  if (responseCode >= 400) return "Temporary email provider failure.";
  return "Email provider failed.";
}

function smtpPermanent(error: unknown) {
  if (!(error instanceof Error)) return false;
  const providerError = error as Error & { code?: unknown; responseCode?: unknown };
  const code = typeof providerError.code === "string" ? providerError.code : "";
  const responseCode =
    typeof providerError.responseCode === "number" ? providerError.responseCode : 0;
  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) return true;
  if (responseCode >= 500 && responseCode < 600) return true;
  return isLikelyPermanentProviderError(responseCode, error.message);
}

function createSmtpTransporter(smtp = getSmtpEnvironment()) {
  if (!smtp.port) throw new Error("SMTP_PORT is invalid.");

  const options: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.password
    }
  };

  return nodemailer.createTransport(options);
}

function templateName(params: SendRoamlyEmailParams) {
  const value = params.metadata?.template || params.metadata?.type;
  return typeof value === "string" && value.trim() ? value.trim() : "transactional";
}

function attemptCount(params: SendRoamlyEmailParams) {
  const value = params.metadata?.attemptCount || params.metadata?.attempt_count;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value === "string" && Number.isFinite(Number(value))) return Math.max(1, Math.round(Number(value)));
  return 1;
}

async function logEmail(params: SendRoamlyEmailParams & {
  status: EmailStatus;
  providerName: ActiveEmailProvider;
  providerMessageId?: string | null;
  error?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const idempotencyKey =
    (params.idempotencyKey || (typeof params.metadata?.idempotencyKey === "string" ? params.metadata.idempotencyKey : "")).trim() || null;
  const safeError = params.error || null;
  const row: Record<string, unknown> = {
    user_id: params.userId || null,
    trip_id: params.tripId || null,
    notification_id: params.notificationId || null,
    to_email: params.to,
    subject: params.subject,
    provider: params.providerName,
    status: params.status,
    provider_message_id: params.providerMessageId || null,
    idempotency_key: idempotencyKey,
    template: templateName(params),
    attempt_count: attemptCount(params),
    error: safeError,
    last_error: safeError,
    metadata: params.metadata || {},
    sent_at: params.status === "sent" ? new Date().toISOString() : null
  };

  const result = await admin.from("roamly_email_logs").insert(row).select("id").maybeSingle();
  if (!result.error) return result.data?.id || null;

  if (!isSchemaColumnMissing(result.error.message)) {
    console.error("[Roamly email] log failed", result.error.message);
    return null;
  }

  const fallbackRow = { ...row };
  delete fallbackRow.idempotency_key;
  delete fallbackRow.template;
  delete fallbackRow.attempt_count;
  delete fallbackRow.last_error;

  const fallback = await admin.from("roamly_email_logs").insert(fallbackRow).select("id").maybeSingle();
  if (fallback.error && !fallback.error.message.includes("schema cache")) {
    console.error("[Roamly email] log failed", fallback.error.message);
  }
  return fallback.data?.id || null;
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
  const currentProvider = resolveProvider();
  const smtp = getSmtpEnvironment();
  const fromEmail = getRoamlyFromEmail();
  const fromAddress = emailAddressFromHeader(fromEmail);
  const supportEmail = getRoamlySupportEmail();
  const replyToEmail = getRoamlyReplyToEmail();
  const missingVariables = [...smtp.missingVariables];
  const smtpUserValid = validEmail(smtp.user);
  const smtpUserExpected = smtp.user.toLowerCase() === EXPECTED_SMTP_USER;
  const fromAddressValid = validEmail(fromAddress);

  let configured = false;
  let reason = "EMAIL_PROVIDER_NOT_CONFIGURED: Set ROAMLY_EMAIL_PROVIDER=smtp and configure Google Workspace SMTP.";

  if (currentProvider === "capture") {
    configured = true;
    reason = "";
  } else if (currentProvider === "smtp") {
    if (!missingVariables.length && smtpUserValid && smtpUserExpected && fromAddressValid) {
      configured = true;
      reason = "";
    } else if (missingVariables.length) {
      reason = `EMAIL_PROVIDER_NOT_CONFIGURED: Missing ${missingVariables.join(", ")}.`;
    } else if (!smtpUserValid || !smtpUserExpected) {
      reason = "EMAIL_PROVIDER_NOT_CONFIGURED: SMTP_USER must be support@roamlyhq.com.";
    } else {
      reason = "EMAIL_PROVIDER_NOT_CONFIGURED: Sender configuration invalid.";
    }
  } else if (currentProvider === "resend") {
    configured = Boolean(readEnv("RESEND_API_KEY"));
    reason = configured ? "" : "EMAIL_PROVIDER_NOT_CONFIGURED: RESEND_API_KEY is missing for optional Resend provider.";
  }

  return {
    configured,
    provider: currentProvider,
    requestedProvider: providerPreference(),
    activeProviderLabel: activeProviderLabel(currentProvider),
    captureEnabled: currentProvider === "capture",
    supportEmail,
    fromEmail,
    fromAddress,
    replyToEmail,
    supportEmailConfigured: Boolean(readEnv("ROAMLY_SUPPORT_EMAIL")),
    fromEmailConfigured: Boolean(readEnv("ROAMLY_FROM_EMAIL")),
    fromNameConfigured: Boolean(readEnv("ROAMLY_FROM_NAME")),
    senderDomain: senderDomain(fromEmail),
    senderVerificationStatus: configured ? "provider_check_required" : "not_ready",
    remindersEnabled: process.env.ROAMLY_EMAIL_REMINDERS_ENABLED !== "false",
    reason,
    missingVariables,
    smtpHost: smtp.host || null,
    smtpPort: smtp.port,
    smtpSecure: smtp.secure,
    smtpUser: smtp.user || null,
    smtpPasswordConfigured: smtp.passwordConfigured,
    smtpAuthenticationStatus: configured && currentProvider === "smtp" ? "Ready to verify" : "Not verified",
    resendConfigured: Boolean(readEnv("RESEND_API_KEY")),
    logoUrl: `${ROAMLY_PUBLIC_DOMAIN}/roamly-wordmark@2x.png`
  };
}

export async function verifyRoamlyEmailProvider(): Promise<EmailVerificationResult> {
  const checkedAt = new Date().toISOString();
  const config = isEmailConfigured();
  const smtp = getSmtpEnvironment();
  const checks: EmailVerificationCheck[] = [
    { label: "DNS resolution", status: "Not checked" },
    { label: "SMTP connection", status: "Not checked" },
    { label: "TLS connection", status: "Not checked" },
    { label: "Authentication", status: "Not checked" },
    { label: "Sender address", status: "Not checked" },
    { label: "Provider readiness", status: "Not checked" }
  ];

  function set(label: string, status: EmailVerificationCheck["status"], detail?: string) {
    const check = checks.find((item) => item.label === label);
    if (check) {
      check.status = status;
      check.detail = detail;
    }
  }

  if (config.provider !== "smtp") {
    set("Provider readiness", "Provider unavailable", "SMTP is not the selected provider.");
    return {
      ok: false,
      checkedAt,
      provider: config.provider,
      activeProviderLabel: config.activeProviderLabel,
      status: "Provider unavailable",
      checks,
      missingVariables: config.missingVariables,
      message: "Provider unavailable"
    };
  }

  if (config.missingVariables.length) {
    config.missingVariables.forEach((variable) => set(variable === "SMTP_HOST" ? "DNS resolution" : "SMTP connection", "Missing variable", variable));
    set("Provider readiness", "Missing variable", config.missingVariables.join(", "));
    return {
      ok: false,
      checkedAt,
      provider: "smtp",
      activeProviderLabel: config.activeProviderLabel,
      status: "Missing variable",
      checks,
      missingVariables: config.missingVariables,
      message: "Missing variable"
    };
  }

  if (!validEmail(config.fromAddress) || !validEmail(smtp.user) || smtp.user.toLowerCase() !== EXPECTED_SMTP_USER) {
    set("Sender address", "Sender configuration invalid", "Sender configuration invalid");
    set("Provider readiness", "Sender configuration invalid", "Sender configuration invalid");
    return {
      ok: false,
      checkedAt,
      provider: "smtp",
      activeProviderLabel: config.activeProviderLabel,
      status: "Sender configuration invalid",
      checks,
      missingVariables: [],
      message: "Sender configuration invalid"
    };
  }

  try {
    await dns.lookup(smtp.host);
    set("DNS resolution", "Ready");
  } catch {
    set("DNS resolution", "Connection failed", "Connection failed");
    set("Provider readiness", "Connection failed", "Connection failed");
    return {
      ok: false,
      checkedAt,
      provider: "smtp",
      activeProviderLabel: config.activeProviderLabel,
      status: "Connection failed",
      checks,
      missingVariables: [],
      message: "Connection failed"
    };
  }

  try {
    await createSmtpTransporter(smtp).verify();
    set("SMTP connection", "Ready");
    set("TLS connection", "Ready", smtp.secure ? "Secure SMTP" : "STARTTLS required");
    set("Authentication", "Ready");
    set("Sender address", "Ready");
    set("Provider readiness", "Ready");
    return {
      ok: true,
      checkedAt,
      provider: "smtp",
      activeProviderLabel: config.activeProviderLabel,
      status: "Ready",
      checks,
      missingVariables: [],
      message: "Ready"
    };
  } catch (error) {
    const message = sanitizeProviderError(error);
    const status = message === "Authentication failed." ? "Authentication failed" : "Connection failed";
    set("SMTP connection", status);
    set("TLS connection", status === "Connection failed" && /TLS/i.test(message) ? "Connection failed" : "Not checked");
    set("Authentication", status === "Authentication failed" ? "Authentication failed" : "Not checked");
    set("Sender address", "Ready");
    set("Provider readiness", status);
    return {
      ok: false,
      checkedAt,
      provider: "smtp",
      activeProviderLabel: config.activeProviderLabel,
      status,
      checks,
      missingVariables: [],
      message: status
    };
  }
}

export function renderEmailTemplate(type: EmailTemplateType, data: TemplateData) {
  const title = data.subject || "Roamly travel update";
  const preheader = data.preheader || "A Roamly trip update is ready.";
  const destination = data.destination || data.tripTitle || "your trip";
  const message = data.message || "Open Roamly to review your travel timeline and next steps.";
  const actionUrl = data.actionUrl?.startsWith("http") ? data.actionUrl : toRoamlyAbsoluteUrl(data.actionUrl || "/notifications");
  const badge =
    type === "welcome"
      ? "Welcome"
      : type === "contact_confirmation" || type === "launch_contact_confirmation"
        ? "Contact"
        : type === "support_notification" || type === "support_reply" || type === "support_auto_reply"
          ? "Support"
          : type === "login_help"
            ? "Login help"
            : type === "itinerary_ready" || type === "itinerary_email"
              ? "Itinerary ready"
              : type === "itinerary_generation_failure"
                ? "Generation failed"
                : type === "facebook_autopost_failure" || type === "facebook_publishing_failure"
                  ? "Facebook automation"
                  : type === "weekly_automation_report" || type === "social_autopost_status"
                    ? "Automation report"
                    : type === "billing_notification"
                      ? "Billing"
                      : type === "feature_announcement"
                        ? "Feature update"
                        : type === "beta_invite"
                          ? "Beta invite"
                          : type === "booking_share"
                            ? "Booking organization"
                            : type.includes("packing")
                              ? "Packing"
                              : type.includes("document")
                                ? "Documents"
                                : "Trip reminder";
  const bodyHtml = `${renderEmailBodyCopy(message)}
    <p style="Margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;font-weight:700;color:#475467;">Trip: ${escapeEmailHtml(destination)}</p>`;
  const bodyText = `${message}\n\nTrip: ${destination}`;

  return renderRoamlyEmailShell({
    subject: title,
    preheader,
    eyebrow: badge,
    title,
    bodyHtml,
    bodyText,
    ctaLabel: type === "itinerary_ready" || type === "itinerary_email" ? "View your itinerary" : "Open Roamly",
    ctaUrl: actionUrl,
    supportEmail: getRoamlySupportEmail()
  });
}

async function sendSmtpEmail(params: SendRoamlyEmailParams, config: ReturnType<typeof isEmailConfigured>) {
  const info = await createSmtpTransporter().sendMail({
    from: config.fromEmail,
    to: params.to,
    subject: params.subject,
    html: params.html || undefined,
    text: params.text || undefined,
    replyTo: params.replyTo || config.replyToEmail
  });

  return typeof info.messageId === "string" && info.messageId ? info.messageId : null;
}

async function sendResendEmail(params: SendRoamlyEmailParams, config: ReturnType<typeof isEmailConfigured>, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${readEnv("RESEND_API_KEY")}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [params.to],
      subject: params.subject,
      html: params.html || undefined,
      text: params.text || undefined,
      reply_to: params.replyTo || config.replyToEmail
    })
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
  if (!response.ok) {
    const message = body.message || body.error || "Email provider failed.";
    const error = new Error(message) as Error & { status?: number; permanent?: boolean };
    error.status = response.status;
    error.permanent = isLikelyPermanentProviderError(response.status, message);
    throw error;
  }
  return body.id || null;
}

export async function sendRoamlyEmail(params: SendRoamlyEmailParams): Promise<SendRoamlyEmailResult> {
  const config = isEmailConfigured();
  const to = params.to.trim();
  const idempotencyKey =
    (params.idempotencyKey || (typeof params.metadata?.idempotencyKey === "string" ? params.metadata.idempotencyKey : "")).trim();

  if (!validEmail(to)) {
    const logId = await logEmail({ ...params, to, status: "failed", providerName: config.provider, error: "Invalid recipient email." });
    await markNotificationEmail(params.notificationId, "failed", "Invalid recipient email.");
    return { ok: false, status: "failed", provider: config.provider, error: "Invalid recipient email.", logId, permanent: true, retryable: false };
  }

  if (!config.configured) {
    const logId = await logEmail({ ...params, to, status: "failed", providerName: config.provider, error: config.reason });
    await markNotificationEmail(params.notificationId, "failed", config.reason);
    return { ok: false, status: "failed", provider: config.provider, error: config.reason, logId, permanent: true, retryable: false };
  }

  if (config.captureEnabled) {
    const providerMessageId = `local-capture:${idempotencyKey || new Date().toISOString()}`;
    const logId = await logEmail({
      ...params,
      to,
      status: "captured",
      providerName: "capture",
      providerMessageId,
      error: null,
      metadata: { ...(params.metadata || {}), local_capture: true }
    });
    await markNotificationEmail(params.notificationId, "captured");
    return { ok: true, status: "captured", provider: "capture", providerMessageId, logId, captured: true, permanent: false, retryable: false };
  }

  try {
    const providerMessageId =
      config.provider === "smtp"
        ? await sendSmtpEmail({ ...params, to }, config)
        : await sendResendEmail({ ...params, to }, config, idempotencyKey);
    const logId = await logEmail({ ...params, to, status: "sent", providerName: config.provider, providerMessageId });
    await markNotificationEmail(params.notificationId, "sent");
    return { ok: true, status: "sent", provider: config.provider, providerMessageId, logId, permanent: false, retryable: false };
  } catch (error) {
    const message = config.provider === "smtp" ? sanitizeProviderError(error) : error instanceof Error ? error.message : "Email failed.";
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 0;
    const permanent =
      config.provider === "smtp"
        ? smtpPermanent(error)
        : typeof error === "object" && error !== null && "permanent" in error && typeof error.permanent === "boolean"
          ? error.permanent
          : isLikelyPermanentProviderError(status, message);
    const logId = await logEmail({ ...params, to, status: "failed", providerName: config.provider, error: message });
    await markNotificationEmail(params.notificationId, "failed", message);
    return { ok: false, status: "failed", provider: config.provider, error: message, logId, permanent, retryable: !permanent };
  }
}

export async function sendTestEmail({ to }: { to?: string | null }) {
  const recipient = (to || getRoamlySupportEmail()).trim();
  const template = renderEmailTemplate("admin_test_email", {
    subject: "Roamly test email",
    preheader: "Your Roamly Google Workspace SMTP provider is ready.",
    message: "This is a controlled test email from the Roamly admin Email Center.",
    actionUrl: "/admin/email"
  });
  return sendRoamlyEmail({
    to: recipient,
    subject: template.subject,
    html: template.html,
    text: template.text,
    metadata: { type: "admin_test_email", template: "admin_test_email", source: "admin_email_center" }
  });
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
    return { ok: false, status: "skipped" as const, provider: resolveProvider(), error: "Email reminders are disabled." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, status: "skipped" as const, provider: resolveProvider(), error: "Supabase service role is not configured." };

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
    return { ok: false, status: "skipped" as const, provider: resolveProvider(), error: "User email is missing." };
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
    metadata: { type: "trip_reminder", template: "trip_reminder" }
  });
}
