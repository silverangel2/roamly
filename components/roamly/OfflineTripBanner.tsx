"use client";

import { useEffect, useState } from "react";

/**
 * Offline trip banner (offline round, 2026-10-27).
 *
 * Cached content must NEVER look live: when the browser is offline,
 * a previously loaded trip page shows this banner with the real
 * last-online-load time for THAT trip, so the traveler can tell saved
 * content from fresh content. When online it renders nothing — the
 * online app is byte-for-byte unchanged by this component.
 *
 * The timestamp is the device's own record: on every online mount the
 * component stamps localStorage for this trip id; offline it reads
 * that stamp back. No time is invented — if no stamp exists (the trip
 * was never loaded online in this browser), no banner renders either,
 * because there is no saved copy to label.
 */
export function OfflineTripBanner({ tripId }: { tripId: string }) {
  const [offline, setOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !tripId) return;
    const key = `roamly-offline-last-updated:${tripId}`;
    const refresh = () => {
      if (navigator.onLine) {
        const now = new Date().toISOString();
        try {
          window.localStorage.setItem(key, now);
        } catch {
          // Private-mode storage failure: no stamp, no banner offline.
        }
        setLastUpdated(now);
        setOffline(false);
      } else {
        let stored: string | null = null;
        try {
          stored = window.localStorage.getItem(key);
        } catch {
          stored = null;
        }
        setLastUpdated(stored);
        setOffline(true);
      }
    };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, [tripId]);

  if (!offline || !lastUpdated) return null;
  const parsed = new Date(lastUpdated);
  const label = Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : lastUpdated;
  return (
    <div
      data-testid="offline-trip-banner"
      role="status"
      className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-[14px] font-semibold leading-6 text-amber-900"
    >
      Offline — last updated {label} · Showing your saved trip. Reconnect for the latest version.
    </div>
  );
}
