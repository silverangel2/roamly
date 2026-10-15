"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";
import {
  getPushCapabilityState,
  getNotificationPermissionState,
  hasPushSubscription,
  subscribeToPushNotifications,
  type PushCapabilityState
} from "@/lib/roamly/pushClient";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Phase = "loading" | "install" | "notify" | "done" | "dismissed" | "unsupported";

const DISMISS_KEY = "roamly:companion-install-dismissed";

/**
 * Post-purchase companion setup step, mounted on /trip/[id] right after a
 * successful itinerary checkout. Moves the install + notifications ask UP from
 * the trip page: step 1 installs Roamly to the Home Screen (native prompt on
 * Android, Share → Add to Home Screen guidance on iOS), step 2 enables trip
 * alerts via the existing push stack. Self-hides when the traveler is set up
 * or has dismissed it — the trip page's own setup card remains the second
 * chance.
 */
export function CompanionInstallStep() {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [capability, setCapability] = useState<PushCapabilityState | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null);
  const [installAccepted, setInstallAccepted] = useState(false);
  const [permissionState, setPermissionState] = useState<string>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rememberDismissed = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage unavailable — the card simply shows again next visit.
    }
  }, []);

  const dismiss = useCallback(() => {
    rememberDismissed();
    setPhase("dismissed");
  }, [rememberDismissed]);

  const evaluate = useCallback(async () => {
    const cap = getPushCapabilityState();
    setCapability(cap);
    if (!cap.notificationSupported && !cap.serviceWorkerSupported) {
      setPhase("unsupported");
      return;
    }
    const permission = await getNotificationPermissionState();
    setPermissionState(permission);
    const subscribed = permission === "granted" ? await hasPushSubscription().catch(() => false) : false;
    if (cap.isStandalone && permission === "granted" && subscribed) {
      setPhase("done");
      return;
    }
    setPhase(cap.isStandalone || installAccepted ? "notify" : "install");
  }, [installAccepted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) {
        setPhase("dismissed");
        return;
      }
    } catch {
      // fall through — localStorage unavailable
    }
    let alive = true;
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (alive) setDeferredPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    const onPageShow = () => {
      if (alive) void evaluate();
    };
    window.addEventListener("pageshow", onPageShow);
    void evaluate();
    return () => {
      alive = false;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [evaluate]);

  async function startAndroidInstall() {
    if (!deferredPrompt) return;
    setBusy(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choice.outcome === "accepted") {
        setInstallAccepted(true);
        setPhase("notify");
      }
    } catch {
      // Native prompt failed — stay on the install step with the guide.
    }
    setBusy(false);
  }

  async function enableAlerts() {
    setBusy(true);
    setError("");
    const result = await subscribeToPushNotifications();
    setBusy(false);
    if (result.ok) {
      rememberDismissed();
      setPhase("done");
      return;
    }
    setError(
      result.error
        ? localizeCustomerError(locale, result.error)
        : t("ui.companionInstall.enableFailed", "Could not enable trip alerts. In-app notifications still work.")
    );
    const state = await getNotificationPermissionState();
    setPermissionState(state);
  }

  if (phase === "loading") {
    return (
      <div className="mt-6 animate-pulse rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
        <div className="h-4 w-32 rounded bg-mist" />
        <div className="mt-3 h-6 w-2/3 rounded bg-mist" />
        <div className="mt-3 h-10 w-48 rounded-2xl bg-mist" />
      </div>
    );
  }

  if (phase === "dismissed" || phase === "unsupported" || !capability) return null;

  const eyebrow = (
    <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
      {t("ui.companionInstall.stepLabel", "Live Companion")}
      {phase !== "done" ? (
        <span className="ml-2 text-slate-400">
          {phase === "install"
            ? t("ui.companionInstall.stepOneOfTwo", "Step 1 of 2 — Install")
            : t("ui.companionInstall.stepTwoOfTwo", "Step 2 of 2 — Alerts")}
        </span>
      ) : null}
    </p>
  );

  const laterButton = (
    <button
      type="button"
      onClick={dismiss}
      disabled={busy}
      className="mt-3 inline-flex min-h-11 items-center text-sm font-black text-slate-500 underline-offset-4 hover:underline disabled:opacity-60"
    >
      {t("ui.companionInstall.later", "Later")}
    </button>
  );

  if (phase === "done") {
    return (
      <div className="mt-6 rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
        {eyebrow}
        <h3 className="mt-2 text-xl font-black text-ink">
          {t("ui.companionInstall.doneTitle", "You’re set for live trip alerts")}
        </h3>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
          {t(
            "ui.companionInstall.doneBody",
            "This device will get flight changes, check-in reminders, and what’s-up-next nudges while you travel."
          )}
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-mist px-4 text-sm font-black text-ink"
        >
          {t("ui.companionInstall.gotIt", "Got it")}
        </button>
      </div>
    );
  }

  if (phase === "install") {
    return (
      <div className="mt-6 rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
        {eyebrow}
        <h3 className="mt-2 text-xl font-black text-ink">
          {t("ui.companionInstall.installTitle", "Add Roamly to your Home Screen")}
        </h3>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
          {t(
            "ui.companionInstall.installBody",
            "Get live flight changes, check-in nudges, and what’s-up-next alerts on your phone while you travel."
          )}
        </p>
        {deferredPrompt ? (
          <button
            type="button"
            onClick={() => void startAndroidInstall()}
            disabled={busy}
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-ocean px-4 py-3 text-sm font-black text-white disabled:opacity-60 sm:w-auto"
          >
            {t("ui.companionInstall.addToHomeScreen", "Add Roamly to your Home Screen")}
          </button>
        ) : capability.isIOS ? (
          <div className="mt-4 rounded-2xl bg-mist p-4">
            <ol className="grid gap-2 text-sm font-bold leading-6 text-slate-600">
              <li>
                <span className="mr-2 font-black text-ocean">1.</span>
                {t("ui.companionInstall.iosStep1", "Tap the Share button at the bottom of Safari.")}
              </li>
              <li>
                <span className="mr-2 font-black text-ocean">2.</span>
                {t("ui.companionInstall.iosStep2", "Scroll down and tap Add to Home Screen.")}
              </li>
              <li>
                <span className="mr-2 font-black text-ocean">3.</span>
                {t("ui.companionInstall.iosStep3", "Tap Add, then open Roamly from the new Home Screen icon.")}
              </li>
            </ol>
            <button
              type="button"
              onClick={() => void evaluate()}
              disabled={busy}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-ocean px-4 py-3 text-sm font-black text-white disabled:opacity-60"
            >
              {t("ui.companionInstall.iveAddedIt", "I’ve added it — continue")}
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl bg-mist p-4">
            <p className="text-sm font-bold leading-6 text-slate-600">
              {t(
                "ui.companionInstall.genericInstallNote",
                "Use your browser’s menu (⋮ → “Add to Home screen” / “Install app”), then open Roamly from the new Home Screen icon."
              )}
            </p>
            <button
              type="button"
              onClick={() => void evaluate()}
              disabled={busy}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-ocean px-4 py-3 text-sm font-black text-white disabled:opacity-60"
            >
              {t("ui.companionInstall.iveAddedIt", "I’ve added it — continue")}
            </button>
          </div>
        )}
        {laterButton}
      </div>
    );
  }

  // phase === "notify"
  const requiresHomeScreen = capability.requiresHomeScreenInstall;
  const isDenied = permissionState === "denied";

  return (
    <div className="mt-6 rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
      {eyebrow}
      <h3 className="mt-2 text-xl font-black text-ink">
        {t("ui.companionInstall.notifyTitle", "Turn on trip alerts")}
      </h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        {t(
          "ui.companionInstall.notifyBody",
          "Roamly sends flight changes, check-in reminders, and what’s-up-next nudges to this device."
        )}
      </p>
      {requiresHomeScreen ? (
        <div className="mt-4 rounded-2xl bg-mist p-4">
          <p className="text-sm font-black leading-6 text-slate-600">
            {t(
              "ui.companionInstall.homeScreenFirst",
              "On iPhone, add Roamly to the Home Screen and open it from that icon before enabling reminders."
            )}
          </p>
          <button
            type="button"
            onClick={() => setPhase("install")}
            disabled={busy}
            className="mt-4 inline-flex min-h-11 items-center rounded-2xl bg-white px-4 text-sm font-black text-ink ring-1 ring-cloud disabled:opacity-60"
          >
            {t("ui.companionInstall.backToInstall", "Back to install")}
          </button>
        </div>
      ) : isDenied ? (
        <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {t(
            "ui.companionInstall.blockedNote",
            "Trip alerts are blocked in this browser. You can allow them in your browser settings, or rely on in-app notifications."
          )}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void enableAlerts()}
          disabled={busy}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-ocean px-4 py-3 text-sm font-black text-white disabled:opacity-60 sm:w-auto"
        >
          {busy
            ? t("ui.companionInstall.enabling", "Enabling…")
            : t("ui.companionInstall.turnOnAlerts", "Turn on trip alerts")}
        </button>
      )}
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
      {laterButton}
    </div>
  );
}
