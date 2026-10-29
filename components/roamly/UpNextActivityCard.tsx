"use client";

import type { TrackingActivity } from "@/lib/roamly/tripActivation";
import { NavigationButtons } from "@/components/roamly/NavigationButtons";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatRoamlyTime } from "@/lib/i18n";
import { presentTrackingActivityDetail, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";

export function UpNextActivityCard({
  activity,
  tripId,
  tripStarted = true,
  locationVerified = false,
  presentation
}: {
  activity: TrackingActivity | null;
  tripId?: string;
  tripStarted?: boolean;
  /**
   * Round 2 evidence boundary (same rule as NearbyActivityCard): the
   * "Up next nearby" eyebrow and the "X m away" badge render ONLY when
   * location evidence verifies nearness. Otherwise this is a planned
   * next stop — including its distance, which is a proximity claim even
   * when it comes from a stored row minted by an earlier GPS fix.
   */
  locationVerified?: boolean;
  presentation?: TrackingPresentation;
}) {
  const { locale, t } = useI18n();
  const title = activity
    ? presentTrackingActivityTitle({
        title: activity.title,
        city: activity.city,
        address: activity.address,
        category: activity.category,
        ...presentation
      })
    : "";
  const detail = presentTrackingActivityDetail(activity?.description, presentation?.suppressFlightFraming, presentation?.destination);
  return (
    <section className="rounded-[14px] bg-white p-4 shadow-calm">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{tripStarted && locationVerified ? t("ui.status.upNextNearby") : "Planned next"}</p>
      {activity ? (
        <>
          <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{title}</h2>
          {/* Builder-L trim: the trip-timing header states the trip state
              once; this card keeps only its neutral "Planned next"
              eyebrow above and never claims the stop is happening today. */}
          <p className="mt-1.5 text-sm font-normal leading-6 text-cink">{detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activity.scheduled_start ? (
              <span className="rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead">
                {formatRoamlyTime(activity.scheduled_start, locale)}
              </span>
            ) : null}
            {tripStarted && locationVerified && activity.distance_meters != null ? (
              <span className="rounded-md bg-cblue/10 px-2 py-0.5 text-xs font-semibold text-cblue">
                {t("ui.status.metersAway", "{distance} m away").replace("{distance}", String(activity.distance_meters))}
              </span>
            ) : null}
          </div>
          <NavigationButtons
            tripId={tripId}
            destinationLabel={title || activity.address || activity.city}
            address={activity.address || activity.city}
            latitude={activity.latitude}
            longitude={activity.longitude}
            showHeading
            className="mt-4"
          />
        </>
      ) : (
        <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">{t("ui.status.noNextActivity")}</p>
      )}
    </section>
  );
}
