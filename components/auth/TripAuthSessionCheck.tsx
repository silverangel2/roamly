"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    let cancelled = false;
    const attemptKey = `roamly.trip.session-check.${tripId}`;

    async function checkSession() {
      const attempts = readAttemptCount(attemptKey);

      if (attempts >= 2) {
        clearAttemptCount(attemptKey);
        window.location.replace(`/login?next=${encodeURIComponent(targetPath)}`);
        return;
      }

      const first = await syncSupabaseServerSession({ refresh: attempts > 0 });
      if (cancelled) return;

      if (first.ok) {
        writeAttemptCount(attemptKey, attempts + 1);
        window.location.replace(targetPath);
        return;
      }

      if (attempts === 0) {
        const retry = await syncSupabaseServerSession({ refresh: true });
        if (cancelled) return;

        if (retry.ok) {
          writeAttemptCount(attemptKey, 1);
          window.location.replace(targetPath);
          return;
        }
      }

      clearAttemptCount(attemptKey);
      window.location.replace(`/login?next=${encodeURIComponent(targetPath)}`);
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [targetPath, tripId]);

  return (
    <main className="safe-bottom grid min-h-[calc(100dvh-7rem)] place-items-center px-4 py-10">
      <div role="status" aria-live="polite" className="rounded-2xl border border-cloud bg-white px-5 py-4 shadow-soft">
        <p className="text-sm font-black text-ink">Checking your session…</p>
      </div>
    </main>
  );
}
