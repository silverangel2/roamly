"use client";

import { useEffect, useRef, useState } from "react";
import {
  cancelPendingLoginRedirects,
  resolveBrowserAuthState,
  syncSupabaseServerSession,
  type BrowserAuthStatus
} from "@/lib/roamly/authenticatedFetch";
import { safeAuthNextPath } from "@/lib/navigation";

type TripAuthSessionCheckProps = {
  tripId: string;
  nextPath?: string;
};

function readRedirectCount(key: string) {
  try {
    return Number(window.sessionStorage.getItem(key) || "0") || 0;
  } catch {
    return 0;
  }
}

function writeRedirectCount(key: string, value: number) {
  try {
    window.sessionStorage.setItem(key, String(value));
  } catch {
    // Session storage is best-effort login-loop protection.
  }
}

function clearAttemptCount(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage is best-effort loop protection.
  }
}

export function TripAuthSessionCheck({ tripId, nextPath }: TripAuthSessionCheckProps) {
  const fallbackPath = `/trip/${tripId}`;
  const targetPath = safeAuthNextPath(nextPath, fallbackPath);
  const [authState, setAuthState] = useState<BrowserAuthStatus>("loading");
  const [message, setMessage] = useState("Checking your session...");
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const redirectKey = `roamly.login.redirected.${targetPath}`;
    const attemptKey = `roamly.trip.session-check.${tripId}`;

    function redirectToLoginOnce() {
      const attempts = readRedirectCount(redirectKey);
      if (attempts > 0) {
        setMessage("Please log in to continue.");
        return;
      }

      writeRedirectCount(redirectKey, attempts + 1);
      window.location.replace(`/login?next=${encodeURIComponent(targetPath)}`);
    }

    async function checkSessionOnce() {
      setAuthState("loading");
      setMessage("Checking your session...");

      const current = await resolveBrowserAuthState();
      if (cancelled) return;

      if (current.status === "authenticated") {
        cancelPendingLoginRedirects();
        setAuthState("authenticated");
        setMessage("Opening your trip...");
        const first = await syncSupabaseServerSession();
        if (cancelled) return;
        if (first.ok) {
          clearAttemptCount(attemptKey);
          window.location.replace(targetPath);
          return;
        }
        if (first.user) {
          setMessage("Your session is active. Restoring trip access...");
        }

        const retry = await syncSupabaseServerSession({ refresh: true });
        if (cancelled) return;
        if (retry.ok) {
          clearAttemptCount(attemptKey);
          window.location.replace(targetPath);
          return;
        }
        if (retry.user) {
          clearAttemptCount(attemptKey);
        }

        setMessage("Your session is active. Refresh this page once if the trip does not open.");
        return;
      }

      const refreshed = await resolveBrowserAuthState({ refresh: true });
      if (cancelled) return;
      if (refreshed.status === "authenticated") {
        cancelPendingLoginRedirects();
        setAuthState("authenticated");
        setMessage("Opening your trip...");
        const synced = await syncSupabaseServerSession();
        if (!cancelled && synced.ok) {
          clearAttemptCount(attemptKey);
          window.location.replace(targetPath);
        }
        return;
      }

      setAuthState("unauthenticated");
      redirectToLoginOnce();
    }

    if (!started.current) {
      started.current = true;
      void checkSessionOnce();
    }

    return () => {
      cancelled = true;
    };
  }, [targetPath, tripId]);

  return (
    <main className="safe-bottom grid min-h-[calc(100dvh-7rem)] place-items-center px-4 py-10">
      <div role="status" aria-live="polite" className="rounded-2xl border border-cloud bg-white px-5 py-4 shadow-soft">
        <p className="text-sm font-black text-ink">{message}</p>
        {authState === "unauthenticated" ? (
          <a
            href={`/login?next=${encodeURIComponent(targetPath)}`}
            className="mt-3 inline-flex rounded-full bg-ink px-4 py-2 text-xs font-black text-white"
          >
            Log in
          </a>
        ) : null}
      </div>
    </main>
  );
}
