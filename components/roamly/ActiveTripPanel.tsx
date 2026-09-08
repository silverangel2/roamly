"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingTrip } from "@/lib/roamly/tripActivation";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";

export function ActiveTripPanel({ trip }: { trip: TrackingTrip | null }) {
  const { t } = useI18n();
  if (!trip) {
    return (
      <div className="rounded-[1.5rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{t("ui.status.noActiveTrip")}</p>
        <h2 className="mt-2 text-2xl font-black text-ink">{t("ui.status.nothingLive")}</h2>
        <p className="mt-2 text-sm font-bold text-slate-500">{t("ui.status.unlockCompanion")}</p>
      </div>
    );
  }
  const destination = getTripDestinationLabel(trip) || "Destination ready";

  return (
    <div className="rounded-[1.5rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{t("ui.status.liveCompanion")}</p>
      <h2 className="mt-2 text-2xl font-black text-ink">{trip.title || destination}</h2>
      <p className="mt-2 text-sm font-bold text-slate-500">
        {trip.destination_city || destination} · {trip.status}
      </p>
    </div>
  );
}
