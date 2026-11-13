import type { TripNotificationPayload } from "@/lib/roamly/tripActivation";
import { translateExactText, translateKey } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";
import { notificationProximityCopy, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";
import type { LocationEvidence } from "@/lib/roamly/locationEvidence";

export async function TripActivationBanner({
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
  const locale = await getServerLocale();
  const title = notification?.title
    ? presentTrackingActivityTitle({ title: notification.title, ...presentation })
    : tripStarted
      ? translateExactText(locale, "Live Trip Companion ready")
      : translateExactText(locale, "Trip has not started");
  return (
    <section className="bui-enter rounded-bui-card border border-chair bg-white p-4 shadow-bui-card sm:p-5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.09em] text-cgray">{translateExactText(locale, "Roamly notification")}</p>
      <h2 className="mt-1.5 text-[30px] font-bold leading-[1.12] tracking-[-0.022em] text-chead">
        {title}
      </h2>
      {/* Builder-L trim: the title fallback above ("Trip has not
          started") is the ONE retained trip-state statement; the
          duplicate "Not started" subline is removed. */}
      {tripStarted ? <p className="bui-display-number mt-2 text-[15px] font-semibold text-chead">{translateKey(locale, "ui.trip.printDay", "Day {number}", { number: dayNumber || 1 })}</p> : null}
      <p className="mt-2 max-w-2xl text-[15px] font-normal leading-[1.45] text-cink">
        {notificationProximityCopy(notification?.body, locationEvidence)}
      </p>
    </section>
  );
}
