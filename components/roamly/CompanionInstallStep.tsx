"use client";

import { useCallback, useEffect, useState } from "react";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard, BuiSkeleton } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
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
      <BuiCard className="mt-6 p-4">
        <BuiSkeleton className="h-4 w-32" />
        <BuiSkeleton className="mt-3 h-6 w-2/3" />
        <BuiSkeleton className="mt-3 h-10 w-48" />
      </BuiCard>
    );
  }

  if (phase === "dismissed" || phase === "unsupported" || !capability) return null;

  const eyebrow = (
    <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">
      {t("ui.companionInstall.stepLabel", "Live Companion")}
      {phase !== "done" ? (
        <span className="ml-2 text-cgray2">
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
      className="bui-press bui-touch mt-3 inline-flex min-h-11 items-center px-1 text-sm font-black text-cgray underline-offset-4 hover:underline disabled:opacity-60"
    >
      {t("ui.companionInstall.later", "Later")}
    </button>
  );

  if (phase === "done") {
    return (
      <BuiCard className="bui-enter mt-6 p-4">
        {eyebrow}
        <h3 className="mt-2 text-xl font-black text-chead">
          {t("ui.companionInstall.doneTitle", "You’re set for live trip alerts")}
        </h3>
        <p className="mt-2 text-sm font-bold leading-6 text-cink">
          {t(
            "ui.companionInstall.doneBody",
            "This device will get flight changes, check-in reminders, and what’s-up-next nudges while you travel."
          )}
        </p>
        <BuiButton type="button" variant="secondary" onClick={dismiss} className="mt-3">
          {t("ui.companionInstall.gotIt", "Got it")}
        </BuiButton>
      </BuiCard>
    );
  }

  if (phase === "install") {
    return (
      <BuiCard className="bui-enter mt-6 p-4">
        {eyebrow}
        <h3 className="mt-2 text-xl font-black text-chead">
          {t("ui.companionInstall.installTitle", "Add Roamly to your Home Screen")}
        </h3>
        <p className="mt-2 text-sm font-bold leading-6 text-cink">
          {t(
            "ui.companionInstall.installBody",
            "Get live flight changes, check-in nudges, and what’s-up-next alerts on your phone while you travel."
          )}
        </p>
        {deferredPrompt ? (
          <BuiButton
            type="button"
            onClick={() => void startAndroidInstall()}
            busy={busy}
            className="mt-4 w-full sm:w-auto"
          >
            {t("ui.companionInstall.addToHomeScreen", "Add Roamly to your Home Screen")}
          </BuiButton>
        ) : capability.isIOS ? (
          <div className="mt-4 rounded-bui-card border border-chair bg-cbg p-4">
            <ol className="grid gap-2 text-sm font-bold leading-6 text-cink">
              <li>
                <span className="mr-2 font-black text-cblue">1.</span>
                {t("ui.companionInstall.iosStep1", "Tap the Share button at the bottom of Safari.")}
              </li>
              <li>
                <span className="mr-2 font-black text-cblue">2.</span>
                {t("ui.companionInstall.iosStep2", "Scroll down and tap Add to Home Screen.")}
              </li>
              <li>
                <span className="mr-2 font-black text-cblue">3.</span>
                {t("ui.companionInstall.iosStep3", "Tap Add, then open Roamly from the new Home Screen icon.")}
              </li>
            </ol>
            <BuiButton
              type="button"
              onClick={() => void evaluate()}
              busy={busy}
              className="mt-4 w-full"
            >
              {t("ui.companionInstall.iveAddedIt", "I’ve added it — continue")}
            </BuiButton>
          </div>
        ) : (
          <div className="mt-4 rounded-bui-card border border-chair bg-cbg p-4">
            <p className="text-sm font-bold leading-6 text-cink">
              {t(
                "ui.companionInstall.genericInstallNote",
                "Use your browser’s menu (⋮ → “Add to Home screen” / “Install app”), then open Roamly from the new Home Screen icon."
              )}
            </p>
            <BuiButton
              type="button"
              onClick={() => void evaluate()}
              busy={busy}
              className="mt-4 w-full"
            >
              {t("ui.companionInstall.iveAddedIt", "I’ve added it — continue")}
            </BuiButton>
          </div>
        )}
        {laterButton}
      </BuiCard>
    );
  }

  // phase === "notify"
  const requiresHomeScreen = capability.requiresHomeScreenInstall;
  const isDenied = permissionState === "denied";

  return (
    <BuiCard className="bui-enter mt-6 p-4">
      {eyebrow}
      <h3 className="mt-2 text-xl font-black text-chead">
        {t("ui.companionInstall.notifyTitle", "Turn on trip alerts")}
      </h3>
      <p className="mt-2 text-sm font-bold leading-6 text-cink">
        {t(
          "ui.companionInstall.notifyBody",
          "Roamly sends flight changes, check-in reminders, and what’s-up-next nudges to this device."
        )}
      </p>
      {requiresHomeScreen ? (
        <div className="mt-4 rounded-bui-card border border-chair bg-cbg p-4">
          <p className="text-sm font-black leading-6 text-cink">
            {t(
              "ui.companionInstall.homeScreenFirst",
              "On iPhone, add Roamly to the Home Screen and open it from that icon before enabling reminders."
            )}
          </p>
          <BuiButton
            type="button"
            variant="secondary"
            onClick={() => setPhase("install")}
            busy={busy}
            className="mt-4"
          >
            {t("ui.companionInstall.backToInstall", "Back to install")}
          </BuiButton>
        </div>
      ) : isDenied ? (
        <BuiNotice
          tone="error"
          title={t(
            "ui.companionInstall.blockedNote",
            "Trip alerts are blocked in this browser. You can allow them in your browser settings, or rely on in-app notifications."
          )}
          className="mt-3"
        />
      ) : (
        <BuiButton
          type="button"
          onClick={() => void enableAlerts()}
          busy={busy}
          className="mt-4 w-full sm:w-auto"
        >
          {busy
            ? t("ui.companionInstall.enabling", "Enabling…")
            : t("ui.companionInstall.turnOnAlerts", "Turn on trip alerts")}
        </BuiButton>
      )}
      {error ? <BuiNotice tone="error" title={error} className="mt-3" /> : null}
      {laterButton}
    </BuiCard>
  );
}
