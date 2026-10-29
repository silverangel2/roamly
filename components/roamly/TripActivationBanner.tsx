import type { TripNotificationPayload } from "@/lib/roamly/tripActivation";
import { notificationProximityCopy, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";
import type { LocationEvidence } from "@/lib/roamly/locationEvidence";

export function TripActivationBanner({
  notification,
  dayNumber,
  tripStarted = true,
  locationEvidence,
  presentation
}: {
  notification?: TripNotificationPayload | null;
  dayNumber?: number | null;
  tripStarted?: boolean;
  /** Round 2: the banner body is gated on this evidence, never on the calendar. tripStarted now drives only the title. */
  locationEvidence?: LocationEvidence | null;
  presentation?: TrackingPresentation;
}) {
  const title = notification?.title
    ? presentTrackingActivityTitle({ title: notification.title, ...presentation })
    : tripStarted
      ? "Live Trip Companion ready"
      : "Trip has not started";
  return (
    <section className="rounded-[14px] bg-white p-4 shadow-calm sm:p-5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.09em] text-cgray">Roamly notification</p>
      <h2 className="mt-1.5 text-[30px] font-bold leading-[1.12] tracking-[-0.022em] text-chead">
        {title}
      </h2>
      {/* Builder-L trim: the title fallback above ("Trip has not
          started") is the ONE retained trip-state statement; the
          duplicate "Not started" subline is removed. */}
      {tripStarted ? <p className="mt-2 text-[15px] font-semibold text-chead">{`Day ${dayNumber || 1}`}</p> : null}
      <p className="mt-2 max-w-2xl text-[15px] font-normal leading-[1.45] text-cink">
        {notificationProximityCopy(notification?.body, locationEvidence)}
      </p>
    </section>
  );
}
