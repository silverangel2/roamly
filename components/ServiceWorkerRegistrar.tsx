"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

async function postToServiceWorker(message: Record<string, unknown>) {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const target = registration.active || navigator.serviceWorker.controller;
    target?.postMessage(message);
  } catch {
    // Offline-first is best-effort: never let worker messaging break the page.
  }
}

/**
 * Registers /sw.js on every page load, independent of push opt-in, so
 * offline caching and the activity-write outbox work for every user.
 * Push subscription flows in lib/roamly/pushClient.ts keep working: they
 * re-register the same script and get back the existing registration.
 *
 * Also tells the worker the current Supabase user id so trip documents are
 * cached in per-user namespaces, purges those caches on sign-out, and asks
 * the worker to flush its offline outbox when the browser comes back online.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch {
        return;
      }
      if (cancelled) return;
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        void postToServiceWorker({ type: "roamly_set_user", userId: data?.user?.id ?? null });
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_OUT") {
            void postToServiceWorker({ type: "roamly_logout" });
          } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
            void postToServiceWorker({ type: "roamly_set_user", userId: session?.user?.id ?? null });
          }
        });
      } catch {
        // Auth lookup is best-effort; the worker still caches static assets.
      }
    })();

    const handleOnline = () => {
      void postToServiceWorker({ type: "roamly_flush_outbox" });
    };
    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return null;
}
