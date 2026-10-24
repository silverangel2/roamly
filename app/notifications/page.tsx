import { redirect } from "next/navigation";
import { ActiveTripPanel } from "@/components/roamly/ActiveTripPanel";
import { CheckedActivitiesList } from "@/components/roamly/CheckedActivitiesList";
import { CurrentDayTimeline } from "@/components/roamly/CurrentDayTimeline";
import { NearbyActivityCard } from "@/components/roamly/NearbyActivityCard";
import { NotificationTimelineCard } from "@/components/roamly/NotificationTimelineCard";
import { TripActivationBanner } from "@/components/roamly/TripActivationBanner";
import { UpNextActivityCard } from "@/components/roamly/UpNextActivityCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getCheckedActivities,
  getCurrentDayRecord,
  getUpNextActivity,
  type TripNotificationPayload,
  type TrackingActivity
} from "@/lib/roamly/tripActivation";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { dedupeEquivalentNotifications, notificationActionState, timezoneFromTripMetadata, tripWindowState } from "@/lib/roamly/liveCompanion";
import { NotificationShellStateBridge } from "@/components/roamly/NotificationShellStateBridge";
import { selectNotificationTrip, tripCompanionUnlocked } from "@/lib/roamly/notificationTrip";
import type { TrackingTrip } from "@/lib/roamly/tripActivation";
import { hasConfirmedFlightBooking, shouldSuppressFlightFraming, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";
import { getTripDestinationLabel, getTripOriginLabel } from "@/lib/roamly/tripMetadata";

export default async function NotificationsPage() {
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect("/login?next=/notifications");

  if (!current.configured || !current.user) {
    return (
      <div className="calm-bleed mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <h1 className="text-[26px] font-bold tracking-[-0.018em] text-chead">Notifications need an account.</h1>
          <div className="mt-5">
            <Button href="/login?next=/notifications">Log in</Button>
          </div>
        </Card>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const [tripRows, notifications, companionDeliveries, unreadNotifications] =
    await Promise.all([
      supabase.from("roamly_trips").select("*").eq("user_id", current.user.id).order("start_date", { ascending: false }).limit(40),
      supabase
        .from("roamly_notifications")
        .select("id,trip_id,event_id,title,body,type,status,action_url,created_at,scheduled_for")
        .eq("user_id", current.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("roamly_companion_notification_deliveries")
        .select("notification_id,status,channel,created_at")
        .eq("user_id", current.user.id)
        .not("notification_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("roamly_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", current.user.id)
        .neq("status", "read")
    ]);

  const latestDeliveryByNotification = new Map<
    string,
    { status: string; channel: string | null }
  >();

  for (const delivery of companionDeliveries.data || []) {
    if (
      delivery.notification_id &&
      !latestDeliveryByNotification.has(
        delivery.notification_id
      )
    ) {
      latestDeliveryByNotification.set(
        delivery.notification_id,
        { status: delivery.status, channel: delivery.channel || null }
      );
    }
  }

  const rawNotificationItems = (
    notifications.data || []
  ).map((notification) => {
    const delivery = latestDeliveryByNotification.get(notification.id);
    return {
      ...notification,
      delivery_status: delivery?.status || null,
      delivery_channel: delivery?.channel || null
    };
  });

  const trip = selectNotificationTrip((tripRows.data || []) as TrackingTrip[]);
  const companionOn = tripCompanionUnlocked(trip);
  const notificationTripIds = [...new Set(rawNotificationItems.map((item) => item.trip_id).filter((id): id is string => Boolean(id)))];
  const tripRowsResult = notificationTripIds.length
    ? await supabase
        .from("roamly_trips")
        .select("id,status,itinerary_status,start_date,end_date,metadata")
        .eq("user_id", current.user.id)
        .in("id", notificationTripIds)
    : { data: [], error: null };
  const tripById = new Map((tripRowsResult.data || []).map((row) => [row.id, row]));
  const notificationItems = dedupeEquivalentNotifications(rawNotificationItems).filter((notification) => trip ? notification.trip_id === trip.id : false).map((notification) => {
    const relatedTrip = notification.trip_id ? tripById.get(notification.trip_id) : null;
    const actionState = notificationActionState({
      actionUrl: notification.action_url,
      trip: relatedTrip ? {
        status: relatedTrip.status,
        itineraryStatus: relatedTrip.itinerary_status,
        startDate: relatedTrip.start_date,
        endDate: relatedTrip.end_date,
        metadata: relatedTrip.metadata
      } : null
    });
    return {
      ...notification,
      action_url: actionState === "available" ? notification.action_url : null,
      action_state: actionState
    };
  });

  if (!trip) {
    return (
      <div className="calm-bleed mx-auto w-full max-w-4xl px-4 pb-8 pt-5 sm:px-6">
        <NotificationShellStateBridge activeTripId="" unreadCount={unreadNotifications.count || 0} />
        <section className="mb-6">
          <NotificationTimelineCard initialItems={notificationItems} />
        </section>
        <Card>
          <h1 className="text-[26px] font-bold tracking-[-0.018em] text-chead">No current trip to show.</h1>
          <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
            Reminders and check-ins stay with the trip they belong to. Open a trip to see its own updates.
          </p>
          <div className="mt-5">
            <Button href="/dashboard">Open dashboard</Button>
          </div>
        </Card>
      </div>
    );
  }

  const [currentDay, checked, upNext, nearbyRows, events] = await Promise.all([
    getCurrentDayRecord(supabase, trip),
    getCheckedActivities(supabase, trip.id),
    getUpNextActivity(supabase, trip.id),
    supabase
      .from("roamly_activities")
      .select("*")
      .eq("trip_id", trip.id)
      .eq("status", "nearby")
      .order("sort_order")
      .limit(8),
    supabase
      .from("roamly_trip_events")
      .select("id,event_type,event_title,event_body,created_at")
      .eq("user_id", current.user.id)
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const nearbyActivities = (nearbyRows.data || []) as TrackingActivity[];
  const tripWindow = tripWindowState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: timezoneFromTripMetadata(trip.metadata)
  });
  const tripStarted = tripWindow === "active";
  const bookingRows = await supabase
    .from("roamly_bookings")
    .select("booking_type,category,booking_status")
    .eq("trip_id", trip.id)
    .eq("user_id", current.user.id);
  const presentation: TrackingPresentation = {
    origin: getTripOriginLabel(trip),
    destination: getTripDestinationLabel(trip) || trip.destination_city || trip.destination_name || "",
    suppressFlightFraming: bookingRows.error
      ? false
      : shouldSuppressFlightFraming({
          hasConfirmedFlight: hasConfirmedFlightBooking(
            ((bookingRows.data || []) as Array<Record<string, unknown>>).filter((booking) => {
              const status = String(booking.booking_status || "").trim().toLowerCase();
              // Empty or unknown status is not proof that no flight exists.
              if (!status || status === "unknown") return true;
              return booking.traveler_confirmed === true || ["confirmed", "booked", "ticketed", "issued", "paid", "reserved", "modified", "completed"].includes(status);
            })
          )
        })
  };
  const lastNotification =
    (events.data || []).find((event) => event.event_type === "trip_activated" || event.event_type === "notification_shown") ||
    null;
  const notification: TripNotificationPayload | null = lastNotification
    ? {
        title: lastNotification.event_title || "Live Trip Companion ready",
        body: lastNotification.event_body || "Your Roamly trip is ready.",
        type: lastNotification.event_type === "trip_activated" ? "trip_activated" : "activity_nearby"
      }
    : null;

  return (
    <div className="calm-bleed mx-auto w-full max-w-6xl px-4 pb-8 pt-5 sm:px-6">
      <NotificationShellStateBridge activeTripId={trip.id} unreadCount={unreadNotifications.count || 0} />
      {companionOn ? <TripActivationBanner notification={notification} dayNumber={currentDay.dayNumber} tripStarted={tripStarted} presentation={presentation} /> : null}
      <p className="mt-4 text-[15px] font-normal leading-[1.45] text-cgray">
        {companionOn
          ? "Live Companion is unlocked on this trip. These reminders and check-ins are for this trip only."
          : "Live Companion is not unlocked on this trip. These reminders belong to this trip only."}
      </p>

      <section className="mt-6">
        <NotificationTimelineCard initialItems={notificationItems} />
      </section>

      {companionOn ? (
      <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <ActiveTripPanel trip={trip} />
        <NearbyActivityCard tripId={trip.id} activity={tripStarted ? (nearbyActivities[0] || upNext.activity) : upNext.activity} tripStarted={tripStarted} presentation={presentation} />
      </section>
      ) : (
        <Card className="mt-6">
          <h1 className="text-[22px] font-bold tracking-[-0.018em] text-chead">Reminders stay with this trip.</h1>
          <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
            Check-ins and Live Companion tools appear here after Live Companion is unlocked for this trip. Nothing on this page comes from another trip.
          </p>
        </Card>
      )}

      {companionOn ? (
      <section className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <CurrentDayTimeline
          day={currentDay.day}
          dayNumber={currentDay.dayNumber}
          activities={tripStarted && nearbyActivities.length ? nearbyActivities : upNext.activity ? [upNext.activity] : []}
          tripStarted={tripStarted}
          presentation={presentation}
        />
        <div className="space-y-4">
          <UpNextActivityCard tripId={trip.id} activity={upNext.activity} tripStarted={tripStarted} presentation={presentation} />
          <CheckedActivitiesList activities={checked.activities} />
        </div>
      </section>
      ) : null}

      <section className="mt-6">
        <p className="mb-2 ml-4 text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">{companionOn ? "Live Companion updates" : "Trip updates"}</p>
        <div className="divide-y divide-chair overflow-hidden rounded-[14px] bg-white shadow-calm">
          {(events.data || []).length ? (
            (events.data || []).map((event) => (
              <div key={event.id} className="px-4 py-3">
                <p className="text-[16.5px] font-semibold leading-[1.3] text-chead">{event.event_title || event.event_type}</p>
                <p className="mt-0.5 text-[14.5px] font-normal leading-[1.35] text-cgray">{event.event_body}</p>
              </div>
            ))
          ) : (
            <p className="px-4 py-3 text-[15px] font-normal text-cgray">
              No trip events yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
