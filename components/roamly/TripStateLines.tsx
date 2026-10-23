"use client";

/*
 * TripStateLines — the trip page's only setup furniture (owner
 * design, 2026-10-23): two quiet text lines that keep each flagship
 * feature's state visible, never a silent absence.
 *
 *   Booking Recon: activated / not activated — connect Gmail
 *   Companion: live / ready / not live yet — <the missing step>
 *
 * A dead flagship is always named, with the way back pointing into
 * the Settings cascade. Location OFF with the grant intact is not a
 * gate and not an ask — it is this line plus a one-tap turn-on.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TripStateLines({
  gmailConnected,
  locationGranted,
  locationEnabled,
  companionUnlocked,
  tripActive
}: {
  gmailConnected: boolean;
  locationGranted: boolean;
  locationEnabled: boolean;
  companionUnlocked: boolean;
  tripActive: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(locationEnabled);
  const [grantRevoked, setGrantRevoked] = useState(false);
  const [busy, setBusy] = useState(false);

  // The server knows the last recorded grant; the browser knows if it
  // was revoked since. A revoked grant re-opens just that step's line.
  useEffect(() => {
    let cancelled = false;
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setGrantRevoked(status.state === "denied");
        status.onchange = () => setGrantRevoked(status.state === "denied");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const response = await fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationTrackingEnabled: true })
      }).catch(() => null);
      if (response?.ok) {
        setEnabled(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const linkClass = "font-bold text-ocean underline underline-offset-2";
  const grantMissing = !locationGranted || grantRevoked;

  return (
    <div className="mt-4 space-y-1 px-1 text-sm font-semibold leading-6 text-slate-500">
      <p>
        Booking Recon:{" "}
        {gmailConnected ? (
          "activated"
        ) : (
          <>
            not activated —{" "}
            <a className={linkClass} href="/account#setup-step-1">
              connect Gmail
            </a>
          </>
        )}
      </p>
      {companionUnlocked ? (
        <p>
          Companion:{" "}
          {grantMissing ? (
            <>
              not live yet —{" "}
              <a className={linkClass} href="/account#setup-step-3">
                turn on location
              </a>
            </>
          ) : !enabled ? (
            <>
              not live yet — location is off{" "}
              <button
                type="button"
                onClick={() => void turnOn()}
                disabled={busy}
                className="ml-1 inline-flex min-h-8 items-center rounded-full bg-ink px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Turning on…" : "Turn on"}
              </button>
            </>
          ) : tripActive ? (
            "live"
          ) : (
            "ready"
          )}
        </p>
      ) : null}
    </div>
  );
}
