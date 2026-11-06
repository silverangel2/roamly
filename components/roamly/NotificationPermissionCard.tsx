"use client";

import { useEffect, useState } from "react";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
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
    <BuiCard className="bui-enter p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{t("ui.status.phoneReminders", "Phone reminders")}</p>
      <h3 className="mt-2 text-xl font-black text-chead">{t("ui.status.enablePhoneReminders", "Enable phone reminders")}</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-cink">
        {t("ui.status.phoneRemindersDescription", "Roamly can remind you about packing, documents, check-in times, and what&apos;s up next during your trip.")}
      </p>
      {isDenied ? (
        <BuiNotice tone="error" title={t("ui.status.phoneRemindersBlocked", "Phone reminders are blocked. You can still use in-app notifications in Roamly.")} className="mt-3" />
      ) : isUnsupported ? (
        <BuiNotice tone="error" title={t("ui.status.notificationsUnavailable", "OS notifications are unavailable in this browser or on this device. Use a supported browser, or install Roamly on your iPhone Home Screen.")} className="mt-3" />
      ) : requiresHomeScreen ? (
        <BuiNotice tone="info" title={t("ui.status.homeScreenReminder", "On iPhone, tap Share, Add to Home Screen, then open Roamly from the new icon to enable phone reminders.")} className="mt-3" />
      ) : isGranted ? (
        <BuiNotice tone="success" title={t("ui.status.phoneRemindersEnabledShort", "Phone reminders are enabled.")} className="mt-3" />
      ) : (
        <BuiNotice tone="info" title={t("ui.status.phoneRemindersPermission", "In-app notifications work automatically. Phone reminders need browser permission on this device.")} className="mt-3" />
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <BuiButton type="button" onClick={enable} busy={busy} disabled={isGranted && !qaTripId}>
          {qaTripId && isGranted ? t("ui.status.registerQaPush", "Register QA push") : t("ui.actions.enableReminders")}
        </BuiButton>
        <BuiButton type="button" variant="secondary" onClick={disable} busy={busy}>
          {t("ui.status.turnOff", "Turn off")}
        </BuiButton>
        <BuiButton type="button" variant="ghost" onClick={check} busy={busy}>
          {t("ui.status.checkState", "Check state")}
        </BuiButton>
      </div>
      {notice ? <BuiNotice tone="success" title={notice} className="mt-3" /> : null}
      {error ? <BuiNotice tone="error" title={error} className="mt-3" /> : null}
    </BuiCard>
  );
}
