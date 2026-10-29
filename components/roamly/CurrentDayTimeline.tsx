"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity, TrackingDay } from "@/lib/roamly/tripActivation";
import { isTravelLeg, presentDayHeading, presentTrackingActivityDetail, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";

function statusClass(status: string) {
  if (status === "completed" || status === "checked_in") return "bg-cblue/10 text-cblue";
  if (status === "nearby") return "bg-sun/20 text-amber-700";
  return "bg-[rgba(31,45,77,0.08)] text-cgray";
}

export function CurrentDayTimeline({
  day,
  dayNumber,
  activities,
  tripStarted = true,
  locationVerified = false,
  presentation
}: {
  day: TrackingDay | null;
  dayNumber: number;
  activities: TrackingActivity[];
  tripStarted?: boolean;
  /**
   * Round 2 evidence boundary: a stored "nearby" row is a past GPS
   * mint, not current proof. Its badge renders as "nearby" only when
   * location evidence currently verifies it; otherwise it reads
   * "planned" — the same downgrade the Live day list applies.
   */
  locationVerified?: boolean;
  presentation?: TrackingPresentation;
}) {
  const { t } = useI18n();
  const dayFallback = t("ui.status.dayNumber", "Day {day}").replace("{day}", String(dayNumber));
  // Round 2 HIGH 3: a day heading never merges distinct venues into one
  // title. Merged titles render as one heading element per venue; a
  // travel leg is labeled Travel; an unconfident join falls back to the
  // neutral day number instead of presenting a guess as a venue.
  const dayHeading = day?.title ? presentDayHeading({ title: day.title, ...presentation }) : null;
  const dayHeadings = dayHeading && dayHeading.headings.length ? dayHeading.headings : [dayFallback];
  return (
    <section className="rounded-[14px] bg-white p-4 shadow-calm">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{tripStarted ? t("ui.status.currentDay") : "Planned"}</p>
      {dayHeadings.map((heading, index) => (
        index === 0
          ? <h2 key={heading} className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{heading}</h2>
          : <h3 key={heading} className="mt-1 text-[19px] font-bold tracking-[-0.018em] text-chead">{heading}</h3>
      ))}
      {dayHeading?.kind === "uncertain" ? (
        <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">This day&apos;s stops still need to be confirmed — see the stops below.</p>
      ) : null}
      {/* Builder-L trim: the trip-timing header states the trip state
          once; this timeline keeps only its neutral "Planned" eyebrow
          above and never claims these are today's activities. */}
      {day?.summary ? <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">{presentTrackingActivityDetail(day.summary, presentation?.suppressFlightFraming, presentation?.destination)}</p> : null}
      <div className="mt-3 divide-y divide-chair">
        {activities.length ? (
          activities.map((activity) => {
            // Round 2: badge text AND badge color follow the same downgrade.
            const displayStatus = activity.status === "nearby" && !locationVerified ? "planned" : activity.status;
            return (
            <div key={activity.id} className="py-4 first:pt-3 last:pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {isTravelLeg({ title: activity.title, category: activity.category }) ? (
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-[0.09em] text-cgray">Travel</p>
                  ) : null}
                  <h3 className="text-[17px] font-semibold leading-snug text-chead">{presentTrackingActivityTitle({ title: activity.title, city: activity.city, address: activity.address, category: activity.category, ...presentation })}</h3>
                  <p className="mt-0.5 text-sm font-normal leading-5 text-cgray">{presentTrackingActivityDetail(activity.description, presentation?.suppressFlightFraming, presentation?.destination)}</p>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${statusClass(displayStatus)}`}>
                  {displayStatus.replace("_", " ")}
                </span>
              </div>
            </div>
            );
          })
        ) : (
          <p className="bg-cbg px-4 py-3 text-sm font-normal text-cgray">
            {t("ui.status.noTimelineActivities")}
          </p>
        )}
      </div>
    </section>
  );
}
