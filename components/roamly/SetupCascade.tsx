"use client";

/*
 * SetupCascade — the one place Roamly's three prerequisites live
 * (owner design, 2026-10-23): a calm, cascading sequence in Settings,
 * reused as the gate at the "Your trip is ready" moment.
 *
 *   1. Gmail in          -> Booking Recon (booking emails, matched to your trip)
 *   2. Download the app  -> Roamly can message you on your travel days
 *   3. Turn on location  -> Companion goes live
 *
 * Each step is labeled with the feature it powers; completing a step
 * unlocks the next. Steps are completed ONCE per account and
 * remembered forever (see lib/roamly/setupState.ts) — a returning
 * traveler never sees the gate again. Install is recorded only from a
 * real standalone detection; the location step records the grant only
 * after a real position fix lands through the location pipeline.
 *
 * Variant "optional" (owner-approved Setup design, 2026-10-26) is the
 * SAME engine with the mock's presentation: three independent cards,
 * all actionable at once (no sequential lock, no QR block, no
 * "finish step first" note) — "Optional setup (recommended)" on the
 * gate screen. Parallel presentation does NOT weaken the gate: a step
 * still completes only on the same server-verified evidence, the gate
 * still stands until every step is done or the traveler skips, and
 * skipping still reveals with limited features only. The "full" and
 * "compact" paths are unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, ChevronRight, Mail, MapPin, Smartphone } from "lucide-react";
import type { RoamlySetupState } from "@/lib/roamly/setupState";
import {
  getNotificationPermissionState,
  getPushCapabilityState,
  subscribeToPushNotifications
} from "@/lib/roamly/pushClient";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiChip } from "@/components/boardui/Badge";
import { BuiNotice } from "@/components/boardui/Notice";

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
   *  locked rows stay silent and the unlock note sits under the card.
   *  "optional" (owner-approved gate design): the mock's three cards,
   *  all actionable at once; same handlers and evidence as below. */
  variant?: "full" | "compact" | "optional";
}) {
  const [setup, setSetup] = useState(initialState);
  const [busy, setBusy] = useState("");
  const [locationError, setLocationError] = useState("");
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  // Plain site-origin app link for the transfer QR code — no user data,
  // no signed pass, no trip data. Set client-side only (SSR has no origin).
  const [appLink, setAppLink] = useState("");
  const [appRecheckMessage, setAppRecheckMessage] = useState("");
  const [locationUnsupported, setLocationUnsupported] = useState(false);
  // "optional" variant only: the home-screen card's instructions are
  // hidden until "Show instructions" is tapped (the mock's button).
  const [showAppInstructions, setShowAppInstructions] = useState(false);
  const [alertsPermission, setAlertsPermission] = useState<string>("default");
  const [alertsError, setAlertsError] = useState("");
  // Live Companion activation for the selected trip, from the ONE
  // server read-back (lib/roamly/liveStatus.ts via /api/roamly/live-status).
  // The location step shows this instead of assuming Live is on after
  // the grant lands (2026-10-31).
  const [liveActivation, setLiveActivation] = useState<{
    tripId: string | null;
    armed: boolean;
    status: string;
    reason: string;
  } | null>(null);
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

  const refreshLiveStatus = useCallback(async () => {
    const response = await fetch("/api/roamly/live-status", { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (data?.status?.live) {
      setLiveActivation({
        tripId: data.status.tripId ?? null,
        armed: data.status.live.armed === true,
        status: String(data.status.live.status || ""),
        reason: String(data.status.live.reason || "")
      });
    }
  }, []);

  // The server's own reason for the most recent refused completion
  // (e.g. setup/complete's "No fresh location fix confirms the grant
  // yet."). Kept so callers can surface the truthful reason instead of
  // collapsing every refusal into one generic line (2026-10-31).
  const completeErrorRef = useRef<string | null>(null);

  const completeStep = useCallback(
    async (step: "gmail" | "app" | "location" | "alerts", evidence?: string) => {
      const response = await fetch("/api/roamly/setup/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(evidence ? { step, evidence } : { step })
      }).catch(() => null);
      const data = response ? await response.json().catch(() => null) : null;
      if (response?.ok && data?.state) {
        completeErrorRef.current = null;
        applyState(data.state as RoamlySetupState);
        return true;
      }
      completeErrorRef.current = typeof data?.error === "string" && data.error ? data.error : null;
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
    // Transfer QR link: the plain site origin, nothing personal.
    if (typeof window !== "undefined" && window.location?.origin) {
      setAppLink(window.location.origin);
    }
    // Distinct unsupported state: a device/browser with no Geolocation
    // API can never grant location — surface that plainly, never as a
    // generic "couldn't get a fix" error.
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocationUnsupported(true);
    }
    void getNotificationPermissionState().then(setAlertsPermission).catch(() => undefined);
    void refresh();
    void refreshLiveStatus();
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
      void refreshLiveStatus();
      if (next.isStandalone) void completeStep("app", "standalone");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [completeStep, refresh, refreshLiveStatus]);

  const gmailDone = setup.gmailOnce;
  const appDone = setup.appInstalledOnce || standalone;
  const locationDone = setup.locationOnce;
  const dones = [gmailDone, appDone, locationDone];
  const currentIndex = dones.findIndex((done) => !done);
  // BoardUI progress presentation only: derived from the same `dones`
  // evidence above — it changes no gating or completion condition.
  const doneCount = dones.filter(Boolean).length;

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

  // Manual recheck for the app step: the SAME path the mount and
  // visibilitychange auto-checks use — re-run the real standalone
  // detection, and only then completeStep("app", "standalone"). It
  // never self-reports completion: not standalone, no completion.
  const recheckAppInstall = useCallback(async () => {
    setBusy("app-recheck");
    setAppRecheckMessage("");
    try {
      const next = getPushCapabilityState();
      setStandalone(next.isStandalone);
      if (next.isStandalone) {
        await completeStep("app", "standalone");
      } else {
        setAppRecheckMessage(
          // Audit fix: a browser tab cannot detect a home-screen
          // install (navigator.standalone / the standalone media query
          // describe THIS tab, not the device). The old copy asserted
          // "Roamly isn't on your home screen yet" to owners who had
          // already installed it. State only what is true.
          "A browser tab can't check your home screen. If Roamly is already there, open it from your home screen once and this step completes itself. If it isn't, add it from your browser menu first, then open it from your home screen."
        );
      }
      await refresh();
    } finally {
      setBusy("");
    }
  }, [completeStep, refresh]);

  // Permissions API pre-check for location: returns "granted" |
  // "prompt" | "denied", or null when the API is unavailable — in
  // which case callers proceed exactly as before (fire the prompt).
  async function queryLocationPermission(): Promise<string | null> {
    try {
      const permissions = (
        navigator as Navigator & {
          permissions?: { query: (descriptor: { name: string }) => Promise<{ state: string }> };
        }
      ).permissions;
      if (!permissions?.query) return null;
      const result = await permissions.query({ name: "geolocation" });
      return result.state;
    } catch {
      return null;
    }
  }

  // Alerts completion is READ-BACK verified (L9, 2026-10-31): the
  // subscribe attempt's own result is never trusted — the step
  // completes only when the server finds the subscription row
  // (completeStep "alerts"), and a refusal surfaces the server's own
  // reason here instead of the step silently looking done.
  async function turnOnAlerts() {
    setBusy("alerts");
    setAlertsError("");
    try {
      const result = await subscribeToPushNotifications().catch(() => null);
      const permission = await getNotificationPermissionState().catch(() => "default");
      setAlertsPermission(permission);
      const recorded = await completeStep("alerts");
      if (!recorded) {
        setAlertsError(
          completeErrorRef.current ||
            (result && !result.ok ? result.error : null) ||
            setup.notificationsReason ||
            "No push subscription found."
        );
      }
      await refresh();
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
      // Distinct unsupported state: no Geolocation API at all — do
      // not enable the switch and do not fire a prompt that cannot
      // exist. This message is its own state, not the generic error.
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        setLocationUnsupported(true);
        setLocationError(
          "Location sharing isn't supported on this device or browser, so this step can't be turned on here."
        );
        return;
      }
      setLocationUnsupported(false);
      // Permissions API pre-check, BEFORE firing the browser prompt:
      // already denied → show the site-settings guidance and do NOT
      // re-prompt (a denied browser will not show a prompt anyway);
      // prompt (or unknown) → proceed exactly as before.
      const preCheck = await queryLocationPermission();
      if (preCheck === "denied") {
        setLocationError(
          "Location is already blocked for Roamly in this browser, so no new prompt will appear. Open your browser's site settings, allow location for Roamly, then tap Turn on location again."
        );
        return;
      }
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
      // Reason wiring (2026-10-31): the update route answers with
      // distinct truthful reasons (stale fix, account switch off, save
      // failure). They used to be discarded unread, and the completion
      // refusal below collapsed into one generic line. Surface the
      // server's own words — no new customer copy — with the existing
      // generic line only as the no-reason fallback.
      const updateResponse = await fetch("/api/roamly/location/update", {
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
      }).catch(() => null);
      const updateData = updateResponse ? await updateResponse.json().catch(() => null) : null;
      const updateReason =
        typeof updateData?.message === "string" && updateData.message
          ? updateData.message
          : typeof updateData?.error === "string" && updateData.error
            ? updateData.error
            : null;
      const recorded = await completeStep("location");
      if (!recorded) {
        setLocationError(updateReason || completeErrorRef.current || "Roamly couldn't confirm the grant yet — try once more.");
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
  const compactActionClass = "bui-touch shrink-0 text-base font-normal text-cblue disabled:opacity-50";

  // ---- "optional" presentation (owner-approved gate design) ----
  // Same state and handlers as the cascade below; only the cards
  // differ. Icons are simple inline glyphs (no brand assets copied);
  // layout, copy, and actions follow the approved mock exactly.
  if (variant === "optional") {
    const cardClass = "bui-enter p-4";
    const iconBox = (tone: string, glyph: React.ReactNode) => (
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`} aria-hidden="true">
        {glyph}
      </span>
    );
    const chevron = (
      <span aria-hidden="true" className="ml-3 flex shrink-0 items-center text-cchev"><ChevronRight size={20} strokeWidth={2} /></span>
    );
    const outlineButtonClass =
      "inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-cblue bg-white px-5 text-[15px] font-semibold text-cblue disabled:opacity-50";
    // Picture 3 literal: the Gmail button is SOLID blue; the other
    // two optional buttons stay blue-outline (see the enlarged crop).
    // Kept seam (deliberate): this settled Picture 3 design outranks
    // the generic BoardUI skin for these elements — do not route
    // them through BuiButton / BuiButtonLink.
    const solidButtonClass =
      "inline-flex min-h-12 items-center justify-center rounded-xl bg-cblue px-5 text-[15px] font-semibold text-white disabled:opacity-50";
    // Picture 3 literal: buttons sit under the TEXT column, indented
    // past the icon (w-11) + its px-3 gutter = 56px = ml-14.
    const doneCheck = (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cgreen/15 text-cgreen" aria-hidden="true"><Check size={22} strokeWidth={2.5} /></span>
    );
    const cardHead = (icon: React.ReactNode, title: string, description: string) => (
      <div className="flex items-start">
        {icon}
        <div className="min-w-0 flex-1 px-3">
          <h3 className="text-[17px] font-semibold leading-tight text-chead">{title}</h3>
          <p className="mt-0.5 text-[14.5px] font-normal leading-snug text-cgray">{description}</p>
        </div>
        {chevron}
      </div>
    );
    return (
      <div className="grid gap-3">
        <BuiCard className={cardClass}>
          {gmailDone ? (
            <>
              <div className="flex items-start">
                {doneCheck}
                <div className="min-w-0 flex-1 px-3">
                  <h3 className="text-[17px] font-semibold leading-tight text-chead">Connect Gmail for Booking Recon</h3>
                  <p className="mt-0.5 text-[14.5px] font-normal leading-snug text-cgray">
                    {setup.gmailConnected
                      ? `Connected${setup.gmailEmail ? ` — ${setup.gmailEmail}` : ""}. Booking Recon is activated.`
                      : "Connected once — currently disconnected, so Booking Recon is not activated."}
                  </p>
                </div>
                {chevron}
              </div>
              {!setup.gmailConnected ? (
                <div className="ml-14 mt-3">
                  <a className={outlineButtonClass} href="/api/integrations/gmail/connect">
                    Reconnect Gmail
                  </a>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {cardHead(
                iconBox("bg-red-50 text-red-500", (
                  <Mail size={22} strokeWidth={2} aria-hidden="true" />
                )),
                "Connect Gmail for Booking Recon",
                "Automatically find your flight, hotel and activity confirmations."
              )}
              <div className="ml-14 mt-3">
                <a className={solidButtonClass} href="/api/integrations/gmail/connect">
                  Connect Gmail
                </a>
              </div>
            </>
          )}
        </BuiCard>

        <BuiCard className={cardClass}>
          {appDone ? (
            <div className="flex items-start">
              {doneCheck}
              <div className="min-w-0 flex-1 px-3">
                <h3 className="text-[17px] font-semibold leading-tight text-chead">Add Roamly to your home screen</h3>
                <p className="mt-0.5 text-[14.5px] font-normal leading-snug text-cgray">
                  {setup.notificationsSubscribed
                    ? "Installed. On your travel days, Roamly can send you timely messages about your trip."
                    : "Installed. Alerts are a separate step — turn them on so Roamly can reach you."}
                </p>
              </div>
              {chevron}
            </div>
          ) : (
            <>
              {cardHead(
                iconBox("bg-sky-50 text-sky-600", (
                  <Smartphone size={22} strokeWidth={2} aria-hidden="true" />
                )),
                "Add Roamly to your home screen",
                "Get trip messages on your travel days and a smoother experience."
              )}
              <div className="ml-14 mt-3">
                <button type="button" className={outlineButtonClass} onClick={() => setShowAppInstructions((v) => !v)}>
                  {showAppInstructions ? "Hide instructions" : "Show instructions"}
                </button>
                {showAppInstructions ? (
                  <div className="mt-3">
                    <p className="text-[15px] font-normal leading-[1.45] text-cink">
                      {isIOS
                        ? "On iPhone: tap the Share button, then “Add to Home Screen”. Then open Roamly from your home screen — this step finishes itself when you do."
                        : "On Android / Chrome: tap ⋮ → Add to Home screen / Install app. Then open Roamly from your home screen — no app store needed, and this step finishes itself when you do."}
                    </p>
                    {promptReady ? (
                      <button type="button" className={`${outlineButtonClass} mt-3`} disabled={busy === "app"} onClick={() => void installWithPrompt()}>
                        {busy === "app" ? "Opening…" : "Install Roamly"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`${outlineButtonClass} mt-3 ${promptReady ? "ml-3" : ""}`}
                      disabled={busy === "app-recheck"}
                      onClick={() => void recheckAppInstall()}
                    >
                      {busy === "app-recheck" ? "Checking…" : "I've added it — continue"}
                    </button>
                    {appRecheckMessage ? (
                      <BuiNotice tone="error" title={appRecheckMessage} className="mt-3" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </BuiCard>

        <BuiCard className={cardClass}>
          {locationDone && setup.locationGranted && setup.locationEnabled ? (
            <div className="flex items-start">
              {doneCheck}
              <div className="min-w-0 flex-1 px-3">
                <h3 className="text-[17px] font-semibold leading-tight text-chead">Enable location (for Live Companion)</h3>
                <p className="mt-0.5 text-[14.5px] font-normal leading-snug text-cgray">
                  On. While Roamly is open on your travel days, Live Companion shows what is near, flags timing, and offers changes for you to approve.
                </p>
              </div>
              {chevron}
            </div>
          ) : (
            <>
              {cardHead(
                iconBox("bg-csoft text-cblue", (
                  <MapPin size={22} strokeWidth={2} aria-hidden="true" />
                )),
                "Enable location (for Live Companion)",
                "See what is near when you open Roamly during your trip."
              )}
              <div className="ml-14 mt-3">
                {locationDone && setup.locationGranted && !setup.locationEnabled ? (
                  <button type="button" className={outlineButtonClass} disabled={busy === "location-on"} onClick={() => void turnLocationBackOn()}>
                    {busy === "location-on" ? "Turning on…" : "Turn location on"}
                  </button>
                ) : (
                  <button type="button" className={outlineButtonClass} disabled={busy === "location"} onClick={() => void turnOnLocation()}>
                    {busy === "location" ? "Turning on…" : "Enable location"}
                  </button>
                )}
                {locationUnsupported ? (
                  <p className="mt-3 text-[15px] font-normal leading-[1.45] text-cink">
                    Location sharing isn&apos;t supported on this device or browser, so this step can&apos;t be
                    turned on here.
                  </p>
                ) : null}
                {locationError ? (
                  <BuiNotice tone="error" title={locationError} className="mt-3" />
                ) : null}
              </div>
            </>
          )}
        </BuiCard>
      </div>
    );
  }

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
      <section key={title} id={`setup-step-${index + 1}`} className="bui-enter scroll-mt-24 px-4 pb-[15px] pt-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={`text-[17px] font-semibold leading-tight ${locked ? "text-cgray" : "text-chead"}`}>{title}</h3>
            <p className={`mt-0.5 text-[14.5px] font-normal leading-snug ${locked ? "text-cgray2" : "text-cgray"}`}>{feature}</p>
          </div>
          {locked ? (
            <BuiChip tone="neutral" className="shrink-0">Locked</BuiChip>
          ) : compact && compactAction ? (
            compactAction
          ) : done ? (
            <BuiChip tone="success" className="shrink-0">
              <span aria-hidden className="text-cgreen">✓</span> Done
            </BuiChip>
          ) : null}
        </div>
        {!locked && !(compact && compactAction) ? children : null}
        {compact && index === 1 && alertsError ? (
          <BuiNotice tone="error" title={alertsError} className="mt-3" />
        ) : null}
        {compact && index === 2 && locationError ? (
          <BuiNotice tone="error" title={locationError} className="mt-3" />
        ) : null}
      </section>
    );
  };

  const actionClass =
    "bui-press bui-touch mt-3 flex min-h-[50px] w-full items-center justify-center rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white disabled:opacity-50";
  const quietLinkClass = "bui-touch font-semibold text-cblue";
  const firstLockedIndex = currentIndex !== -1 ? dones.findIndex((done, i) => i > currentIndex) : -1;

  return (
    <>
    <BuiCard className="overflow-hidden rounded-bui-panel">
      <div className="bui-enter border-b border-chair px-4 py-3" aria-hidden="true">
        <div className="flex gap-1.5">
          {dones.map((done, index) => (
            <span key={index} className={`h-1.5 flex-1 rounded-full ${done ? "bg-cgreen" : "bg-chair"}`} />
          ))}
        </div>
        <p className="bui-display-number mt-2 text-xs font-semibold text-cgray">
          {doneCount} / {dones.length}
        </p>
      </div>
      {setup.complete && setup.notificationsSubscribed ? (
        <p className="border-b border-chair px-4 py-3 text-sm font-normal leading-6 text-cink">
          {/* Success Rules pass (2026-11-03), census row 20: the
              summary used to say only "everything works". It now
              names what is actually on — this line renders only
              when every step is complete and alerts are subscribed,
              so each named piece is true when it appears. */}
          All set — Booking Recon is on{setup.gmailEmail ? ` for ${setup.gmailEmail}` : ""}, trip alerts are
          on, and location is on. These steps stay here if you ever need them again.
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
          "Roamly can message you on your travel days",
          appDone ? (
            <div className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
              <p>
                {setup.notificationsSubscribed
                  ? "Installed. On your travel days, Roamly can send you timely messages about your trip."
                  : "Installed. Alerts are separate — turn them on below so Roamly can reach you."}
              </p>
              {setup.notificationsSubscribed ? (
                <p className="mt-2">Alerts are on.</p>
              ) : (
                <>
                  <BuiButton type="button" busy={busy === "alerts"} onClick={() => void turnOnAlerts()} className="mt-3 w-full">
                    {busy === "alerts" ? "Turning on…" : "Turn on alerts"}
                  </BuiButton>
                  {alertsError ? (
                    <BuiNotice tone="error" title={alertsError} className="mt-3" />
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div>
              <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
                {isIOS
                  ? "On iPhone: tap the Share button, then “Add to Home Screen”. Then open Roamly from your home screen — this step finishes itself when you do."
                  : "On Android / Chrome: tap ⋮ → Add to Home screen / Install app. Then open Roamly from your home screen — no app store needed, and this step finishes itself when you do."}
              </p>
              {promptReady ? (
                <BuiButton type="button" busy={busy === "app"} onClick={() => void installWithPrompt()} className="mt-3 w-full">
                  {busy === "app" ? "Opening…" : "Install Roamly"}
                </BuiButton>
              ) : null}
              <BuiButton
                type="button"
                variant="secondary"
                busy={busy === "app-recheck"}
                onClick={() => void recheckAppInstall()}
                className="mt-3 w-full"
              >
                {busy === "app-recheck" ? "Checking…" : "I've added it — continue"}
              </BuiButton>
              {appRecheckMessage ? (
                <BuiNotice tone="error" title={appRecheckMessage} className="mt-3" />
              ) : null}
              {!setup.notificationsSubscribed ? (
                <>
                  <BuiButton
                    type="button"
                    variant="secondary"
                    busy={busy === "alerts"}
                    onClick={() => void turnOnAlerts()}
                    className="mt-3 w-full"
                  >
                    {busy === "alerts" ? "Turning on…" : "Turn on alerts"}
                  </BuiButton>
                  {alertsError ? (
                    <BuiNotice tone="error" title={alertsError} className="mt-3" />
                  ) : null}
                </>
              ) : null}
              {appLink ? (
                <div className="mt-4 border-t border-chair pt-3">
                  <p className="text-[15px] font-semibold leading-[1.45] text-chead">Open on another phone? Scan this</p>
                  <p className="mt-1 text-[14px] font-normal leading-snug text-cgray">
                    Point another phone&apos;s camera at this code to open Roamly there, then add it to that
                    phone&apos;s home screen.
                  </p>
                  <div className="mt-2 inline-block rounded-xl border border-chair bg-white p-2">
                    <QRCodeSVG value={appLink} size={132} />
                  </div>
                </div>
              ) : null}
            </div>
          ),
          appDone && !setup.notificationsSubscribed ? (
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
                  <>
                    <p>On. While Roamly is open on your travel days, Live Companion shows what is near, flags timing, and offers changes for you to approve.</p>
                    {liveActivation && liveActivation.tripId && !liveActivation.armed ? (
                      <p className="mt-2">{liveActivation.reason}</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p>Granted — and currently switched off. Nothing is followed while it is off.</p>
                    <BuiButton type="button" busy={busy === "location-on"} onClick={() => void turnLocationBackOn()} className="mt-3 w-full">
                      {busy === "location-on" ? "Turning on…" : "Turn location on"}
                    </BuiButton>
                  </>
                )
              ) : (
                <>
                  <p>The permission is off in your browser right now. Turn it on so the companion can go live again.</p>
                  <BuiButton type="button" busy={busy === "location"} onClick={() => void turnOnLocation()} className="mt-3 w-full">
                    {busy === "location" ? "Turning on…" : "Turn on location"}
                  </BuiButton>
                  {locationError ? (
                    <BuiNotice tone="error" title={locationError} className="mt-3" />
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div>
              {locationUnsupported ? (
                <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
                  Location sharing isn&apos;t supported on this device or browser, so this step can&apos;t be
                  turned on here.
                </p>
              ) : null}
              <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
                One grant, remembered. Location is foreground-only: Roamly checks where you are only while
                the app is open on screen, and only during your trip days. You can switch it off any time —
                the grant stays yours.
              </p>
              <BuiButton type="button" busy={busy === "location"} onClick={() => void turnOnLocation()} className="mt-3 w-full">
                {busy === "location" ? "Turning on…" : "Turn on location"}
              </BuiButton>
              {locationError ? (
                <BuiNotice tone="error" title={locationError} className="mt-3" />
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
    </BuiCard>
    {compact && firstLockedIndex !== -1 ? (
      <p className="mx-4 mt-2 text-[13.5px] font-normal leading-5 text-cgray">
        Finish step {currentIndex + 1} first — this one unlocks next.
      </p>
    ) : null}
    </>
  );
}
