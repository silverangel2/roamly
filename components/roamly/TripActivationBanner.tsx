import type { TripNotificationPayload } from "@/lib/roamly/tripActivation";
import { notificationProximityCopy, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";

export function TripActivationBanner({
  notification,
  dayNumber,
  tripStarted = true,
  presentation
}: {
  notification?: TripNotificationPayload | null;
  dayNumber?: number | null;
  tripStarted?: boolean;
  presentation?: TrackingPresentation;
}) {
  const title = notification?.title
    ? presentTrackingActivityTitle({ title: notification.title, ...presentation })
    : tripStarted
      ? "Live Trip Companion ready"
      : "Trip has not started";
  return (
    <section className="overflow-hidden rounded-[2rem] border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_56%,#fff7ed_100%)] p-5 text-ink shadow-soft sm:p-6">
      <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-cyan-300/30 blur-3xl" />
      <div className="relative">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Roamly notification</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">
          {title}
        </h1>
        <p className="mt-3 text-lg font-black text-orange-600">{tripStarted ? `Day ${dayNumber || 1}` : "Not started"}</p>
        <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-slate-600">
          {notificationProximityCopy(notification?.body, tripStarted)}
        </p>
      </div>
    </section>
  );
}
