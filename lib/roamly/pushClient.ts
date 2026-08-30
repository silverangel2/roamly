"use client";

import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export type PushPermissionState = NotificationPermission | "unsupported" | "requires_home_screen";

export type PushCapabilityState = {
  notificationSupported: boolean;
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  requiresHomeScreenInstall: boolean;
  canSubscribe: boolean;
};

function isIOSDevice() {
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneWebApp() {
  return window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function getPushCapabilityState(): PushCapabilityState {
  if (typeof window === "undefined") {
    return {
      notificationSupported: false,
      serviceWorkerSupported: false,
      pushManagerSupported: false,
      isIOS: false,
      isStandalone: false,
      requiresHomeScreenInstall: false,
      canSubscribe: false
    };
  }
  const isIOS = isIOSDevice();
  const isStandalone = isStandaloneWebApp();
  const notificationSupported = "Notification" in window;
  const serviceWorkerSupported = "serviceWorker" in navigator;
  const pushManagerSupported = "PushManager" in window;
  const requiresHomeScreenInstall = isIOS && !isStandalone;
  return {
    notificationSupported,
    serviceWorkerSupported,
    pushManagerSupported,
    isIOS,
    isStandalone,
    requiresHomeScreenInstall,
    canSubscribe: notificationSupported && serviceWorkerSupported && pushManagerSupported && !requiresHomeScreenInstall
  };
}

export async function getNotificationPermissionState() {
  const capability = getPushCapabilityState();
  if (capability.requiresHomeScreenInstall) return "requires_home_screen" as const;
  if (!capability.notificationSupported) return "unsupported" as const;
  return Notification.permission;
}

export async function requestNotificationPermission() {
  const capability = getPushCapabilityState();
  if (capability.requiresHomeScreenInstall) return "requires_home_screen" as const;
  if (!capability.notificationSupported) return "unsupported" as const;
  return Notification.requestPermission();
}

export async function subscribeToPushNotifications(qaTripId?: string) {
  const capability = getPushCapabilityState();
  if (!capability.canSubscribe) {
    return {
      ok: false,
      error: capability.requiresHomeScreenInstall
        ? "On iPhone, add Roamly to your Home Screen and open it from that icon to enable phone reminders."
        : "Push notifications are not supported in this browser."
    };
  }
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  if (!vapidPublicKey) {
    return { ok: false, error: "VAPID public key is not configured." };
  }
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was not granted." };

  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });

  const payload = subscription.toJSON();

  const response = await fetchWithSupabaseAuth(
    qaTripId
      ? "/api/admin/roamly/push/subscribe"
      : "/api/roamly/push/subscribe",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        qaTripId
          ? { tripId: qaTripId, ...payload }
          : payload
      )
    }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push subscription failed." };
  return { ok: true, deviceRegistered: data?.deviceRegistered === true, subscriptionId: data?.subscriptionId || null };
}

export async function ensurePushSubscription() {
  const capability = getPushCapabilityState();
  if (!capability.canSubscribe) {
    return {
      ok: false,
      error: capability.requiresHomeScreenInstall
        ? "On iPhone, add Roamly to your Home Screen and open it from that icon to enable phone reminders."
        : "Push notifications are not supported in this browser."
    };
  }
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  if (!vapidPublicKey) {
    return { ok: false, error: "VAPID public key is not configured." };
  }
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was not granted." };

  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    }));

  const response = await fetchWithSupabaseAuth("/api/roamly/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON())
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push subscription failed." };
  return { ok: true, deviceRegistered: data?.deviceRegistered === true, subscriptionId: data?.subscriptionId || null };
}

export async function unsubscribeFromPushNotifications() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { ok: true };
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  const response = await fetchWithSupabaseAuth("/api/roamly/push/unsubscribe", { method: "POST" });
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push unsubscribe failed." };
  return { ok: true };
}
