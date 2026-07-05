"use client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function getNotificationPermissionState() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

export async function subscribeToPushNotifications() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "Push notifications are not supported in this browser." };
  }
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  if (!vapidPublicKey) {
    return { ok: false, error: "VAPID public key is not configured." };
  }
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was not granted." };

  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
  });

  const response = await fetch("/api/roamly/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON())
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push subscription failed." };
  return { ok: true };
}

export async function unsubscribeFromPushNotifications() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { ok: true };
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  const response = await fetch("/api/roamly/push/unsubscribe", { method: "POST" });
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: data?.error || "Push unsubscribe failed." };
  return { ok: true };
}
