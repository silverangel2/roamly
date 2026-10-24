"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { TrackingActivity } from "@/lib/roamly/tripActivation";
import { clearActivityNotification } from "@/lib/roamly/pushClient";
import { presentTrackingActivityDetail, presentTrackingActivityTitle, type TrackingPresentation } from "@/lib/roamly/itineraryPresentation";

export function NearbyActivityCard({
  tripId,
  activity,
  tripStarted = true,
  presentation
}: {
  tripId: string;
  activity: TrackingActivity | null;
  tripStarted?: boolean;
  presentation?: TrackingPresentation;
}) {
  const { t } = useI18n();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function withLocation(callback: (coords: GeolocationCoordinates) => Promise<void>) {
    setError("");
    setNotice("");

    if (!navigator.geolocation) {
      setError("Location is not available on this device.");
      setBusy("");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => void callback(position.coords),
      () => {
        setError("Roamly needs location permission to check in.");
        setBusy("");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  async function checkIn() {
    if (!activity) return;
    setBusy("check");
    await withLocation(async (coords) => {
      const response = await fetch("/api/roamly/activities/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          activityId: activity.id,
          latitude: coords.latitude,
          longitude: coords.longitude
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) setError(data?.error || "Check-in failed.");
      else {
        void clearActivityNotification(tripId, activity.id);
        setNotice("Checked in.");
      }
      setBusy("");
    });
  }

  async function complete() {
    if (!activity) return;
    setBusy("complete");
    const response = await fetch("/api/roamly/activities/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId, activityId: activity.id })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) setError(data?.error || "Could not complete activity.");
    else {
      void clearActivityNotification(tripId, activity.id);
      setNotice("Marked completed.");
    }
    setBusy("");
  }

  async function skip() {
    if (!activity) return;
    setBusy("skip");
    const response = await fetch("/api/roamly/activities/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId, activityId: activity.id })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) setError(data?.error || "Could not skip activity.");
    else {
      void clearActivityNotification(tripId, activity.id);
      setNotice("Skipped.");
    }
    setBusy("");
  }

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

  if (!tripStarted) {
    return (
      <section className="rounded-[14px] bg-white p-4 shadow-calm">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">Nearby</p>
        <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Not nearby yet</h2>
        <p className="mt-1.5 text-sm font-normal leading-6 text-cink">This trip has not started, so a planned stop is not nearby.</p>
        {title ? <p className="mt-3 text-sm font-semibold text-chead">First planned stop: {title}</p> : null}
      </section>
    );
  }

  if (!activity) {
    return (
      <section className="rounded-[14px] bg-white p-4 shadow-calm">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.status.nearbyNow")}</p>
        <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{t("ui.status.noNearbyActivity")}</h2>
        <p className="mt-1.5 text-sm font-normal leading-6 text-cgray">{t("ui.status.nearbyUpdate")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-[14px] bg-white p-4 shadow-calm">
      <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.status.nearbyNow")}</p>
      <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{title}</h2>
      <p className="mt-1.5 text-sm font-normal leading-6 text-cink">{detail}</p>
      {activity.distance_meters != null ? (
        <p className="mt-2 text-sm font-semibold text-cblue">{activity.distance_meters}m away</p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={checkIn}
          disabled={Boolean(busy)}
          className="rounded-xl bg-cblue px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "check" ? "Checking..." : "Check in"}
        </button>
        <button
          type="button"
          onClick={complete}
          disabled={Boolean(busy)}
          className="rounded-xl bg-cbg px-4 py-3 text-sm font-semibold text-chead disabled:opacity-60"
        >
          {busy === "complete" ? "Saving..." : "Mark done"}
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={Boolean(busy)}
          className="rounded-xl px-4 py-3 text-sm font-semibold text-cgray disabled:opacity-60"
        >
          {busy === "skip" ? "Saving..." : "Skip"}
        </button>
      </div>
      {notice ? <p className="mt-3 rounded-xl bg-cblue/10 px-4 py-3 text-sm font-medium text-chead">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-xl bg-cred/10 px-4 py-3 text-sm font-medium text-cred">{error}</p> : null}
    </section>
  );
}
