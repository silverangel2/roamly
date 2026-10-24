"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity } from "@/lib/roamly/tripActivation";

export function CheckedActivitiesList({ activities }: { activities: TrackingActivity[] }) {
  const { t } = useI18n();
  return (
    <section className="rounded-[14px] bg-white p-4 shadow-calm">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.status.checkedActivities")}</p>
      <div className="mt-4 grid gap-3">
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.id} className="rounded-xl bg-cbg px-4 py-3">
              <p className="text-sm font-semibold text-chead">{activity.title}</p>
              <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray2">
                {activity.status.replace("_", " ")}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-xl bg-cbg px-4 py-3 text-sm font-normal text-cgray">
            {t("ui.status.noCheckedActivities")}
          </p>
        )}
      </div>
    </section>
  );
}
