"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity, TrackingDay } from "@/lib/roamly/tripActivation";
import { presentTrackingActivityDetail, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";

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
  presentation
}: {
  day: TrackingDay | null;
  dayNumber: number;
  activities: TrackingActivity[];
  tripStarted?: boolean;
  presentation?: TrackingPresentation;
}) {
  const { t } = useI18n();
  const dayTitle = day?.title
    ? presentTrackingActivityTitle({ title: day.title, ...presentation })
    : t("ui.status.dayNumber", "Day {day}").replace("{day}", String(dayNumber));
  return (
    <section className="rounded-[14px] bg-white p-4 shadow-calm">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{tripStarted ? t("ui.status.currentDay") : "Planned"}</p>
      <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{dayTitle}</h2>
      {tripStarted ? null : <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">This trip has not started. These are not today’s activities.</p>}
      {day?.summary ? <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">{presentTrackingActivityDetail(day.summary, presentation?.suppressFlightFraming, presentation?.destination)}</p> : null}
      <div className="mt-3 divide-y divide-chair">
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.id} className="py-4 first:pt-3 last:pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[17px] font-semibold leading-snug text-chead">{presentTrackingActivityTitle({ title: activity.title, city: activity.city, address: activity.address, category: activity.category, ...presentation })}</h3>
                  <p className="mt-0.5 text-sm font-normal leading-5 text-cgray">{presentTrackingActivityDetail(activity.description, presentation?.suppressFlightFraming, presentation?.destination)}</p>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${statusClass(activity.status)}`}>
                  {activity.status.replace("_", " ")}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="bg-cbg px-4 py-3 text-sm font-normal text-cgray">
            {t("ui.status.noTimelineActivities")}
          </p>
        )}
      </div>
    </section>
  );
}
