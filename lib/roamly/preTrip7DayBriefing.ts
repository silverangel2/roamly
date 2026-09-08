import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlySupportEmail, sendRoamlyEmail } from "@/lib/roamly/email";
import { claimCommunication, completeCommunication, failCommunication } from "@/lib/roamly/communicationOrchestration";
import { timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";
import { renderEmailBodyCopy, renderRoamlyEmailShell, toRoamlyAbsoluteUrl } from "@/lib/roamly/emailTemplates";
import { buildPreTrip7DayBriefingContent, preTrip7DayWindow, type PreTrip7DayBooking } from "@/lib/roamly/preTrip7DayBriefingContent";
import { communicationLogicalKey } from "@/lib/roamly/communicationPolicy";

type PreTrip7DayTrip = {
  id: string;
  user_id: string;
  destination?: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  start_date: string | null;
  end_date?: string | null;
  status?: string | null;
  itinerary_status?: string | null;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function localTripStart(trip: PreTrip7DayTrip, timezone: string) {
  const date = clean(trip.start_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 9, 0));
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const actual = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(guess.getTime() + Date.UTC(year, month - 1, day, 9, 0) - actual);
}

function mustDoFromTrip(trip: PreTrip7DayTrip) {
  const planning = trip.metadata?.planning;
  if (!planning || typeof planning !== "object" || Array.isArray(planning)) return null;
  const value = (planning as Record<string, unknown>).specialNotes || (planning as Record<string, unknown>).special_notes;
  return typeof value === "string" ? value : null;
}

export async function schedulePreTrip7DayBriefing(params: {
  supabase: SupabaseClient;
  trip: PreTrip7DayTrip;
  confirmedBookings: PreTrip7DayBooking[];
  now?: Date;
}) {
  const db = createSupabaseAdminClient() || params.supabase;
  const now = params.now || new Date();
  if (["archived", "cancelled", "completed"].includes(clean(params.trip.status)) || clean(params.trip.itinerary_status) === "cancelled") return { ok: true as const, scheduled: false, suppressed: "TRIP_NOT_ACTIVE" as const };
  const timezone = timezoneFromTripMetadata(params.trip.metadata || {}, "UTC");
  const tripStart = localTripStart(params.trip, timezone);
  if (!tripStart) return { ok: true as const, scheduled: false, suppressed: "TRIP_DATE_INVALID" as const };
  const window = preTrip7DayWindow(tripStart, now);
  if (!window.eligible) return { ok: true as const, scheduled: false, suppressed: "OUTSIDE_T7_WINDOW" as const };

  const userResult = await db.auth.admin.getUserById(params.trip.user_id);
  const recipient = userResult.data.user?.email?.trim() || "";
  if (!recipient) return { ok: true as const, scheduled: false, suppressed: "CUSTOMER_EMAIL_UNAVAILABLE" as const };
  const ledgerUpdate = await db
    .from("roamly_communication_ledger")
    .update({ scheduled_for: window.target.toISOString(), useful_until: window.usefulUntil.toISOString(), updated_at: now.toISOString() })
    .eq("user_id", params.trip.user_id)
    .eq("logical_key", communicationLogicalKey({ userId: params.trip.user_id, tripId: params.trip.id, purpose: "pretrip_7d", occurrenceKey: "pretrip-7d" }))
    .in("status", ["pending", "failed"]);
  if (ledgerUpdate.error) return { ok: false as const, scheduled: false, error: "PRETRIP_7D_LEDGER_UPDATE_FAILED" };
  const claim = await claimCommunication({
    supabase: db,
    userId: params.trip.user_id,
    tripId: params.trip.id,
    purpose: "pretrip_7d",
    occurrenceKey: "pretrip-7d",
    scheduledFor: window.target.toISOString(),
    usefulUntil: window.usefulUntil.toISOString(),
    metadata: { purpose: "pretrip_7d", source: "pretrip_scheduler", template: "pretrip_7d" },
    now
  });
  if (!claim.ok || !claim.claimed || !claim.communicationId || !claim.claimToken) return { ok: claim.ok, scheduled: false, status: claim.status };

  const latestTrip = await db
    .from("roamly_trips")
    .select("id,user_id,start_date,end_date,status,itinerary_status,metadata,destination,destination_name,destination_city")
    .eq("id", params.trip.id)
    .eq("user_id", params.trip.user_id)
    .maybeSingle();
  const currentTimezone = latestTrip.data ? timezoneFromTripMetadata((latestTrip.data as PreTrip7DayTrip).metadata || {}, "UTC") : timezone;
  const currentStart = latestTrip.data ? localTripStart(latestTrip.data as PreTrip7DayTrip, currentTimezone) : null;
  const currentWindow = currentStart ? preTrip7DayWindow(currentStart, params.now || new Date()) : null;
  if (latestTrip.error || !latestTrip.data || ["archived", "cancelled", "completed"].includes(clean(latestTrip.data.status)) || clean(latestTrip.data.itinerary_status) === "cancelled" || !currentWindow?.eligible) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "PRETRIP_7D_NO_LONGER_USEFUL", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "PRETRIP_7D_NO_LONGER_USEFUL" as const };
  }

  const currentTrip = latestTrip.data as PreTrip7DayTrip;
  const currentBookings = await db
    .from("roamly_bookings")
    .select("id,booking_type,booking_status,title,provider_name,start_at,check_in_at,traveler_confirmed")
    .eq("trip_id", currentTrip.id)
    .eq("user_id", currentTrip.user_id)
    .order("start_at", { ascending: true, nullsFirst: false });
  if (currentBookings.error) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "PRETRIP_7D_BOOKINGS_UNAVAILABLE", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "PRETRIP_7D_BOOKINGS_UNAVAILABLE" as const };
  }
  const currentGmailResult = await db
    .from("email_connections")
    .select("connection_status")
    .eq("user_id", currentTrip.user_id)
    .eq("provider", "gmail")
    .maybeSingle();
  const currentContent = buildPreTrip7DayBriefingContent({
    destination: clean(currentTrip.destination_name) || clean(currentTrip.destination_city) || clean(currentTrip.destination) || "your trip",
    startDate: currentTrip.start_date,
    endDate: currentTrip.end_date,
    timezone: currentTimezone,
    confirmedBookings: (currentBookings.data || []) as PreTrip7DayBooking[],
    gmailStatus: currentGmailResult.error ? null : currentGmailResult.data?.connection_status === "connected" ? "connected" : "disconnected",
    mustDo: mustDoFromTrip(currentTrip),
    tripPath: `/trip/${encodeURIComponent(currentTrip.id)}`
  });

  const rendered = renderRoamlyEmailShell({
    subject: currentContent.subject,
    preheader: currentContent.preheader,
    eyebrow: currentContent.eyebrow,
    title: currentContent.title,
    intro: currentContent.intro,
    bodyHtml: renderEmailBodyCopy(currentContent.body),
    bodyText: currentContent.body,
    summaryItems: currentContent.summaryItems,
    ctaLabel: currentContent.ctaLabel,
    ctaUrl: toRoamlyAbsoluteUrl(currentContent.tripPath),
    supportEmail: getRoamlySupportEmail()
  });
  const sent = await sendRoamlyEmail({
    to: recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    userId: params.trip.user_id,
    tripId: params.trip.id,
    idempotencyKey: claim.communicationId,
    metadata: { purpose: "pretrip_7d", template: "pretrip_7d" }
  });
  if (sent.ok) {
    await completeCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, provider: sent.provider, providerMessageId: sent.providerMessageId });
    return { ok: true as const, scheduled: true as const, sent: true as const };
  }
  await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: sent.provider === "smtp" ? "SMTP_ACCEPTANCE_UNCERTAIN" : "PRETRIP_7D_EMAIL_FAILED", retryable: sent.retryable === true, uncertainAcceptance: sent.provider === "smtp" });
  return { ok: true as const, scheduled: true as const, sent: false as const };
}
