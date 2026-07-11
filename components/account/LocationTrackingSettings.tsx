"use client";

import { useEffect, useState } from "react";

type Settings = {
  location_tracking_enabled?: boolean;
  notification_enabled?: boolean;
  last_permission_state?: string | null;
};

export function LocationTrackingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/roamly/location/settings")
      .then((response) => response.json())
      .then((data) => {
        if (alive && data?.ok) setSettings(data.settings);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function save(next: Settings) {
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationTrackingEnabled: Boolean(next.location_tracking_enabled),
          notificationEnabled: next.notification_enabled !== false
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save tracking settings.");
      setSettings(data.settings);
      setNotice("Trip tracking settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save tracking settings.");
    } finally {
      setBusy(false);
    }
  }

  const tracking = Boolean(settings?.location_tracking_enabled);
  const notifications = settings?.notification_enabled !== false;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-mist p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Live trip sensing</p>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
          Roamly uses your location only to activate trip mode, show nearby activities, and help with your travel timeline.
          You can turn it off anytime.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => save({ ...settings, location_tracking_enabled: !tracking })}
          className={`rounded-2xl px-4 py-3 text-sm font-black shadow-soft transition disabled:opacity-60 ${
            tracking
              ? "bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20"
              : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-cyan-300 hover:text-cyan-700"
          }`}
        >
          {tracking ? "Trip sensing on" : "Trip sensing off"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => save({ ...settings, notification_enabled: !notifications })}
          className={`rounded-2xl px-4 py-3 text-sm font-black shadow-soft transition disabled:opacity-60 ${
            notifications
              ? "bg-gradient-to-r from-orange-400 to-rose-400 text-white shadow-lg shadow-orange-400/20"
              : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-cyan-300 hover:text-cyan-700"
          }`}
        >
          {notifications ? "Notifications on" : "Notifications off"}
        </button>
      </div>

      {settings?.last_permission_state ? (
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
          Last permission: {settings.last_permission_state}
        </p>
      ) : null}
      {notice ? <p className="rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
