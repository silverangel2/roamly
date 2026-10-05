"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity, TrackingDay } from "@/lib/roamly/tripActivation";
import { presentTrackingActivityDetail, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";

function statusClass(status: string) {
  if (status === "completed" || status === "checked_in") return "bg-ocean/10 text-ocean";
  if (status === "nearby") return "bg-sun/20 text-amber-700";
  return "bg-mist text-slate-500";
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
    <section className="border-y border-cloud bg-[#fffdf8]/70 py-5 sm:py-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{tripStarted ? t("ui.status.currentDay") : "Planned"}</p>
      <h2 className="mt-2 text-2xl font-black text-ink">{dayTitle}</h2>
      {tripStarted ? null : <p className="mt-2 text-sm font-bold leading-6 text-slate-500">This trip has not started. These are not today’s activities.</p>}
      {day?.summary ? <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{presentTrackingActivityDetail(day.summary, presentation?.suppressFlightFraming, presentation?.destination)}</p> : null}
      <div className="mt-4 divide-y divide-cloud border-y border-cloud">
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.id} className="py-4 first:pt-3 last:pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-ink">{presentTrackingActivityTitle({ title: activity.title, city: activity.city, address: activity.address, category: activity.category, ...presentation })}</h3>
                  <p className="mt-1 text-sm font-bold leading-5 text-slate-500">{presentTrackingActivityDetail(activity.description, presentation?.suppressFlightFraming, presentation?.destination)}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(activity.status)}`}>
                  {activity.status.replace("_", " ")}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="bg-mist px-4 py-3 text-sm font-black text-slate-500">
            {t("ui.status.noTimelineActivities")}
          </p>
        )}
      </div>
    </section>
  );
}
