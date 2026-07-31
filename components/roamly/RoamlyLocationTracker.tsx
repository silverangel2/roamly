"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LocationPermissionCard } from "@/components/roamly/LocationPermissionCard";

type ActiveTripResponse = {
  ok: boolean;
  activeTrip?: { id: string; status: string } | null;
};

type SettingsResponse = {
  ok: boolean;
  settings?: {
    location_tracking_enabled?: boolean;
    notification_enabled?: boolean;
    last_permission_state?: string | null;
  };
};

const LOCATION_PROMPT_DISMISSED_UNTIL_KEY = "roamly_location_prompt_dismissed_until";
const LOCATION_PROMPT_DISMISS_MS = 7 * 24 * 60 * 60_000;
const LOCATION_DENIED_DISMISS_MS = 30 * 24 * 60 * 60_000;

function getVisitorKey() {
  const key = "roamly_visitor_key";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function shouldThrottle(key: string, ms: number) {
  const last = Number(localStorage.getItem(key) || 0);
  const now = Date.now();
  if (Number.isFinite(last) && now - last < ms) return true;
  localStorage.setItem(key, String(now));
  return false;
}

function readLocationPromptDismissed() {
  try {
    const dismissedUntil = Number(localStorage.getItem(LOCATION_PROMPT_DISMISSED_UNTIL_KEY) || 0);
    return Number.isFinite(dismissedUntil) && dismissedUntil > Date.now();
  } catch {
    return false;
  }
}

function writeLocationPromptDismissal(ms: number) {
  try {
    localStorage.setItem(LOCATION_PROMPT_DISMISSED_UNTIL_KEY, String(Date.now() + ms));
  } catch {
    // Local storage is best-effort; state still suppresses the current prompt.
  }
}

function clearLocationPromptDismissal() {
  try {
    localStorage.removeItem(LOCATION_PROMPT_DISMISSED_UNTIL_KEY);
  } catch {
    // Local storage is best-effort.
  }
}

function hasActiveSimulatedLocation(pathname: string) {
  try {
    const raw = localStorage.getItem("roamly_live_simulated_location");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { active?: boolean; tripId?: string };
    return parsed.active === true && typeof parsed.tripId === "string" && pathname.includes(`/trip/${parsed.tripId}/live`);
  } catch {
    return false;
  }
}

function isLocationPromptPath(pathname: string, activeTripId?: string | null) {
  if (pathname.startsWith("/admin")) return false;
  if (pathname === "/plan" || pathname.startsWith("/login") || pathname.startsWith("/signup")) return false;
  if (activeTripId && pathname.includes(`/trip/${activeTripId}/live`)) return true;
  if (activeTripId && pathname.includes(`/trip/${activeTripId}/companion`)) return true;
  return pathname === "/dashboard" || pathname === "/notifications";
}

export function RoamlyLocationTracker() {
  const pathname = usePathname();
  const [activeTrip, setActiveTrip] = useState<ActiveTripResponse["activeTrip"]>(null);
  const [enabled, setEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(() => readLocationPromptDismissed());
  const [lastPermissionState, setLastPermissionState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shouldShowPermission = useMemo(
    () =>
      Boolean(
        activeTrip &&
          !enabled &&
          !dismissed &&
          lastPermissionState !== "denied" &&
          isLocationPromptPath(pathname, activeTrip.id)
      ),
    [activeTrip, dismissed, enabled, lastPermissionState, pathname]
  );

  const dismissPrompt = useCallback((ms = LOCATION_PROMPT_DISMISS_MS) => {
    writeLocationPromptDismissal(ms);
    setDismissed(true);
  }, []);

  useEffect(() => {
    const visitorKey = getVisitorKey();
    void fetch("/api/roamly/events/app", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitorKey,
        eventType: "page_view",
        path: pathname,
        url: window.location.href,
        title: document.title,
        referrer: document.referrer,
        platform: navigator.platform,
        language: navigator.language
      })
    }).catch(() => undefined);
    if (pathname === "/") {
      void fetch("/api/roamly/events/app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          visitorKey,
          eventType: "homepage_view",
          path: pathname,
          url: window.location.href,
          title: document.title,
          referrer: document.referrer,
          platform: navigator.platform,
          language: navigator.language
        })
      }).catch(() => undefined);
    }
  }, [pathname]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const [tripResponse, settingsResponse] = await Promise.all([
        fetch("/api/roamly/trips/active").catch(() => null),
        fetch("/api/roamly/location/settings").catch(() => null)
      ]);

      if (!alive) return;

      if (tripResponse?.ok) {
        const data = (await tripResponse.json().catch(() => null)) as ActiveTripResponse | null;
        setActiveTrip(data?.activeTrip || null);
      }

      if (settingsResponse?.ok) {
        const data = (await settingsResponse.json().catch(() => null)) as SettingsResponse | null;
        setEnabled(Boolean(data?.settings?.location_tracking_enabled));
        setLastPermissionState(data?.settings?.last_permission_state || null);
        if (data?.settings?.last_permission_state === "denied") {
          writeLocationPromptDismissal(LOCATION_DENIED_DISMISS_MS);
          setDismissed(true);
        } else {
          setDismissed(readLocationPromptDismissed());
        }
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [pathname]);

  const sendLocation = useCallback(
    async (coords: GeolocationCoordinates, permissionState: "granted" | "denied" | "prompt" = "granted") => {
      const response = await fetch("/api/roamly/location/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          permissionState
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Location update failed.");

      const notificationKey = `roamly_notification_${data?.activeTrip?.id || "trip"}`;
      if (data?.notification && !shouldThrottle(notificationKey, 30 * 60_000)) {
        sessionStorage.setItem("roamly_last_notification", JSON.stringify(data.notification));
      }
    },
    []
  );

  const requestLocation = useCallback(async () => {
    localStorage.removeItem("roamly_live_simulated_location");
    clearLocationPromptDismissal();
    setDismissed(false);
    setBusy(true);
    setError("");

    try {
      if (!navigator.geolocation) {
        throw new Error("This browser does not support location sensing.");
      }

      await fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationTrackingEnabled: true, notificationEnabled: true })
      });

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setEnabled(true);
          setLastPermissionState("granted");
          setBusy(false);
          void sendLocation(position.coords);
        },
        async () => {
          setBusy(false);
          setEnabled(false);
          setLastPermissionState("denied");
          dismissPrompt(LOCATION_DENIED_DISMISS_MS);
          setError("Location permission was not granted.");
          await fetch("/api/roamly/location/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ permissionState: "denied" })
          }).catch(() => undefined);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Location setup failed.");
    }
  }, [dismissPrompt, sendLocation]);

  useEffect(() => {
    if (!enabled || !activeTrip || !navigator.geolocation) return;
    if (hasActiveSimulatedLocation(pathname)) return;
    if (shouldThrottle("roamly_location_update", 10 * 60_000)) return;

    navigator.geolocation.getCurrentPosition(
      (position) => void sendLocation(position.coords),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60_000 }
    );
  }, [activeTrip, enabled, pathname, sendLocation]);

  if (!shouldShowPermission) return null;

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-sm md:bottom-5 md:left-auto md:right-5 md:mx-0">
      <button
        type="button"
        onClick={() => dismissPrompt()}
        className="mb-2 ml-auto block rounded-full bg-white/90 px-3 py-1 text-xs font-black text-slate-500 shadow-soft"
      >
        Later
      </button>
      <LocationPermissionCard onEnable={requestLocation} busy={busy} error={error} compact />
    </div>
  );
}
