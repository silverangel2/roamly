import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import {
  isStalePreTripInfoNotification,
  notificationActionState,
  notificationActionStateForInfoCard
} from "@/lib/roamly/liveCompanion";
import { INFO_NOTIFICATION_TYPES } from "@/lib/roamly/alertsNotificationTypes";
import { countAlertsBadgeNotifications } from "@/lib/roamly/alertsBadge";
import { isOpenNotificationTrip } from "@/lib/roamly/notificationTrip";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer";
import { zoneForMath } from "@/lib/roamly/tripTimezone";

/**
 * Badge endpoint, keyed by trip id (timezone round, Priority 2).
 *
 * WHY IT EXISTS: the shell used to resolve the selected trip from
 * /api/roamly/trips, a list capped at the newest 40 rows — so a
 * selected trip sitting beyond that window fell back to the rule trip
 * for the badge (only). This endpoint fetches the requested trip
 * DIRECTLY (id + user, no list window at all) and counts its unread
 * Alerts-screen alerts with the SAME semantics as the Alerts page
 * (lib/roamly/alertsBadge.ts) and the SAME timezone resolution as
 * every other day surface (metadata + destination registry, server
 * resolver). An unknown, foreign, cancelled, or archived id counts 0
 * and never renders another trip's alerts.
 *
 * GET /api/roamly/badge?tripId=<id> → { ok, tripId, unreadCount,
 * tripOpen, timezoneKnown }. Any failure → the shell shows no badge
 * (0), never a stale number.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const tripId = request.nextUrl.searchParams.get("tripId")?.trim() || "";
  if (!tripId) {
    return NextResponse.json({ ok: false, error: "tripId is required." }, { status: 400 });
  }

  const { data: trip } = await auth.supabase
    .from("roamly_trips")
    .select("id,status,itinerary_status,start_date,end_date,metadata,destination,destination_name,destination_city")
    .eq("user_id", auth.user.id)
    .eq("id", tripId)
    .maybeSingle();

  if (!trip || !isOpenNotificationTrip(trip)) {
    return NextResponse.json({ ok: true, tripId, unreadCount: 0, tripOpen: false, timezoneKnown: false });
  }

  const resolution = resolveTripTimezoneServer({
    metadata: trip.metadata,
    destination: trip.destination,
    destination_name: trip.destination_name,
    destination_city: trip.destination_city
  });
  const timezone = zoneForMath(resolution);

  const { data: rows, error } = await auth.supabase
    .from("roamly_notifications")
    .select("id,trip_id,event_id,title,body,type,status,action_url,created_at,scheduled_for")
    .eq("user_id", auth.user.id)
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const lifecycle = {
    status: trip.status ?? null,
    itineraryStatus: trip.itinerary_status ?? null,
    startDate: trip.start_date ?? null,
    endDate: trip.end_date ?? null,
    metadata: trip.metadata
  };
  const annotated = (rows || []).map((row) => {
    const type = typeof row.type === "string" ? row.type : "";
    const actionState = INFO_NOTIFICATION_TYPES.has(type)
      ? notificationActionStateForInfoCard({ actionUrl: row.action_url, trip: lifecycle })
      : notificationActionState({ actionUrl: row.action_url, trip: lifecycle });
    return {
      ...row,
      action_state: actionState,
      is_outdated: isStalePreTripInfoNotification({
        type,
        startDate: lifecycle.startDate,
        endDate: lifecycle.endDate,
        timezone
      })
    };
  });

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    unreadCount: countAlertsBadgeNotifications(annotated),
    tripOpen: true,
    timezoneKnown: resolution.known
  });
}
