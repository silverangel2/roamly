"use client";

import { useEffect, useState } from "react";
import { BuiNotice } from "@/components/boardui/Notice";
import { cx } from "@/components/boardui/cx";

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
      setNotice(next.location_tracking_enabled
        ? "Trip sensing is on. Your current location will be used for trip features."
        : "Trip sensing is off, and the last saved location has been cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save tracking settings.");
    } finally {
      setBusy(false);
    }
  }

  const tracking = Boolean(settings?.location_tracking_enabled);
  const notifications = settings?.notification_enabled !== false;

  // Batch 7 (2026-11-09): the toggles ride the BoardUI button recipe
  // — ON is the brand primary (solid cblue, the same recipe as
  // BuiButton primary), OFF is the white secondary card. The old
  // cyan/orange gradients were off-token (the generic-AI-look tell)
  // and the two settings no longer wear two different colours: one
  // brand, one meaning (on/off). Save behaviour is untouched — a tap
  // still saves immediately, exactly as before.
  const toggleClass = (on: boolean) =>
    cx(
      "bui-press bui-touch inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition-colors duration-200 ease-bui focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 disabled:pointer-events-none disabled:opacity-60",
      on
        ? "bg-cblue text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)] hover:bg-[#0A6FE0]"
        : "border border-chair bg-white text-chead shadow-bui-card hover:border-cblue/50 hover:text-cblue"
    );

  return (
    <div className="space-y-4">
      <BuiNotice tone="info" title="Live trip sensing">
        Roamly uses your location only to activate trip mode, show nearby activities, and help with your travel timeline.
        Turn trip sensing off anytime to stop updates and clear the last saved location.
      </BuiNotice>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          aria-pressed={tracking}
          onClick={() => save({ ...settings, location_tracking_enabled: !tracking })}
          className={toggleClass(tracking)}
        >
          {tracking ? "Trip sensing on" : "Trip sensing off"}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={notifications}
          onClick={() => save({ ...settings, notification_enabled: !notifications })}
          className={toggleClass(notifications)}
        >
          {notifications ? "Notifications on" : "Notifications off"}
        </button>
      </div>

      {settings?.last_permission_state ? (
        <p className="text-xs font-black uppercase tracking-[0.14em] text-cgray2">
          Last permission: {settings.last_permission_state}
        </p>
      ) : null}
      {notice ? <BuiNotice tone="success" title={notice} /> : null}
      {error ? <BuiNotice tone="error" title={error} /> : null}
    </div>
  );
}
