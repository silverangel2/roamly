"use client";

import { useEffect, useState } from "react";
import {
  getNotificationPermissionState,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications
} from "@/lib/roamly/pushClient";

export function NotificationPermissionCard() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [permission, setPermission] = useState("unknown");

  useEffect(() => {
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
    const result = await subscribeToPushNotifications();
    setBusy(false);
    if (result.ok) {
      setPermission("granted");
      setNotice("Phone/browser reminders are enabled. In-app notifications always stay available.");
    } else {
      const state = await getNotificationPermissionState();
      setPermission(state);
      setError(result.error || "Push notifications could not be enabled.");
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await unsubscribeFromPushNotifications();
    setBusy(false);
    if (result.ok) {
      const state = await getNotificationPermissionState();
      setPermission(state);
      setNotice("Phone/browser reminders are off. In-app notifications still work.");
    } else {
      setError(result.error || "Could not disable push notifications.");
    }
  }

  async function check() {
    const state = await getNotificationPermissionState();
    setPermission(state);
    setNotice(`Current browser permission: ${state}`);
  }

  const isDenied = permission === "denied";
  const isGranted = permission === "granted";

  return (
    <div className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Phone reminders</p>
      <h3 className="mt-2 text-xl font-black text-ink">Enable phone reminders</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        Roamly can remind you about packing, documents, check-in times, and what&apos;s up next during your trip.
      </p>
      {isDenied ? (
        <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          Phone reminders are blocked. You can still use in-app notifications in Roamly.
        </p>
      ) : isGranted ? (
        <p className="mt-3 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          Phone reminders are enabled.
        </p>
      ) : (
        <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
          In-app notifications work automatically. Phone reminders need browser permission on this device.
        </p>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={enable}
          disabled={busy || isGranted}
          className="rounded-2xl bg-ink px-4 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          Enable reminders
        </button>
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-ink ring-1 ring-cloud disabled:opacity-60"
        >
          Turn off
        </button>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-ink disabled:opacity-60"
        >
          Check state
        </button>
      </div>
      {notice ? <p className="mt-3 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
