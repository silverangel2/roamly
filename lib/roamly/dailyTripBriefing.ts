import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlySupportEmail, sendRoamlyEmail } from "@/lib/roamly/email";
import { claimCommunication, completeCommunication, failCommunication } from "@/lib/roamly/communicationOrchestration";
import { communicationLogicalKey } from "@/lib/roamly/communicationPolicy";
import { timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";
import { renderEmailBodyCopy, renderRoamlyEmailShell, toRoamlyAbsoluteUrl } from "@/lib/roamly/emailTemplates";
import { tripStartFromDate } from "@/lib/roamly/preTrip7DayBriefingContent";
import { buildDailyTripBriefingContent, dailyTripWindow, findFirstDailyEvent, type DailyTripActivity, type DailyTripBooking } from "@/lib/roamly/dailyTripBriefingContent";

type DailyTrip = {
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

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function mustDoFromTrip(trip: DailyTrip) {
  if (clean(trip.special_notes)) return clean(trip.special_notes);
  const planning = trip.metadata?.planning;
  if (!planning || typeof planning !== "object" || Array.isArray(planning)) return null;
  const value = (planning as Record<string, unknown>).specialNotes || (planning as Record<string, unknown>).special_notes;
  return typeof value === "string" ? value : null;
}

async function loadActivities(db: SupabaseClient, tripId: string) {
  return db.from("roamly_activities").select("id,title,scheduled_start,address,status").eq("trip_id", tripId).in("status", ["planned", "nearby", "checked_in"]).order("scheduled_start", { ascending: true, nullsFirst: false }).limit(50);
}

export async function scheduleDailyTripBriefing(params: { supabase: SupabaseClient; trip: DailyTrip; bookings: DailyTripBooking[]; now?: Date }) {
  const db = createSupabaseAdminClient() || params.supabase;
  const now = params.now || new Date();
  if (["archived", "cancelled", "completed"].includes(clean(params.trip.status)) || clean(params.trip.itinerary_status) === "cancelled") return { ok: true as const, scheduled: false, suppressed: "TRIP_NOT_ACTIVE" as const };
  const timezone = timezoneFromTripMetadata(params.trip.metadata || {}, "UTC");
  const tripStart = tripStartFromDate(params.trip.start_date, timezone);
  if (!tripStart) return { ok: true as const, scheduled: false, suppressed: "TRIP_DATE_INVALID" as const };
  const initialActivities = await loadActivities(db, params.trip.id);
  if (initialActivities.error) return { ok: false as const, scheduled: false, error: "DAILY_TRIP_ACTIVITIES_UNAVAILABLE" };
  const firstEvent = findFirstDailyEvent({ date: now, timezone, bookings: params.bookings, activities: (initialActivities.data || []) as DailyTripActivity[] });
  const window = dailyTripWindow({ tripStart, tripEnd: params.trip.end_date, timezone, now, firstEventAt: firstEvent });
  if (!window.eligible) return { ok: true as const, scheduled: false, suppressed: window.dayKey <= window.firstDay ? "FIRST_TRAVEL_DAY_OWNED_BY_TRAVEL_DAY" as const : "OUTSIDE_DAILY_WINDOW" as const };
  const hasUsefulData = params.bookings.some((booking) => booking.traveler_confirmed === true && !["cancelled", "expired"].includes(clean(booking.booking_status))) || (initialActivities.data || []).length > 0 || Boolean(mustDoFromTrip(params.trip));
  if (!hasUsefulData) return { ok: true as const, scheduled: false, suppressed: "QUIET_DAY" as const };
  const userResult = await db.auth.admin.getUserById(params.trip.user_id);
  const recipient = userResult.data.user?.email?.trim() || "";
  if (!recipient) return { ok: true as const, scheduled: false, suppressed: "CUSTOMER_EMAIL_UNAVAILABLE" as const };
  const occurrenceKey = `daily:${window.dayKey}`;
  const logicalKey = communicationLogicalKey({ userId: params.trip.user_id, tripId: params.trip.id, purpose: "daily_trip_briefing", occurrenceKey });
  const ledgerUpdate = await db.from("roamly_communication_ledger").update({ scheduled_for: window.target.toISOString(), useful_until: window.usefulUntil.toISOString(), updated_at: now.toISOString() }).eq("user_id", params.trip.user_id).eq("logical_key", logicalKey).in("status", ["pending", "failed"]);
  if (ledgerUpdate.error) return { ok: false as const, scheduled: false, error: "DAILY_TRIP_LEDGER_UPDATE_FAILED" };
  const claim = await claimCommunication({ supabase: db, userId: params.trip.user_id, tripId: params.trip.id, purpose: "daily_trip_briefing", occurrenceKey, preferredChannel: "email", scheduledFor: window.target.toISOString(), usefulUntil: window.usefulUntil.toISOString(), metadata: { purpose: "daily_trip_briefing", source: "pretrip_scheduler", template: "daily_trip_briefing", day: window.dayKey }, now });
  if (!claim.ok || !claim.claimed || !claim.communicationId || !claim.claimToken) return { ok: claim.ok, scheduled: false, status: claim.status };
  const latestTrip = await db.from("roamly_trips").select("id,user_id,destination,destination_name,destination_city,start_date,end_date,special_notes,status,itinerary_status,tracking_unlocked,live_companion_unlocked,metadata").eq("id", params.trip.id).eq("user_id", params.trip.user_id).maybeSingle();
  const currentTrip = latestTrip.data as DailyTrip | null;
  const currentTimezone = currentTrip ? timezoneFromTripMetadata(currentTrip.metadata || {}, "UTC") : timezone;
  const currentStart = currentTrip ? tripStartFromDate(currentTrip.start_date, currentTimezone) : null;
  const currentWindow = currentStart ? dailyTripWindow({ tripStart: currentStart, tripEnd: currentTrip?.end_date, timezone: currentTimezone, now }) : null;
  if (latestTrip.error || !currentTrip || !currentStart || ["archived", "cancelled", "completed"].includes(clean(currentTrip.status)) || clean(currentTrip.itinerary_status) === "cancelled" || !currentWindow?.eligible || currentWindow.dayKey !== window.dayKey) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "DAILY_TRIP_NO_LONGER_USEFUL", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "DAILY_TRIP_NO_LONGER_USEFUL" as const };
  }
  const currentBookings = await db.from("roamly_bookings").select("id,booking_type,booking_status,title,provider_name,start_at,check_in_at,origin,destination,traveler_confirmed").eq("trip_id", currentTrip.id).eq("user_id", currentTrip.user_id).order("start_at", { ascending: true, nullsFirst: false });
  if (currentBookings.error) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "DAILY_TRIP_BOOKINGS_UNAVAILABLE", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "DAILY_TRIP_BOOKINGS_UNAVAILABLE" as const };
  }
  const refreshedActivities = await loadActivities(db, currentTrip.id);
  if (refreshedActivities.error) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "DAILY_TRIP_ACTIVITIES_UNAVAILABLE", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "DAILY_TRIP_ACTIVITIES_UNAVAILABLE" as const };
  }
  const activities = (refreshedActivities.data || []) as DailyTripActivity[];
  const bookings = (currentBookings.data || []) as DailyTripBooking[];
  const refreshedFirst = findFirstDailyEvent({ date: now, timezone: currentTimezone, bookings, activities });
  const refreshedWindow = dailyTripWindow({ tripStart: currentStart, tripEnd: currentTrip.end_date, timezone: currentTimezone, now, firstEventAt: refreshedFirst });
  if (!refreshedWindow.eligible) {
    await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: "DAILY_TRIP_NO_LONGER_USEFUL", retryable: true });
    return { ok: true as const, scheduled: false, suppressed: "DAILY_TRIP_NO_LONGER_USEFUL" as const };
  }
  const content = buildDailyTripBriefingContent({ destination: clean(currentTrip.destination_name) || clean(currentTrip.destination_city) || clean(currentTrip.destination) || "your trip", dayKey: refreshedWindow.dayKey, timezone: currentTimezone, bookings, activities, now, mustDo: mustDoFromTrip(currentTrip), liveCompanionIncluded: currentTrip.tracking_unlocked === true || currentTrip.live_companion_unlocked === true, tripPath: `/trip/${encodeURIComponent(currentTrip.id)}/live` });
  const rendered = renderRoamlyEmailShell({ subject: content.subject, preheader: content.preheader, eyebrow: content.eyebrow, title: content.title, intro: content.intro, bodyHtml: renderEmailBodyCopy(content.body), bodyText: content.body, summaryItems: content.summaryItems, ctaLabel: content.ctaLabel, ctaUrl: toRoamlyAbsoluteUrl(content.tripPath), supportEmail: getRoamlySupportEmail() });
  const sent = await sendRoamlyEmail({ to: recipient, subject: rendered.subject, html: rendered.html, text: rendered.text, userId: currentTrip.user_id, tripId: currentTrip.id, idempotencyKey: claim.communicationId, metadata: { purpose: "daily_trip_briefing", template: "daily_trip_briefing", day: refreshedWindow.dayKey } });
  if (sent.ok) {
    await completeCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, provider: sent.provider, providerMessageId: sent.providerMessageId });
    return { ok: true as const, scheduled: true as const, sent: true as const };
  }
  await failCommunication({ supabase: db, communicationId: claim.communicationId, claimToken: claim.claimToken, errorCode: sent.provider === "smtp" ? "SMTP_ACCEPTANCE_UNCERTAIN" : "DAILY_TRIP_EMAIL_FAILED", retryable: sent.retryable === true, uncertainAcceptance: sent.provider === "smtp" });
  return { ok: true as const, scheduled: true as const, sent: false as const };
}
