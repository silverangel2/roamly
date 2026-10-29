"use client";

/*
 * LocationPermissionRecovery — platform-specific recovery for a
 * blocked or undecided location permission (Roamly UX repair ROUND 2,
 * builder C). Replaces the bare "Turn on in Settings" link, which
 * named no settings screen and offered no retry.
 *
 * Platform is detected on the device (user agent + standalone
 * signals via lib/roamly/permissionRecovery.ts), never guessed:
 * iOS Safari gets Safari-Websites steps, an installed PWA gets
 * app-permission steps, Android Chrome gets site-settings steps.
 *
 * Retry discipline (browser security is never bypassed):
 *   - prompt (not yet decided): a real "Allow location" button that
 *     fires the browser prompt through onRetry.
 *   - denied: NO re-prompt button — browsers will not re-ask after a
 *     denial. Only the settings steps plus "I've allowed it — check
 *     again", which re-queries the Permissions API (never prompts)
 *     and, once granted, hands off to onRetry.
 *   - unavailable: a graceful note, no retry (nothing to re-ask).
 */

import { useEffect, useState } from "react";
import {
  detectPermissionPlatform,
  recoveryHeading,
  recoverySteps,
  type PermissionPlatform,
  type PermissionRecoveryState
} from "@/lib/roamly/permissionRecovery";

export function LocationPermissionRecovery({
  permission,
  onRetry,
  onRecheck
}: {
  permission: PermissionRecoveryState;
  /** Fires the real browser prompt (prompt state) or starts sensing (after a granted recheck). */
  onRetry: () => void;
  /** Re-queries the permission state without prompting (denied state). */
  onRecheck?: () => void;
}) {
  const [platform, setPlatform] = useState<PermissionPlatform>("unknown");

  useEffect(() => {
    const standalone =
      (typeof navigator !== "undefined" && (navigator as { standalone?: boolean }).standalone === true) ||
      (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches);
    setPlatform(
      detectPermissionPlatform({
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        standalone
      })
    );
  }, []);

  if (permission === "granted") return null;
  const steps = permission === "unavailable" ? [] : recoverySteps(platform);

  return (
    <div className="mt-3 rounded-[14px] bg-white px-4 py-3 shadow-calm">
      <p className="text-sm font-semibold leading-6 text-chead">{recoveryHeading(permission)}</p>
      {permission === "unavailable" ? (
        <p className="mt-1 text-sm font-normal leading-6 text-cink">
          This browser or device cannot share location. Your schedule and saved itinerary still work
          without it.
        </p>
      ) : (
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm font-normal leading-6 text-cink">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {permission === "prompt" ? (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 shrink-0 px-1 text-[15px] font-semibold text-cblue"
          >
            Allow location
          </button>
        ) : null}
        {permission === "denied" && onRecheck ? (
          <button
            type="button"
            onClick={onRecheck}
            className="min-h-11 shrink-0 px-1 text-[15px] font-semibold text-cblue"
          >
            I’ve allowed it — check again
          </button>
        ) : null}
        <a
          href="/account#setup-step-3"
          className="inline-flex min-h-11 shrink-0 items-center px-1 text-[15px] font-semibold text-cblue"
        >
          Open setup steps
        </a>
      </div>
    </div>
  );
}
