"use client";

/*
 * SetupCascade — the one place Roamly's three prerequisites live
 * (owner design, 2026-10-23): a calm, cascading sequence in Settings,
 * reused as the gate at the "Your trip is ready" moment.
 *
 *   1. Gmail in          -> Booking Recon (booking emails, matched to your trip)
 *   2. Download the app  -> Roamly can reach you in the moment
 *   3. Turn on location  -> Companion goes live
 *
 * Each step is labeled with the feature it powers; completing a step
 * unlocks the next. Steps are completed ONCE per account and
 * remembered forever (see lib/roamly/setupState.ts) — a returning
 * traveler never sees the gate again. Install is recorded only from a
 * real standalone detection; the location step records the grant only
 * after a real position fix lands through the location pipeline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoamlySetupState } from "@/lib/roamly/setupState";
import {
  getNotificationPermissionState,
  getPushCapabilityState,
  subscribeToPushNotifications
} from "@/lib/roamly/pushClient";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function SetupCascade({
  initialState,
  onStateChange
}: {
  initialState: RoamlySetupState;
  onStateChange?: (state: RoamlySetupState) => void;
}) {
  const [setup, setSetup] = useState(initialState);
  const [busy, setBusy] = useState("");
  const [locationError, setLocationError] = useState("");
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  const [alertsPermission, setAlertsPermission] = useState<string>("default");
  const deferredPromptRef = useRef<InstallPromptEvent | null>(null);
  const changeRef = useRef(onStateChange);
  changeRef.current = onStateChange;

  const applyState = useCallback((state: RoamlySetupState) => {
    setSetup(state);
    changeRef.current?.(state);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/roamly/setup/state", { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (data?.state) applyState(data.state as RoamlySetupState);
  }, [applyState]);

  const completeStep = useCallback(
    async (step: "gmail" | "app" | "location", evidence?: string) => {
      const response = await fetch("/api/roamly/setup/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(evidence ? { step, evidence } : { step })
      }).catch(() => null);
      const data = response ? await response.json().catch(() => null) : null;
      if (response?.ok && data?.state) {
        applyState(data.state as RoamlySetupState);
        return true;
      }
      return false;
    },
    [applyState]
  );

  // Platform truth on mount: standalone detection is the install
  // evidence — when Roamly is opened from the home screen, step 2
  // completes itself. Also refresh state (a Gmail connect returns
  // here) and re-check whenever the tab becomes visible again.
  useEffect(() => {
    const capability = getPushCapabilityState();
    setStandalone(capability.isStandalone);
    setIsIOS(capability.isIOS);
    void getNotificationPermissionState().then(setAlertsPermission).catch(() => undefined);
    void refresh();
    if (capability.isStandalone) {
      void completeStep("app", "standalone");
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as InstallPromptEvent;
      setPromptReady(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const next = getPushCapabilityState();
      setStandalone(next.isStandalone);
      void refresh();
      if (next.isStandalone) void completeStep("app", "standalone");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [completeStep, refresh]);

  const gmailDone = setup.gmailOnce;
  const appDone = setup.appInstalledOnce || standalone;
  const locationDone = setup.locationOnce;
  const dones = [gmailDone, appDone, locationDone];
  const currentIndex = dones.findIndex((done) => !done);

  async function installWithPrompt() {
    const deferred = deferredPromptRef.current;
    if (!deferred) return;
    setBusy("app");
    try {
      await deferred.prompt();
      await deferred.userChoice.catch(() => null);
    } catch {
      // The browser declined to show the prompt; instructions remain.
    } finally {
      setBusy("");
    }
  }

  async function turnOnAlerts() {
    setBusy("alerts");
    try {
      await subscribeToPushNotifications().catch(() => null);
      const permission = await getNotificationPermissionState().catch(() => "default");
      setAlertsPermission(permission);
    } finally {
      setBusy("");
    }
  }

  async function enableLocationSwitch() {
    await fetch("/api/roamly/location/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationTrackingEnabled: true })
    }).catch(() => null);
  }

  async function turnOnLocation() {
    setBusy("location");
    setLocationError("");
    try {
      // The persisted switch goes on first — the location pipeline
      // only accepts fixes while it is on.
      await enableLocationSwitch();
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 60_000
        });
      });
      await fetch("/api/roamly/location/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: Number.isFinite(position.timestamp)
            ? new Date(position.timestamp).toISOString()
            : undefined,
          permissionState: "granted"
        })
      });
      const recorded = await completeStep("location");
      if (!recorded) {
        setLocationError("Roamly couldn't confirm the grant yet — try once more.");
      }
    } catch (error) {
      const denied =
        typeof GeolocationPositionError !== "undefined" &&
        error instanceof GeolocationPositionError &&
        error.code === error.PERMISSION_DENIED;
      if (denied) {
        await fetch("/api/roamly/location/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ permissionState: "denied" })
        }).catch(() => null);
        setLocationError(
          "Your browser blocked location. Open the browser's site settings, allow location for Roamly, then tap Turn on location again."
        );
      } else {
        setLocationError("Roamly couldn't get a location fix — check signal and try again.");
      }
    } finally {
      setBusy("");
      void refresh();
    }
  }

  async function turnLocationBackOn() {
    setBusy("location-on");
    try {
      await enableLocationSwitch();
      await refresh();
    } finally {
      setBusy("");
    }
  }

  const stepShell = (
    index: number,
    title: string,
    feature: string,
    children: React.ReactNode
  ) => {
    const done = dones[index];
    const locked = currentIndex !== -1 && index > currentIndex;
    return (
      <section key={title} id={`setup-step-${index + 1}`} className="scroll-mt-24 py-5 first:pt-1 last:pb-1">
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
              done
                ? "bg-ocean text-white"
                : locked
                  ? "bg-slate-100 text-slate-400"
                  : "bg-ink text-white"
            }`}
          >
            {done ? "✓" : index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-black text-ink">{title}</h3>
            <p className="mt-0.5 text-sm font-bold text-slate-500">{feature}</p>
            {locked ? (
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
                Finish step {currentIndex + 1} first — this one unlocks next.
              </p>
            ) : (
              children
            )}
          </div>
        </div>
      </section>
    );
  };

  const actionClass =
    "mt-3 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50";
  const quietLinkClass = "font-bold text-ocean underline underline-offset-2";

  return (
    <div>
      {setup.complete ? (
        <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-bold leading-6 text-slate-600">
          All set — everything works. These steps stay here if you ever need them again.
        </p>
      ) : null}
      <div className="divide-y divide-slate-100">
        {stepShell(
          0,
          "Connect Gmail",
          "Booking Recon — your booking emails, matched to your trip",
          gmailDone ? (
            <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {setup.gmailConnected ? (
                <p>
                  Connected{setup.gmailEmail ? ` — ${setup.gmailEmail}` : ""}. Booking Recon is activated —
                  confirmations are matched to your trips and kept in step.
                </p>
              ) : (
                <p>
                  Connected once — currently disconnected, so Booking Recon is not activated.{" "}
                  <a className={quietLinkClass} href="/api/integrations/gmail/connect">
                    Reconnect Gmail
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                Connect the Gmail that receives your flight and hotel confirmations. That turns on Booking
                Recon: Roamly matches those confirmations to your trip, keeps them in step, and notices when
                something changes.
              </p>
              <a className={actionClass} href="/api/integrations/gmail/connect">
                Connect Gmail
              </a>
            </div>
          )
        )}

        {stepShell(
          1,
          "Download the app",
          "Roamly can reach you in the moment",
          appDone ? (
            <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              <p>Installed. When something matters on your trip, Roamly can reach you right away.</p>
              {standalone && alertsPermission === "default" ? (
                <button type="button" className={actionClass} disabled={busy === "alerts"} onClick={() => void turnOnAlerts()}>
                  {busy === "alerts" ? "Turning on…" : "Turn on alerts"}
                </button>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                {isIOS
                  ? "On iPhone: tap the Share button, then “Add to Home Screen”. Then open Roamly from your home screen — this step finishes itself when you do."
                  : "Install Roamly to your home screen — no app store needed. Then open Roamly from the installed app; this step finishes itself when you do."}
              </p>
              {promptReady ? (
                <button type="button" className={actionClass} disabled={busy === "app"} onClick={() => void installWithPrompt()}>
                  {busy === "app" ? "Opening…" : "Install Roamly"}
                </button>
              ) : null}
            </div>
          )
        )}

        {stepShell(
          2,
          "Turn on location",
          "Companion goes live",
          locationDone ? (
            <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {setup.locationGranted ? (
                setup.locationEnabled ? (
                  <p>On. During your trip days, Live Companion follows along and speaks up only when it matters.</p>
                ) : (
                  <>
                    <p>Granted — and currently switched off. Nothing is followed while it is off.</p>
                    <button type="button" className={actionClass} disabled={busy === "location-on"} onClick={() => void turnLocationBackOn()}>
                      {busy === "location-on" ? "Turning on…" : "Turn location on"}
                    </button>
                  </>
                )
              ) : (
                <>
                  <p>The permission is off in your browser right now. Turn it on so the companion can go live again.</p>
                  <button type="button" className={actionClass} disabled={busy === "location"} onClick={() => void turnOnLocation()}>
                    {busy === "location" ? "Turning on…" : "Turn on location"}
                  </button>
                  {locationError ? (
                    <p role="alert" className="mt-3 rounded-xl bg-mist px-3 py-2 text-xs font-bold leading-5 text-slate-600">
                      {locationError}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                One grant, remembered. Roamly follows along only during your trip days, and you can switch
                it off any time — the grant stays yours.
              </p>
              <button type="button" className={actionClass} disabled={busy === "location"} onClick={() => void turnOnLocation()}>
                {busy === "location" ? "Turning on…" : "Turn on location"}
              </button>
              {locationError ? (
                <p role="alert" className="mt-3 rounded-xl bg-mist px-3 py-2 text-xs font-bold leading-5 text-slate-600">
                  {locationError}
                </p>
              ) : null}
            </div>
          )
        )}
      </div>
    </div>
  );
}
