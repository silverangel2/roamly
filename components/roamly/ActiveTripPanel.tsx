"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingTrip } from "@/lib/roamly/tripActivation";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";

export function ActiveTripPanel({ trip }: { trip: TrackingTrip | null }) {
  const { t } = useI18n();
  if (!trip) {
    return (
      <div className="rounded-[14px] bg-white p-4 shadow-calm">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.status.noActiveTrip")}</p>
        <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{t("ui.status.nothingLive")}</h2>
        <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">{t("ui.status.unlockCompanion")}</p>
      </div>
    );
  }
  const destination = getTripDestinationLabel(trip) || "Destination ready";

  return (
    <div className="rounded-[14px] bg-white p-4 shadow-calm">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.status.liveCompanion")}</p>
      <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{trip.title || destination}</h2>
      <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">
        {trip.destination_city || destination} · {trip.status}
      </p>
    </div>
  );
}
