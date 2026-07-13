"use client";

import { useEffect, useState } from "react";
import { syncSupabaseServerSession } from "@/lib/roamly/authenticatedFetch";
import { safeAuthNextPath } from "@/lib/navigation";

type TripAuthSessionCheckProps = {
  tripId: string;
  nextPath?: string;
};

function readAttemptCount(key: string) {
  try {
    return Number(window.sessionStorage.getItem(key) || "0") || 0;
  } catch {
    return 0;
  }
}

function writeAttemptCount(key: string, value: number) {
  try {
    window.sessionStorage.setItem(key, String(value));
  } catch {
    // Session storage is best-effort loop protection.
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
  const [message, setMessage] = useState("Checking your session...");

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const attemptKey = `roamly.trip.session-check.${tripId}`;

    async function checkSession() {
      const attempts = readAttemptCount(attemptKey);
      setMessage(attempts > 0 ? "Restoring your session..." : "Checking your session...");

      const first = await syncSupabaseServerSession({ refresh: attempts > 0 });
      if (cancelled) return;

      if (first.ok) {
        clearAttemptCount(attemptKey);
        window.location.replace(targetPath);
        return;
      }

      if (first.user) {
        writeAttemptCount(attemptKey, Math.min(attempts + 1, 8));
        setMessage(attempts >= 4 ? "Still restoring your session..." : "Restoring your session...");
        retryTimer = window.setTimeout(checkSession, attempts >= 4 ? 1500 : 700);
        return;
      }

      if (attempts === 0) {
        const retry = await syncSupabaseServerSession({ refresh: true });
        if (cancelled) return;

        if (retry.ok) {
          clearAttemptCount(attemptKey);
          window.location.replace(targetPath);
          return;
        }

        if (retry.user) {
          writeAttemptCount(attemptKey, 1);
          setMessage("Restoring your session...");
          retryTimer = window.setTimeout(checkSession, 700);
          return;
        }
      }

      if (attempts >= 2) {
        clearAttemptCount(attemptKey);
        window.location.replace(`/login?next=${encodeURIComponent(targetPath)}`);
        return;
      }

      writeAttemptCount(attemptKey, attempts + 1);
      retryTimer = window.setTimeout(checkSession, 700);
    }

    void checkSession();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [targetPath, tripId]);

  return (
    <main className="safe-bottom grid min-h-[calc(100dvh-7rem)] place-items-center px-4 py-10">
      <div role="status" aria-live="polite" className="rounded-2xl border border-cloud bg-white px-5 py-4 shadow-soft">
        <p className="text-sm font-black text-ink">{message}</p>
      </div>
    </main>
  );
}
