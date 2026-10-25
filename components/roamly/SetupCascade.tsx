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
  onStateChange,
  variant = "full"
}: {
  initialState: RoamlySetupState;
  onStateChange?: (state: RoamlySetupState) => void;
  /** "full" (Settings): every step explains itself inline. "compact"
   *  (the trip-ready gate): the mock's quiet rows — the current step's
   *  action sits on its row as a blue text action, done reads "✓ Done",
   *  locked rows stay silent and the unlock note sits under the card. */
  variant?: "full" | "compact";
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

  const compact = variant === "compact";
  const compactActionClass = "shrink-0 text-base font-normal text-cblue disabled:opacity-50";

  const stepShell = (
    index: number,
    title: string,
    feature: string,
    children: React.ReactNode,
    compactAction?: React.ReactNode
  ) => {
    const done = dones[index];
    const locked = currentIndex !== -1 && index > currentIndex;
    return (
      <section key={title} id={`setup-step-${index + 1}`} className="scroll-mt-24 px-4 pb-[15px] pt-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={`text-[17px] font-semibold leading-tight ${locked ? "text-cgray" : "text-chead"}`}>{title}</h3>
            <p className={`mt-0.5 text-[14.5px] font-normal leading-snug ${locked ? "text-cgray2" : "text-cgray"}`}>{feature}</p>
          </div>
          {locked ? (
            <span className="shrink-0 text-[15px] font-normal text-cgray2">Locked</span>
          ) : compact && compactAction ? (
            compactAction
          ) : done ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[15px] font-normal text-cgray">
              <span aria-hidden className="text-cgreen">✓</span> Done
            </span>
          ) : null}
        </div>
        {!locked && !(compact && compactAction) ? children : null}
        {compact && index === 2 && locationError ? (
          <p role="alert" className="mt-3 rounded-xl bg-cred/10 px-3 py-2 text-xs font-medium leading-5 text-cink">
            {locationError}
          </p>
        ) : null}
      </section>
    );
  };

  const actionClass =
    "mt-3 flex min-h-[50px] w-full items-center justify-center rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white disabled:opacity-50";
  const quietLinkClass = "font-semibold text-cblue";
  const firstLockedIndex = currentIndex !== -1 ? dones.findIndex((done, i) => i > currentIndex) : -1;

  return (
    <>
    <div className="overflow-hidden rounded-[14px] bg-white shadow-calm">
      {setup.complete ? (
        <p className="border-b border-chair px-4 py-3 text-sm font-normal leading-6 text-cink">
          All set — everything works. These steps stay here if you ever need them again.
        </p>
      ) : null}
      <div className="divide-y divide-chair">
        {stepShell(
          0,
          "Booking Recon",
          "Your booking emails, matched to your trip",
          gmailDone ? (
            <div className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
              {setup.gmailConnected && setup.gmailSyncFailing ? (
                <p>
                  Connected{setup.gmailEmail ? ` — ${setup.gmailEmail}` : ""}, but Gmail sync hasn&apos;t
                  worked since {setup.gmailLastSyncedAt ? new Date(setup.gmailLastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "its last sync"}.{" "}
                  {setup.gmailSyncFailureReconnect ? (
                    <a className={quietLinkClass} href="/api/integrations/gmail/connect">
                      Reconnect Gmail
                    </a>
                  ) : (
                    <a className={quietLinkClass} href="#email-settings">
                      Sync Gmail again
                    </a>
                  )}
                </p>
              ) : setup.gmailConnected ? (
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
              <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
                Connect the Gmail that receives your flight and hotel confirmations. That turns on Booking
                Recon: Roamly matches those confirmations to your trip, keeps them in step, and notices when
                something changes.
              </p>
              <a className={actionClass} href="/api/integrations/gmail/connect">
                Connect Gmail
              </a>
            </div>
          ),
          gmailDone && !setup.gmailConnected ? (
            <a className={compactActionClass} href="/api/integrations/gmail/connect">
              Reconnect
            </a>
          ) : !gmailDone ? (
            <a className={compactActionClass} href="/api/integrations/gmail/connect">
              Connect Gmail
            </a>
          ) : undefined
        )}

        {stepShell(
          1,
          "Download the app",
          "Roamly can reach you in the moment",
          appDone ? (
            <div className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
              <p>Installed. When something matters on your trip, Roamly can reach you right away.</p>
              {standalone && alertsPermission === "default" ? (
                <button type="button" className={actionClass} disabled={busy === "alerts"} onClick={() => void turnOnAlerts()}>
                  {busy === "alerts" ? "Turning on…" : "Turn on alerts"}
                </button>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
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
          ),
          appDone && standalone && alertsPermission === "default" ? (
            <button type="button" className={compactActionClass} disabled={busy === "alerts"} onClick={() => void turnOnAlerts()}>
              {busy === "alerts" ? "Turning on…" : "Turn on alerts"}
            </button>
          ) : !appDone && promptReady ? (
            <button type="button" className={compactActionClass} disabled={busy === "app"} onClick={() => void installWithPrompt()}>
              {busy === "app" ? "Opening…" : "Install"}
            </button>
          ) : undefined
        )}

        {stepShell(
          2,
          "Turn on location",
          "Companion goes live",
          locationDone ? (
            <div className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
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
                    <p role="alert" className="mt-3 rounded-xl bg-cred/10 px-3 py-2 text-xs font-medium leading-5 text-cink">
                      {locationError}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div>
              <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
                One grant, remembered. Roamly follows along only during your trip days, and you can switch
                it off any time — the grant stays yours.
              </p>
              <button type="button" className={actionClass} disabled={busy === "location"} onClick={() => void turnOnLocation()}>
                {busy === "location" ? "Turning on…" : "Turn on location"}
              </button>
              {locationError ? (
                <p role="alert" className="mt-3 rounded-xl bg-cred/10 px-3 py-2 text-xs font-medium leading-5 text-cink">
                  {locationError}
                </p>
              ) : null}
            </div>
          ),
          locationDone && setup.locationGranted && !setup.locationEnabled ? (
            <button type="button" className={compactActionClass} disabled={busy === "location-on"} onClick={() => void turnLocationBackOn()}>
              {busy === "location-on" ? "Turning on…" : "Turn on"}
            </button>
          ) : locationDone && !setup.locationGranted ? (
            <button type="button" className={compactActionClass} disabled={busy === "location"} onClick={() => void turnOnLocation()}>
              {busy === "location" ? "Turning on…" : "Turn on location"}
            </button>
          ) : !locationDone ? (
            <button type="button" className={compactActionClass} disabled={busy === "location"} onClick={() => void turnOnLocation()}>
              {busy === "location" ? "Turning on…" : "Turn on location"}
            </button>
          ) : undefined
        )}
      </div>
    </div>
    {compact && firstLockedIndex !== -1 ? (
      <p className="mx-4 mt-2 text-[13.5px] font-normal leading-5 text-cgray">
        Finish step {currentIndex + 1} first — this one unlocks next.
      </p>
    ) : null}
    </>
  );
}
