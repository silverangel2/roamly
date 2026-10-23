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
    <section className="rounded-[14px] bg-white p-5 shadow-calm sm:p-6">
      <p className="text-[12px] font-semibold uppercase tracking-[0.09em] text-cgray">Roamly notification</p>
      <h1 className="mt-1.5 text-[30px] font-bold leading-[1.12] tracking-[-0.022em] text-chead">
        {title}
      </h1>
      <p className="mt-2 text-[15px] font-semibold text-chead">{tripStarted ? `Day ${dayNumber || 1}` : "Not started"}</p>
      <p className="mt-2 max-w-2xl text-[15px] font-normal leading-[1.45] text-cink">
        {notificationProximityCopy(notification?.body, tripStarted)}
      </p>
    </section>
  );
}
