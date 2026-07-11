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
  getActiveOrUpcomingTrip,
  getCheckedActivities,
  getCurrentDayRecord,
  getUpNextActivity,
  type TripNotificationPayload,
  type TrackingActivity
} from "@/lib/roamly/tripActivation";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect("/login?next=/notifications");

  if (!current.configured || !current.user) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <h1 className="text-3xl font-black text-ink">Notifications need an account.</h1>
          <div className="mt-5">
            <Button href="/login?next=/notifications">Log in</Button>
          </div>
        </Card>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const [tripResult, notifications] = await Promise.all([
    getActiveOrUpcomingTrip(supabase, current.user.id),
    supabase
      .from("roamly_notifications")
      .select("id,title,body,type,status,action_url,created_at")
      .eq("user_id", current.user.id)
      .order("created_at", { ascending: false })
      .limit(20)
  ]);
  const trip = tripResult.trip;

  if (!trip) {
    return (
      <main className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <section className="mb-6">
          <NotificationTimelineCard initialItems={notifications.data || []} />
        </section>
        <Card>
          <h1 className="text-3xl font-black text-ink">No active trip notifications yet.</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Unlock Live Trip Companion to show trip reminders, booking timeline updates, and airline-style live updates here.
          </p>
          <div className="mt-5">
            <Button href="/dashboard">Open dashboard</Button>
          </div>
        </Card>
      </main>
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
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <TripActivationBanner notification={notification} dayNumber={currentDay.dayNumber} />

      <section className="mt-6">
        <NotificationTimelineCard initialItems={notifications.data || []} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <ActiveTripPanel trip={trip} />
        <NearbyActivityCard tripId={trip.id} activity={nearbyActivities[0] || upNext.activity} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <CurrentDayTimeline
          day={currentDay.day}
          dayNumber={currentDay.dayNumber}
          activities={nearbyActivities.length ? nearbyActivities : upNext.activity ? [upNext.activity] : []}
        />
        <div className="space-y-4">
          <UpNextActivityCard tripId={trip.id} activity={upNext.activity} />
          <CheckedActivitiesList activities={checked.activities} />
        </div>
      </section>

      <section className="mt-5">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Live companion events</p>
          <div className="mt-4 grid gap-3">
            {(events.data || []).length ? (
              (events.data || []).map((event) => (
                <div key={event.id} className="rounded-2xl bg-mist px-4 py-3">
                  <p className="text-sm font-black text-ink">{event.event_title || event.event_type}</p>
                  <p className="mt-1 text-sm font-bold text-slate-500">{event.event_body}</p>
                </div>
              ))
            ) : (
              <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
                No trip events yet.
              </p>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}
