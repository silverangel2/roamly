import type { SupabaseClient } from "@supabase/supabase-js";
import { sendRoamlyEmail } from "@/lib/roamly/email";
import {
  ROAMLY_PUBLIC_DOMAIN,
  escapeEmailHtml,
  renderRoamlyEmailShell,
  toRoamlyAbsoluteUrl
} from "@/lib/roamly/emailTemplates";
import {
  getTripDestinationLabel,
  getTripDaysCount,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RoamlyTripRecord } from "@/lib/trips";

type GenerationEmailKind = "completion" | "failure";
type GenerationDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "skipped" | "captured";

type GenerationEmailState = {
  email_me_when_ready?: boolean;
  delivery_status?: GenerationDeliveryStatus | null;
  completion_email_sent_at?: string | null;
  failure_email_sent_at?: string | null;
  email_provider_message_id?: string | null;
  completion_email_provider_message_id?: string | null;
  failure_email_provider_message_id?: string | null;
  last_email_error?: string | null;
  last_email_attempt_at?: string | null;
  completion_email_status?: GenerationDeliveryStatus | null;
  completion_email_provider_id?: string | null;
  completion_email_attempt_count?: number | null;
  completion_email_last_error?: string | null;
  completion_email_next_retry_at?: string | null;
  completion_email_permanent_failure?: boolean | null;
  completion_email_idempotency_key?: string | null;
  completion_email_recipient_source?: "auth" | "profile" | null;
  completion_email_link?: string | null;
  failure_email_status?: GenerationDeliveryStatus | null;
  failure_email_provider_id?: string | null;
  failure_email_attempt_count?: number | null;
  failure_email_last_error?: string | null;
  failure_email_next_retry_at?: string | null;
  failure_email_permanent_failure?: boolean | null;
  failure_email_idempotency_key?: string | null;
  failure_email_recipient_source?: "auth" | "profile" | null;
  failure_email_link?: string | null;
};

const MAX_COMPLETION_EMAIL_ATTEMPTS = Number(process.env.ROAMLY_COMPLETION_EMAIL_MAX_ATTEMPTS || 4);
const RETRY_DELAYS_MINUTES = [5, 30, 120];

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return fallback;
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
  for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    const configured = (value || "").trim().replace(/\/$/, "");
    try {
      if (
        configured.startsWith("https://") &&
        /roamlyhq\.com$/i.test(new URL(configured).host) &&
        !/localhost|127\.0\.0\.1|\[::1\]|vercel\.app/i.test(configured)
      ) {
        return configured;
      }
    } catch {
      continue;
    }
  }
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

function itineraryUrl(tripId: string) {
  return toRoamlyAbsoluteUrl(`/trip/${tripId}?from=generation-email`, siteUrl());
}

export function renderItineraryGenerationEmail(kind: GenerationEmailKind, trip: RoamlyTripRecord) {
  const destination = getTripDestinationLabel(trip) || trip.title || "your trip";
  const dates = formatTripDates(trip);
  const days = getTripDaysCount(trip);
  const actionUrl = itineraryUrl(trip.id);
  const subject = emailSubject(kind, destination);
  const complete = kind === "completion";
  const message = complete
    ? "Your itinerary is ready. Open Roamly to review the day-by-day plan, travel blocks, and booking options."
    : "Roamly could not finish this itinerary after the allowed retries. Any saved progress remains available in your trip.";
  const accountNote = "For your privacy, sign in with the same Roamly account that created this trip before opening the itinerary.";
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#42526a;">${escapeEmailHtml(message)}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
      <tr><td style="padding:8px 0;font-weight:900;color:#102033;">Destination</td><td style="padding:8px 0;color:#42526a;">${escapeEmailHtml(destination)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:900;color:#102033;">Trip dates</td><td style="padding:8px 0;color:#42526a;">${escapeEmailHtml(dates)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:900;color:#102033;">Trip length</td><td style="padding:8px 0;color:#42526a;">${days ? `${days} days` : "Flexible"}</td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#526176;">${escapeEmailHtml(accountNote)}</p>`;
  const bodyText = `${message}\n\nDestination: ${destination}\nTrip dates: ${dates}\nTrip length: ${days ? `${days} days` : "Flexible"}\n\n${accountNote}\n\nDirect trip link: ${actionUrl}`;

  return renderRoamlyEmailShell({
    subject,
    preheader: complete ? "Your Roamly itinerary is ready." : "Roamly itinerary generation needs attention.",
    eyebrow: complete ? "Itinerary ready" : "Generation failed",
    title: subject,
    bodyHtml,
    bodyText,
    ctaLabel: complete ? "View your itinerary" : "Review trip",
    ctaUrl: actionUrl,
    supportEmail: process.env.ROAMLY_SUPPORT_EMAIL || "support@roamlyhq.com"
  });
}

function buildEmail(kind: GenerationEmailKind, trip: RoamlyTripRecord) {
  return renderItineraryGenerationEmail(kind, trip);
}

export function renderSampleItineraryGenerationEmail(kind: GenerationEmailKind = "completion") {
  const sampleTrip = {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    title: "New York",
    destination_name: "New York",
    status: "completed",
    start_date: "2026-09-10",
    end_date: "2026-09-13",
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
    metadata: {
      planning: {
        destination: "New York",
        startDate: "2026-09-10",
        endDate: "2026-09-13"
      }
    }
  } as RoamlyTripRecord;

  return renderItineraryGenerationEmail(kind, sampleTrip);
}

function idempotencyKey(tripId: string, kind: GenerationEmailKind) {
  return kind === "completion"
    ? `${tripId}:itinerary_completion_email:v1`
    : `${tripId}:itinerary_failure_email:v1`;
}

function statusField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_status" : "failure_email_status";
}

function sentAtField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_sent_at" : "failure_email_sent_at";
}

function providerField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_provider_id" : "failure_email_provider_id";
}

function attemptField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_attempt_count" : "failure_email_attempt_count";
}

function errorField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_last_error" : "failure_email_last_error";
}

function retryField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_next_retry_at" : "failure_email_next_retry_at";
}

function permanentFailureField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_permanent_failure" : "failure_email_permanent_failure";
}

function idempotencyField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_idempotency_key" : "failure_email_idempotency_key";
}

function recipientSourceField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_recipient_source" : "failure_email_recipient_source";
}

function linkField(kind: GenerationEmailKind) {
  return kind === "completion" ? "completion_email_link" : "failure_email_link";
}

function completionEmailColumnPatch(state: GenerationEmailState) {
  return {
    completion_email_status: state.completion_email_status || state.delivery_status || null,
    completion_email_sent_at: state.completion_email_sent_at || null,
    completion_email_provider_id: state.completion_email_provider_id || state.completion_email_provider_message_id || state.email_provider_message_id || null,
    completion_email_attempt_count: state.completion_email_attempt_count ?? null,
    completion_email_last_error: state.completion_email_last_error || state.last_email_error || null,
    completion_email_next_retry_at: state.completion_email_next_retry_at || null,
    completion_email_idempotency_key: state.completion_email_idempotency_key || null,
    completion_email_recipient_source: state.completion_email_recipient_source || null,
    completion_email_link: state.completion_email_link || null,
    completion_email_permanent_failure: state.completion_email_permanent_failure === true,
    completion_email_last_attempt_at: state.last_email_attempt_at || null
  };
}

function missingCompletionEmailColumns(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message || "";
  return (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    (/schema cache|column/i.test(message) && /completion_email/i.test(message))
  );
}

function fieldValue<T>(state: GenerationEmailState, field: keyof GenerationEmailState, fallback: T) {
  return (state[field] ?? fallback) as T;
}

function sentForKind(state: GenerationEmailState, kind: GenerationEmailKind) {
  return Boolean(fieldValue<string | null>(state, sentAtField(kind), null));
}

function statusForKind(state: GenerationEmailState, kind: GenerationEmailKind) {
  return fieldValue<GenerationDeliveryStatus | null>(state, statusField(kind), state.delivery_status || null);
}

function attemptsForKind(state: GenerationEmailState, kind: GenerationEmailKind) {
  return getNumber(fieldValue<number | null>(state, attemptField(kind), 0), 0);
}

function nextRetryAt(attemptCount: number) {
  const delay = RETRY_DELAYS_MINUTES[Math.min(Math.max(0, attemptCount - 1), RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(Date.now() + delay * 60_000).toISOString();
}

function retryDue(state: GenerationEmailState, kind: GenerationEmailKind) {
  if (fieldValue<boolean | null>(state, permanentFailureField(kind), null) === true) return false;
  const nextRetry = fieldValue<string | null>(state, retryField(kind), null);
  if (!nextRetry) return true;
  const time = new Date(nextRetry).getTime();
  return Number.isFinite(time) && time <= Date.now();
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

async function resolveTripOwnerEmail(admin: SupabaseClient, trip: RoamlyTripRecord) {
  const userResult = await admin.auth.admin.getUserById(trip.user_id);
  const authEmail = getString(userResult.data.user?.email);
  if (authEmail) return { email: authEmail, source: "auth" as const };

  const profileResult = await admin
    .from("roamly_profiles")
    .select("email")
    .eq("user_id", trip.user_id)
    .maybeSingle();
  const currentProfileEmail = getString(profileResult.data?.email);
  if (currentProfileEmail) return { email: currentProfileEmail, source: "profile" as const };

  const legacyProfileResult = await admin
    .from("roamly_profiles")
    .select("email")
    .eq("id", trip.user_id)
    .maybeSingle();
  const legacyProfileEmail = getString(legacyProfileResult.data?.email);
  if (legacyProfileEmail) return { email: legacyProfileEmail, source: "profile" as const };

  return { email: "", source: null };
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
      },
      ...completionEmailColumnPatch(generationEmail)
    })
    .eq("id", trip.id);
  if (error && missingCompletionEmailColumns(error)) {
    const fallback = await admin
      .from("roamly_trips")
      .update({
        metadata: {
          ...metadata,
          generationEmail
        }
      })
      .eq("id", trip.id);
    return { error: fallback.error, generationEmail };
  }
  return { error, generationEmail };
}

function alreadySent(state: GenerationEmailState, kind: GenerationEmailKind) {
  return sentForKind(state, kind) || statusForKind(state, kind) === "sent" || statusForKind(state, kind) === "captured";
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
  if (fieldValue<boolean | null>(current, permanentFailureField(params.kind), null) === true) {
    return { ok: false, status: "failed" as const, error: "Generation email has a permanent failure." };
  }
  if (!retryDue(current, params.kind)) return { ok: true, status: "skipped" as const, error: "Generation email retry is not due yet." };

  const previousAttempts = attemptsForKind(current, params.kind);
  if (previousAttempts >= MAX_COMPLETION_EMAIL_ATTEMPTS) {
    return { ok: false, status: "failed" as const, error: "Generation email retry limit reached." };
  }

  const now = new Date().toISOString();
  const nextAttemptCount = previousAttempts + 1;
  const key = idempotencyKey(trip.id, params.kind);
  const actionUrl = itineraryUrl(trip.id);
  await updateGenerationEmailMetadata(admin, trip, {
    delivery_status: "sending",
    last_email_error: null,
    last_email_attempt_at: now,
    [statusField(params.kind)]: "sending",
    [attemptField(params.kind)]: nextAttemptCount,
    [errorField(params.kind)]: null,
    [retryField(params.kind)]: null,
    [permanentFailureField(params.kind)]: null,
    [idempotencyField(params.kind)]: key,
    [linkField(params.kind)]: actionUrl
  });

  const owner = await resolveTripOwnerEmail(admin, trip);
  const to = owner.email;
  if (!to) {
    await updateGenerationEmailMetadata(admin, trip, {
      delivery_status: "failed",
      last_email_error: "Trip owner email is missing.",
      last_email_attempt_at: now,
      [statusField(params.kind)]: "failed",
      [errorField(params.kind)]: "Trip owner email is missing.",
      [retryField(params.kind)]: null,
      [permanentFailureField(params.kind)]: true
    });
    return { ok: false, status: "failed" as const, error: "Trip owner email is missing." };
  }

  const template = buildEmail(params.kind, trip);
  const result = await sendRoamlyEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    userId: trip.user_id,
    tripId: trip.id,
    idempotencyKey: key,
    metadata: {
      type: params.kind === "completion" ? "itinerary_generation_complete" : "itinerary_generation_failed",
      idempotencyKey: key,
      transactional: true,
      recipientSource: owner.source,
      actionUrl,
      template: params.kind === "completion" ? "itinerary_ready" : "itinerary_generation_failure",
      attemptCount: nextAttemptCount
    }
  });

  const latestTrip = await loadTrip(admin, params.tripId);
  if (!latestTrip) return result;
  if (result.ok) {
    const sentAt = new Date().toISOString();
    const terminalStatus = result.status === "captured" ? "captured" : "sent";
    await updateGenerationEmailMetadata(admin, latestTrip, {
      delivery_status: terminalStatus,
      email_provider_message_id: result.providerMessageId || null,
      completion_email_sent_at: params.kind === "completion" ? sentAt : current.completion_email_sent_at || null,
      failure_email_sent_at: params.kind === "failure" ? sentAt : current.failure_email_sent_at || null,
      completion_email_provider_message_id: params.kind === "completion" ? result.providerMessageId || null : current.completion_email_provider_message_id || null,
      failure_email_provider_message_id: params.kind === "failure" ? result.providerMessageId || null : current.failure_email_provider_message_id || null,
      last_email_error: null,
      last_email_attempt_at: sentAt,
      [statusField(params.kind)]: terminalStatus,
      [sentAtField(params.kind)]: sentAt,
      [providerField(params.kind)]: result.providerMessageId || null,
      [errorField(params.kind)]: null,
      [retryField(params.kind)]: null,
      [permanentFailureField(params.kind)]: null,
      [recipientSourceField(params.kind)]: owner.source,
      [linkField(params.kind)]: actionUrl
    });
  } else {
    const permanent = "permanent" in result && result.permanent === true;
    const attemptCount = nextAttemptCount;
    const retryable = !permanent && attemptCount < MAX_COMPLETION_EMAIL_ATTEMPTS;
    const error = result.error || "Email delivery failed.";
    await updateGenerationEmailMetadata(admin, latestTrip, {
      delivery_status: "failed",
      last_email_error: error,
      last_email_attempt_at: new Date().toISOString(),
      [statusField(params.kind)]: "failed",
      [errorField(params.kind)]: error,
      [retryField(params.kind)]: retryable ? nextRetryAt(attemptCount) : null,
      [permanentFailureField(params.kind)]: permanent || null,
      [recipientSourceField(params.kind)]: owner.source,
      [linkField(params.kind)]: actionUrl
    });
  }

  return result;
}

export async function finalizeStagedGenerationNotification(params: {
  tripId: string;
  kind?: GenerationEmailKind;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, status: "skipped" as const, error: "Supabase service role is not configured." };
  const trip = await loadTrip(admin, params.tripId);
  if (!trip) return { ok: false, status: "skipped" as const, error: "Trip not found." };
  const kind = params.kind || generationStatusForEmail(trip.metadata);
  if (!kind) return { ok: true, status: "skipped" as const, error: "Generation is not terminal." };
  return sendStagedGenerationEmail({ tripId: params.tripId, kind });
}

export async function sendPendingStagedGenerationEmail(tripId: string) {
  return finalizeStagedGenerationNotification({ tripId });
}
