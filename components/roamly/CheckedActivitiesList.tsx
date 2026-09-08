"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity } from "@/lib/roamly/tripActivation";

export function CheckedActivitiesList({ activities }: { activities: TrackingActivity[] }) {
  const { t } = useI18n();
  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{t("ui.status.checkedActivities")}</p>
      <div className="mt-4 grid gap-3">
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.id} className="rounded-2xl bg-mist px-4 py-3">
              <p className="text-sm font-black text-ink">{activity.title}</p>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                {activity.status.replace("_", " ")}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
            {t("ui.status.noCheckedActivities")}
          </p>
        )}
      </div>
    </section>
  );
}
