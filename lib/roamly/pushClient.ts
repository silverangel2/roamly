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

export function isSupportedMobileEnvironment() {
  if (typeof window === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || touchMac;
}

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

export async function hasPushSubscription(qaTripId?: string) {
  const capability = getPushCapabilityState();
  if (!capability.serviceWorkerSupported || !capability.pushManagerSupported) return false;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription().catch(() => null);
  if (!subscription) return false;
  const tripQuery = qaTripId ? `&tripId=${encodeURIComponent(qaTripId)}` : "";
  const response = await fetchWithSupabaseAuth(`/api/roamly/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}${tripQuery}`, { method: "GET" }).catch(() => null);
  if (!response?.ok) return false;
  const data = await response.json().catch(() => null);
  return data?.deviceRegistered === true;
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
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const permission = existing ? Notification.permission : await requestNotificationPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was not granted." };
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
  });

  const payload = subscription.toJSON();

  const response = await fetchWithSupabaseAuth(
    "/api/roamly/push/subscribe",
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
  if (data?.deviceRegistered !== true || !data?.subscriptionId) return { ok: false, error: "Push subscription was not persisted." };
  return { ok: true, deviceRegistered: true, subscriptionId: data.subscriptionId };
}

export async function ensurePushSubscription(qaTripId?: string) {
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
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const permission = existing ? Notification.permission : await requestNotificationPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was not granted." };
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    }));

  const response = await fetchWithSupabaseAuth(
    "/api/roamly/push/subscribe",
    {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(qaTripId ? { tripId: qaTripId, ...subscription.toJSON() } : subscription.toJSON())
    }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push subscription failed." };
  if (data?.deviceRegistered !== true || !data?.subscriptionId) return { ok: false, error: "Push subscription was not persisted." };
  return { ok: true, deviceRegistered: true, subscriptionId: data.subscriptionId };
}

export async function unsubscribeFromPushNotifications(qaTripId?: string) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { ok: true };
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint || null;
  await subscription?.unsubscribe();
  const response = await fetchWithSupabaseAuth("/api/roamly/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(qaTripId ? { tripId: qaTripId, endpoint } : { endpoint })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push unsubscribe failed." };
  return { ok: true };
}
