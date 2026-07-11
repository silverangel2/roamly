"use client";

import { useState } from "react";
import type { TrackingActivity } from "@/lib/roamly/tripActivation";

export function NearbyActivityCard({
  tripId,
  activity
}: {
  tripId: string;
  activity: TrackingActivity | null;
}) {
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
      else setNotice("Checked in.");
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
    else setNotice("Marked completed.");
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
    else setNotice("Skipped.");
    setBusy("");
  }

  if (!activity) {
    return (
      <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Nearby now</p>
        <h2 className="mt-2 text-2xl font-black text-ink">No nearby activity detected.</h2>
        <p className="mt-2 text-sm font-bold text-slate-500">Roamly will update this when you arrive near a saved stop.</p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.75rem] border border-ocean/20 bg-white/95 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Nearby now</p>
      <h2 className="mt-2 text-2xl font-black text-ink">{activity.title}</h2>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{activity.description}</p>
      {activity.distance_meters != null ? (
        <p className="mt-2 text-sm font-black text-ocean">{activity.distance_meters}m away</p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={checkIn}
          disabled={Boolean(busy)}
          className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60"
        >
          {busy === "check" ? "Checking..." : "Check in"}
        </button>
        <button
          type="button"
          onClick={complete}
          disabled={Boolean(busy)}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
        >
          {busy === "complete" ? "Saving..." : "Mark done"}
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={Boolean(busy)}
          className="rounded-2xl bg-cloud px-4 py-3 text-sm font-black text-slate-600 shadow-soft disabled:opacity-60"
        >
          {busy === "skip" ? "Saving..." : "Skip"}
        </button>
      </div>
      {notice ? <p className="mt-3 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </section>
  );
}
