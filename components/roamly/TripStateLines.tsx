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
  gmailLastSyncedAt,
  locationGranted,
  locationEnabled,
  companionUnlocked,
  tripActive,
  tripId,
  pendingImportCount
}: {
  gmailConnected: boolean;
  /** Last successful Gmail sync, when connected. A stale date replaces
      the plain "activated" line — it never flips the connected state. */
  gmailLastSyncedAt?: string | null;
  locationGranted: boolean;
  locationEnabled: boolean;
  companionUnlocked: boolean;
  tripActive: boolean;
  /** When set, a pending-review count renders as a quiet third line.
      Near-misses already live on the Bookings page; the trip page only
      points at them, and only when at least one is actually waiting. */
  tripId?: string;
  pendingImportCount?: number;
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

  const linkClass = "font-semibold text-cblue";
  const grantMissing = !locationGranted || grantRevoked;
  // Same 45-minute honesty window the Gmail imports panel already uses:
  // a connected inbox whose last successful sync is older than that is
  // stale, and the trip line must say so instead of plain "activated".
  // A missing date means no successful sync yet — that stays "activated"
  // here, because a first sync may still be running.
  const lastSyncMs = gmailLastSyncedAt ? Date.parse(gmailLastSyncedAt) : Number.NaN;
  const gmailStale =
    gmailConnected && Number.isFinite(lastSyncMs) && Date.now() - lastSyncMs > 45 * 60 * 1000;
  const lastSyncLabel = Number.isFinite(lastSyncMs)
    ? new Date(lastSyncMs).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : null;

  return (
    <div className="mt-3 space-y-1.5 text-[13.5px] font-normal leading-6 text-cgray">
      <p className="flex items-start gap-1.5">
        <span
          aria-hidden
          className={`calm-dot mt-[7px] h-2 w-2 shrink-0 rounded-full ${gmailConnected ? "bg-cgreen" : "bg-cgray2"}`}
        />
        <span>
          Booking Recon:{" "}
          {gmailStale ? (
            <>connected, but inbox not checked since {lastSyncLabel}</>
          ) : gmailConnected ? (
            "activated"
          ) : (
            <>
              not activated —{" "}
              <a className={linkClass} href="/account#setup-step-1">
                connect Gmail
              </a>
            </>
          )}
        </span>
      </p>
      {tripId && pendingImportCount != null && pendingImportCount > 0 ? (
        <p className="flex items-start gap-1.5">
          <span aria-hidden className="calm-dot mt-[7px] h-2 w-2 shrink-0 rounded-full bg-cgray2" />
          <span>
            {pendingImportCount} booking{pendingImportCount === 1 ? "" : "s"} from your inbox need your review —{" "}
            <a className={linkClass} href={`/trip/${tripId}/bookings`}>
              Review on the Bookings page
            </a>
          </span>
        </p>
      ) : null}
      {companionUnlocked ? (
        <p className="flex items-start gap-1.5">
          <span
            aria-hidden
            className={`calm-dot mt-[7px] h-2 w-2 shrink-0 rounded-full ${
              !grantMissing && enabled && tripActive ? "bg-cgreen" : "bg-cgray2"
            }`}
          />
          <span>
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
                  className="ml-1 inline-flex min-h-8 items-center font-semibold text-cblue disabled:opacity-50"
                >
                  {busy ? "Turning on…" : "Turn on"}
                </button>
              </>
            ) : tripActive ? (
              "live"
            ) : (
              "ready"
            )}
          </span>
        </p>
      ) : null}
    </div>
  );
}
