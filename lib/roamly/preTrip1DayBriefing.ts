import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlySupportEmail, sendRoamlyEmail } from "@/lib/roamly/email";
import { claimCommunication, completeCommunication, failCommunication } from "@/lib/roamly/communicationOrchestration";
import { timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";
import { renderEmailBodyCopy, renderRoamlyEmailShell, toRoamlyAbsoluteUrl } from "@/lib/roamly/emailTemplates";
import { communicationLogicalKey } from "@/lib/roamly/communicationPolicy";
import { tripStartFromDate } from "@/lib/roamly/preTrip7DayBriefingContent";
import { buildPreTrip1DayBriefingContent, preTrip1DayWindow, type PreTrip1DayActivity, type PreTrip1DayBooking } from "@/lib/roamly/preTrip1DayBriefingContent";

type PreTrip1DayTrip = {
  id: string;
  user_id: string;
  destination?: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  start_date: string | null;
  end_date?: string | null;
  special_notes?: string | null;
  status?: string | null;
  itinerary_status?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function mustDoFromTrip(trip: PreTrip1DayTrip) {
  if (clean(trip.special_notes)) return clean(trip.special_notes);
  const planning = trip.metadata?.planning;
  if (!planning || typeof planning !== "object" || Array.isArray(planning)) return null;
  const value = (planning as Record<string, unknown>).specialNotes || (planning as Record<string, unknown>).special_notes;
  return typeof value === "string" ? value : null;
}

export async function schedulePreTrip1DayBriefing(params: {
  supabase: SupabaseClient;
  trip: PreTrip1DayTrip;
  bookings: PreTrip1DayBooking[];
  now?: Date;
}) {
  const db = createSupabaseAdminClient() || params.supabase;
  const now = params.now || new Date();
  const inactive = ["archived", "cancelled", "completed"].includes(clean(params.trip.status)) || clean(params.trip.itinerary_status) === "cancelled";
  if (inactive) return { ok: true as const, scheduled: false, suppressed: "TRIP_NOT_ACTIVE" as const };
  const timezone = timezoneFromTripMetadata(params.trip.metadata || {}, "UTC");
  const tripStart = tripStartFromDate(params.trip.start_date, timezone);
  if (!tripStart) return { ok: true as const, scheduled: false, suppressed: "TRIP_DATE_INVALID" as const };
  const window = preTrip1DayWindow(tripStart, now);
  if (!window.eligible) return { ok: true as const, scheduled: false, suppressed: "OUTSIDE_T1_WINDOW" as const };

  const userResult = await db.auth.admin.getUserById(params.trip.user_id);
  const recipient = userResult.data.user?.email?.trim() || "";
  if (!recipient) return { ok: true as const, scheduled: false, suppressed: "CUSTOMER_EMAIL_UNAVAILABLE" as const };
  const logicalKey = communicationLogicalKey({ userId: params.trip.user_id, tripId: params.trip.id, purpose: "pretrip_1d", occurrenceKey: "pretrip-1d" });
  const ledgerUpdate = await db
    .from("roamly_communication_ledger")
    .update({ scheduled_for: window.target.toISOString(), useful_until: window.usefulUntil.toISOString(), updated_at: now.toISOString() })
    .eq("user_id", params.trip.user_id)
    .eq("logical_key", logicalKey)
    .in("status", ["pending", "failed"]);
  if (ledgerUpdate.error) return { ok: false as const, scheduled: false, error: "PRETRIP_1D_LEDGER_UPDATE_FAILED" };
  const claim = await claimCommunication({
    supabase: db,
    userId: params.trip.user_id,
    tripId: params.trip.id,
    purpose: "pretrip_1d",
    occurrenceKey: "pretrip-1d",
    preferredChannel: "email",
    scheduledFor: window.target.toISOString(),
    usefulUntil: window.usefulUntil.toISOString(),
    metadata: { purpose: "pretrip_1d", source: "pretrip_scheduler", template: "pretrip_1d" },
    now
  });
  if (!claim.ok || !claim.claimed || !claim.communicationId || !claim.claimToken) return { ok: claim.ok, scheduled: false, status: claim.status };

  const latestTrip = await db
    .from("roamly_trips")
    .select("id,user_id,destination,destination_name,destination_city,start_date,end_date,special_notes,status,itinerary_status,tracking_unlocked,live_companion_unlocked,metadata")
    .eq("id", params.trip.id)
    .eq("user_id", params.trip.user_id)
    .maybeSingle();
  const currentTimezone = latestTrip.data ? timezoneFromTripMetadata((latestTrip.data as PreTrip1DayTrip).metadata || {}, "UTC") : timezone;
  const currentStart = latestTrip.data ? tripStartFromDate((latestTrip.data as PreTrip1DayTrip).start_date, currentTimezone) : null;
  const currentWindow = currentStart ? preTrip1DayWindow(currentStart, now) : null;
  if (latestTrip.error || !latestTrip.data || ["archived", "cancelled", "completed"].includes(clean(latestTrip.data.status)) || clean(latestTrip.data.itinerary_status) === "cancelled" || !currentWindow?.eligible) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "PRETRIP_1D_NO_LONGER_USEFUL", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "PRETRIP_1D_NO_LONGER_USEFUL" as const };
  }

  const currentTrip = latestTrip.data as PreTrip1DayTrip;
  const currentBookings = await db
    .from("roamly_bookings")
    .select("id,booking_type,booking_status,title,provider_name,start_at,check_in_at,origin,destination,traveler_confirmed")
    .eq("trip_id", currentTrip.id)
    .eq("user_id", currentTrip.user_id)
    .order("start_at", { ascending: true, nullsFirst: false });
  if (currentBookings.error) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "PRETRIP_1D_BOOKINGS_UNAVAILABLE", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "PRETRIP_1D_BOOKINGS_UNAVAILABLE" as const };
  }
  const activities = await db
    .from("roamly_activities")
    .select("id,title,scheduled_start,address,status")
    .eq("trip_id", currentTrip.id)
    .in("status", ["planned", "nearby", "checked_in"])
    .order("scheduled_start", { ascending: true, nullsFirst: false })
    .limit(10);
  if (activities.error) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "PRETRIP_1D_ACTIVITIES_UNAVAILABLE", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "PRETRIP_1D_ACTIVITIES_UNAVAILABLE" as const };
  }
  const firstActivity = (activities.data || []).find((activity) => {
    const time = activity.scheduled_start ? new Date(activity.scheduled_start).getTime() : Number.POSITIVE_INFINITY;
    return !Number.isFinite(time) || time >= currentStart!.getTime();
  }) as PreTrip1DayActivity | undefined;
  const gmail = await db
    .from("email_connections")
    .select("connection_status")
    .eq("user_id", currentTrip.user_id)
    .eq("provider", "gmail")
    .maybeSingle();
  const content = buildPreTrip1DayBriefingContent({
    destination: clean(currentTrip.destination_name) || clean(currentTrip.destination_city) || clean(currentTrip.destination) || "your trip",
    startDate: currentTrip.start_date,
    endDate: currentTrip.end_date,
    timezone: currentTimezone,
    tripStart: currentStart!,
    bookings: (currentBookings.data || []) as PreTrip1DayBooking[],
    firstActivity,
    gmailStatus: gmail.error ? null : gmail.data?.connection_status === "connected" ? "connected" : "disconnected",
    liveCompanionIncluded: currentTrip.tracking_unlocked === true || currentTrip.live_companion_unlocked === true,
    mustDo: mustDoFromTrip(currentTrip),
    tripPath: `/trip/${encodeURIComponent(currentTrip.id)}`
  });
  const rendered = renderRoamlyEmailShell({
    subject: content.subject,
    preheader: content.preheader,
    eyebrow: content.eyebrow,
    title: content.title,
    intro: content.intro,
    bodyHtml: renderEmailBodyCopy(content.body),
    bodyText: content.body,
    summaryItems: content.summaryItems,
    ctaLabel: content.ctaLabel,
    ctaUrl: toRoamlyAbsoluteUrl(content.tripPath),
    supportEmail: getRoamlySupportEmail()
  });
  const sent = await sendRoamlyEmail({
    to: recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    userId: currentTrip.user_id,
    tripId: currentTrip.id,
    idempotencyKey: claim.communicationId,
    metadata: { purpose: "pretrip_1d", template: "pretrip_1d" }
  });
  if (sent.ok) {
    await completeCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, provider: sent.provider, providerMessageId: sent.providerMessageId });
    return { ok: true as const, scheduled: true as const, sent: true as const };
  }
  await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: sent.provider === "smtp" ? "SMTP_ACCEPTANCE_UNCERTAIN" : "PRETRIP_1D_EMAIL_FAILED", retryable: sent.retryable === true, uncertainAcceptance: sent.provider === "smtp" });
  return { ok: true as const, scheduled: true as const, sent: false as const };
}
