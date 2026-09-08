"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";
import {
  getPushCapabilityState,
  getNotificationPermissionState,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications
} from "@/lib/roamly/pushClient";

export function NotificationPermissionCard({
  qaTripId
}: {
  qaTripId?: string;
} = {}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [permission, setPermission] = useState("unknown");
  const [requiresHomeScreen, setRequiresHomeScreen] = useState(false);

  useEffect(() => {
    const capability = getPushCapabilityState();
    setRequiresHomeScreen(capability.requiresHomeScreenInstall);
    let alive = true;
    void getNotificationPermissionState().then((state) => {
      if (alive) setPermission(state);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await subscribeToPushNotifications(qaTripId);
    setBusy(false);
    if (result.ok) {
      setPermission("granted");
      setNotice(result.deviceRegistered ? t("ui.status.phoneRemindersRegistered", "Phone reminders are enabled and this device is registered with Roamly.") : t("ui.status.phoneRemindersEnabled", "Phone/browser reminders are enabled."));
    } else {
      const state = await getNotificationPermissionState();
      setPermission(state);
      setError(result.error ? localizeCustomerError(locale, result.error) : t("ui.status.pushEnableFailed", "Push notifications could not be enabled."));
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await unsubscribeFromPushNotifications(qaTripId);
    setBusy(false);
    if (result.ok) {
      const state = await getNotificationPermissionState();
      setPermission(state);
      setNotice(t("ui.status.phoneRemindersOff", "Phone/browser reminders are off. In-app notifications still work."));
    } else {
      setError(result.error ? localizeCustomerError(locale, result.error) : t("ui.status.pushDisableFailed", "Could not disable push notifications."));
    }
  }

  async function check() {
    const state = await getNotificationPermissionState();
    setPermission(state);
    setNotice(requiresHomeScreen ? t("ui.status.addToHomeScreenFirst", "On iPhone, add Roamly to the Home Screen and open it from that icon before enabling reminders.") : `${t("ui.status.browserPermission", "Current browser permission")}: ${state}`);
  }

  const isDenied = permission === "denied";
  const isGranted = permission === "granted";
  const isUnsupported = permission === "unsupported";

  return (
    <div className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{t("ui.status.phoneReminders", "Phone reminders")}</p>
      <h3 className="mt-2 text-xl font-black text-ink">{t("ui.status.enablePhoneReminders", "Enable phone reminders")}</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        {t("ui.status.phoneRemindersDescription", "Roamly can remind you about packing, documents, check-in times, and what&apos;s up next during your trip.")}
      </p>
      {isDenied ? (
        <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {t("ui.status.phoneRemindersBlocked", "Phone reminders are blocked. You can still use in-app notifications in Roamly.")}
        </p>
      ) : isUnsupported ? (
        <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {t("ui.status.notificationsUnavailable", "OS notifications are unavailable in this browser or on this device. Use a supported browser, or install Roamly on your iPhone Home Screen.")}
        </p>
      ) : requiresHomeScreen ? (
        <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
          {t("ui.status.homeScreenReminder", "On iPhone, tap Share, Add to Home Screen, then open Roamly from the new icon to enable phone reminders.")}
        </p>
      ) : isGranted ? (
        <p className="mt-3 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          {t("ui.status.phoneRemindersEnabledShort", "Phone reminders are enabled.")}
        </p>
      ) : (
        <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
          {t("ui.status.phoneRemindersPermission", "In-app notifications work automatically. Phone reminders need browser permission on this device.")}
        </p>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={enable}
          disabled={busy || (isGranted && !qaTripId)}
          className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 disabled:opacity-60"
        >
          {qaTripId && isGranted ? t("ui.status.registerQaPush", "Register QA push") : t("ui.actions.enableReminders")}
        </button>
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-ink ring-1 ring-cloud disabled:opacity-60"
        >
          {t("ui.status.turnOff", "Turn off")}
        </button>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-ink disabled:opacity-60"
        >
          {t("ui.status.checkState", "Check state")}
        </button>
      </div>
      {notice ? <p className="mt-3 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
