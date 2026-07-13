import type { SupabaseClient } from "@supabase/supabase-js";
import { sendRoamlyEmail } from "@/lib/roamly/email";
import {
  ROAMLY_PUBLIC_DOMAIN,
  escapeEmailHtml,
  renderRoamlyEmailShell
} from "@/lib/roamly/emailTemplates";
import {
  getTripDestinationLabel,
  getTripDaysCount,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RoamlyTripRecord } from "@/lib/trips";

type GenerationEmailKind = "completion" | "failure";

type GenerationEmailState = {
  email_me_when_ready?: boolean;
  delivery_status?: "pending" | "sending" | "sent" | "failed" | "skipped" | null;
  completion_email_sent_at?: string | null;
  failure_email_sent_at?: string | null;
  email_provider_message_id?: string | null;
  completion_email_provider_message_id?: string | null;
  failure_email_provider_message_id?: string | null;
  last_email_error?: string | null;
  last_email_attempt_at?: string | null;
};

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getMetadata(trip: RoamlyTripRecord) {
  return getRecord(trip.metadata) || {};
}

export function getGenerationEmailStatus(metadata: unknown): GenerationEmailState & { email_me_when_ready: boolean } {
  const root = getRecord(metadata);
  const state = getRecord(root?.generationEmail) as GenerationEmailState | null;
  return {
    ...(state || {}),
    email_me_when_ready: state?.email_me_when_ready !== false
  };
}

function siteUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return ROAMLY_PUBLIC_DOMAIN;
}

function formatTripDates(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const start = getString(trip.start_date) || getString(planning.startDate) || getString(planning.start_date);
  const end = getString(trip.end_date) || getString(planning.endDate) || getString(planning.end_date);
  if (start && end && start !== end) return `${start} to ${end}`;
  return start || end || "Flexible dates";
}

function emailSubject(kind: GenerationEmailKind, destination: string) {
  return kind === "completion"
    ? `Your Roamly itinerary for ${destination} is ready`
    : `Roamly could not finish your ${destination} itinerary`;
}

function buildEmail(kind: GenerationEmailKind, trip: RoamlyTripRecord) {
  const destination = getTripDestinationLabel(trip) || trip.title || "your trip";
  const dates = formatTripDates(trip);
  const days = getTripDaysCount(trip);
  const actionUrl = `${siteUrl()}/trip/${trip.id}?from=generation-email`;
  const subject = emailSubject(kind, destination);
  const complete = kind === "completion";
  const message = complete
    ? "Your itinerary is ready. Open Roamly to review the day-by-day plan, travel blocks, and booking options."
    : "Roamly could not finish this itinerary after the allowed retries. Any saved progress remains available in your trip.";
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#42526a;">${escapeEmailHtml(message)}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
      <tr><td style="padding:8px 0;font-weight:900;color:#102033;">Destination</td><td style="padding:8px 0;color:#42526a;">${escapeEmailHtml(destination)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:900;color:#102033;">Trip dates</td><td style="padding:8px 0;color:#42526a;">${escapeEmailHtml(dates)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:900;color:#102033;">Trip length</td><td style="padding:8px 0;color:#42526a;">${days ? `${days} days` : "Flexible"}</td></tr>
    </table>`;
  const bodyText = `${message}\n\nDestination: ${destination}\nTrip dates: ${dates}\nTrip length: ${days ? `${days} days` : "Flexible"}`;

  return renderRoamlyEmailShell({
    subject,
    preheader: complete ? "Your Roamly itinerary is ready." : "Roamly itinerary generation needs attention.",
    eyebrow: complete ? "Itinerary ready" : "Generation failed",
    title: subject,
    bodyHtml,
    bodyText,
    ctaLabel: complete ? "Open itinerary" : "Review trip",
    ctaUrl: actionUrl,
    supportEmail: process.env.ROAMLY_SUPPORT_EMAIL || "support@roamlyhq.com"
  });
}

async function loadTrip(admin: SupabaseClient, tripId: string) {
  const { data, error } = await admin
    .from("roamly_trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RoamlyTripRecord;
}

async function updateGenerationEmailMetadata(
  admin: SupabaseClient,
  trip: RoamlyTripRecord,
  patch: GenerationEmailState
) {
  const metadata = getMetadata(trip);
  const current = getGenerationEmailStatus(metadata);
  const generationEmail = {
    ...current,
    ...patch,
    email_me_when_ready: current.email_me_when_ready !== false
  };
  const { error } = await admin
    .from("roamly_trips")
    .update({
      metadata: {
        ...metadata,
        generationEmail
      }
    })
    .eq("id", trip.id);
  return { error, generationEmail };
}

function alreadySent(state: GenerationEmailState, kind: GenerationEmailKind) {
  return kind === "completion" ? Boolean(state.completion_email_sent_at) : Boolean(state.failure_email_sent_at);
}

function recentlySending(state: GenerationEmailState) {
  if (state.delivery_status !== "sending" || !state.last_email_attempt_at) return false;
  const started = new Date(state.last_email_attempt_at).getTime();
  return Number.isFinite(started) && Date.now() - started < 10 * 60_000;
}

function generationStatusForEmail(metadata: unknown): GenerationEmailKind | null {
  const generation = getRecord(getRecord(metadata)?.generation);
  const status = getString(generation?.status);
  if (status === "complete") return "completion";
  if (status === "failed" || status === "partially_failed") return "failure";
  return null;
}

export async function sendStagedGenerationEmail(params: {
  tripId: string;
  kind: GenerationEmailKind;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, status: "skipped" as const, error: "Supabase service role is not configured." };

  const trip = await loadTrip(admin, params.tripId);
  if (!trip) return { ok: false, status: "skipped" as const, error: "Trip not found." };

  const current = getGenerationEmailStatus(trip.metadata);
  if (current.email_me_when_ready === false) return { ok: false, status: "skipped" as const, error: "Email notification disabled." };
  if (alreadySent(current, params.kind)) return { ok: true, status: "skipped" as const, error: "Generation email already sent." };
  if (recentlySending(current)) return { ok: true, status: "skipped" as const, error: "Generation email is already being sent." };

  const now = new Date().toISOString();
  await updateGenerationEmailMetadata(admin, trip, {
    delivery_status: "sending",
    last_email_error: null,
    last_email_attempt_at: now
  });

  const userResult = await admin.auth.admin.getUserById(trip.user_id);
  const to = userResult.data.user?.email || "";
  if (!to) {
    await updateGenerationEmailMetadata(admin, trip, {
      delivery_status: "skipped",
      last_email_error: "Trip owner email is missing.",
      last_email_attempt_at: now
    });
    return { ok: false, status: "skipped" as const, error: "Trip owner email is missing." };
  }

  const template = buildEmail(params.kind, trip);
  const result = await sendRoamlyEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    userId: trip.user_id,
    tripId: trip.id,
    metadata: {
      type: params.kind === "completion" ? "itinerary_generation_complete" : "itinerary_generation_failed",
      idempotencyKey: `${trip.id}:generation:${params.kind}`,
      transactional: true
    }
  });

  const latestTrip = await loadTrip(admin, params.tripId);
  if (!latestTrip) return result;
  if (result.ok) {
    const sentAt = new Date().toISOString();
    await updateGenerationEmailMetadata(admin, latestTrip, {
      delivery_status: "sent",
      email_provider_message_id: result.providerMessageId || null,
      completion_email_sent_at: params.kind === "completion" ? sentAt : current.completion_email_sent_at || null,
      failure_email_sent_at: params.kind === "failure" ? sentAt : current.failure_email_sent_at || null,
      completion_email_provider_message_id: params.kind === "completion" ? result.providerMessageId || null : current.completion_email_provider_message_id || null,
      failure_email_provider_message_id: params.kind === "failure" ? result.providerMessageId || null : current.failure_email_provider_message_id || null,
      last_email_error: null,
      last_email_attempt_at: sentAt
    });
  } else {
    await updateGenerationEmailMetadata(admin, latestTrip, {
      delivery_status: result.status,
      last_email_error: result.error || "Email delivery failed.",
      last_email_attempt_at: new Date().toISOString()
    });
  }

  return result;
}

export async function sendPendingStagedGenerationEmail(tripId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, status: "skipped" as const, error: "Supabase service role is not configured." };
  const trip = await loadTrip(admin, tripId);
  if (!trip) return { ok: false, status: "skipped" as const, error: "Trip not found." };
  const kind = generationStatusForEmail(trip.metadata);
  if (!kind) return { ok: true, status: "skipped" as const, error: "Generation is not terminal." };
  return sendStagedGenerationEmail({ tripId, kind });
}
