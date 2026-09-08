import type { TrackingActivity } from "@/lib/roamly/tripActivation";
import { NavigationButtons } from "@/components/roamly/NavigationButtons";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatRoamlyTime } from "@/lib/i18n";

export function UpNextActivityCard({ activity, tripId }: { activity: TrackingActivity | null; tripId?: string }) {
  const { locale, t } = useI18n();
  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-sun">{t("ui.status.upNextNearby")}</p>
      {activity ? (
        <>
          <h2 className="mt-2 text-2xl font-black text-ink">{activity.title}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{activity.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activity.scheduled_start ? (
              <span className="rounded-full bg-mist px-3 py-2 text-xs font-black text-slate-600">
                {formatRoamlyTime(activity.scheduled_start, locale)}
              </span>
            ) : null}
            {activity.distance_meters != null ? (
              <span className="rounded-full bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
                {t("ui.status.metersAway", "{distance} m away").replace("{distance}", String(activity.distance_meters))}
              </span>
            ) : null}
          </div>
          <NavigationButtons
            tripId={tripId}
            destinationLabel={activity.title || activity.address || activity.city}
            address={activity.address || activity.city}
            latitude={activity.latitude}
            longitude={activity.longitude}
            showHeading
            className="mt-4"
          />
        </>
      ) : (
        <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{t("ui.status.noNextActivity")}</p>
      )}
    </section>
  );
}
