"use client";

import type { CSSProperties } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity } from "@/lib/roamly/tripActivation";

export function CheckedActivitiesList({ activities }: { activities: TrackingActivity[] }) {
  const { t } = useI18n();
  return (
    <section className="bui-enter rounded-bui-panel border border-chair bg-white p-4 shadow-bui-card">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.status.checkedActivities")}</p>
      <div className="mt-4 grid gap-3">
        {activities.length ? (
          activities.map((activity, index) => (
            <div key={activity.id} className="bui-enter rounded-bui-card border border-chair bg-cbg px-4 py-3 shadow-bui-card" style={{ "--bui-delay": `${index * 60}ms` } as CSSProperties}>
              <p className="text-sm font-semibold text-chead">{activity.title}</p>
              <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray2">
                {activity.status.replace("_", " ")}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-bui-card border border-chair bg-cbg px-4 py-3 text-sm font-normal text-cgray">
            {t("ui.status.noCheckedActivities")}
          </p>
        )}
      </div>
    </section>
  );
}
