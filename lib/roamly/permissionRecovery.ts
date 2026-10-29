/*
 * Location-permission recovery guidance (Roamly UX repair ROUND 2,
 * builder C).
 *
 * Failure: the live view's "Turn on in Settings" was a bare link to
 * the account page with no recovery path — a traveler whose browser
 * had blocked location had no idea which settings screen to open,
 * and no retry control.
 *
 * Rules enforced here (pure, no imports):
 *   - Platform is DETECTED from the runtime (user agent + standalone
 *     signals), never guessed from a default: an iPhone Safari
 *     traveler gets Safari-Websites steps, an installed PWA gets
 *     app-permission steps, Android Chrome gets site-settings steps.
 *     Unknown runtimes get honest generic steps, labeled as such.
 *   - Browsers do NOT re-prompt after a denial, so a denied state
 *     gets NO "allow" retry button — only the settings steps plus a
 *     "check again" re-query (Permissions API, which never prompts).
 *     A prompt state (not yet decided) DOES get a real retry, because
 *     firing the prompt is still possible there.
 *   - Denial and unsupported states stay graceful: no bypass of
 *     browser security is attempted anywhere; schedule-only mode
 *     remains available (the live view's existing fallback).
 */

export type PermissionPlatform =
  | "ios-safari"
  | "ios-pwa"
  | "android-chrome"
  | "android-pwa"
  | "desktop"
  | "unknown";

export type PermissionRecoveryState = "prompt" | "denied" | "unavailable" | "granted";

/**
 * Detect the runtime platform. `standalone` is true for an installed
 * PWA (navigator.standalone on iOS, or display-mode: standalone
 * elsewhere). Detection is best-effort and honest: anything it cannot
 * recognize returns "unknown", which gets generic steps.
 */
export function detectPermissionPlatform(input: {
  userAgent?: string | null;
  standalone?: boolean;
}): PermissionPlatform {
  const ua = String(input.userAgent || "");
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  if (isIOS) return input.standalone ? "ios-pwa" : "ios-safari";
  if (isAndroid) return input.standalone ? "android-pwa" : "android-chrome";
  if (ua) return "desktop";
  return "unknown";
}

/** True only when firing the browser prompt is still possible. */
export function canReprompt(state: PermissionRecoveryState): boolean {
  return state === "prompt";
}

/**
 * Platform-specific recovery steps for a blocked location permission.
 * Every denied-state list ends with the "check again" step, never with
 * a claim that Roamly can re-ask on its own.
 */
export function recoverySteps(platform: PermissionPlatform): string[] {
  switch (platform) {
    case "ios-safari":
      return [
        "Open Settings → Privacy & Security → Location Services, and make sure Location Services is on.",
        "In the same list, tap Safari Websites and choose “While Using the App”.",
        "Return to Roamly and tap “I’ve allowed it — check again”. Safari will not ask again on its own while it is blocked, so the setting change has to come first."
      ];
    case "ios-pwa":
      return [
        "Open Settings → Privacy & Security → Location Services.",
        "Find Roamly in the list and set it to “While Using the App”.",
        "Return to Roamly and tap “I’ve allowed it — check again”."
      ];
    case "android-chrome":
      return [
        "In Chrome, tap ⋮ → Settings → Site settings → Location, find Roamly, and set it to Allow.",
        "If Roamly is not listed there, open Android Settings → Apps → Chrome → Permissions → Location and set it to “Allow only while using the app”.",
        "Return to Roamly and tap “I’ve allowed it — check again”."
      ];
    case "android-pwa":
      return [
        "Open Android Settings → Apps → Roamly → Permissions → Location.",
        "Set it to “Allow only while using the app”.",
        "Return to Roamly and tap “I’ve allowed it — check again”."
      ];
    case "desktop":
      return [
        "Tap the lock (or tune) icon in the address bar → Site settings → Location, and set Roamly to Allow.",
        "Reload the page, then tap “I’ve allowed it — check again”."
      ];
    case "unknown":
    default:
      return [
        "Open your browser’s site settings for Roamly and set Location to Allow — or, on a phone, open your device Settings → Apps (or Privacy → Location Services) and allow location for Roamly.",
        "Return to Roamly and tap “I’ve allowed it — check again”."
      ];
  }
}

/** Heading for the recovery block, by state. */
export function recoveryHeading(state: PermissionRecoveryState): string {
  if (state === "denied") return "Location is blocked for Roamly";
  if (state === "prompt") return "Location still needs your permission";
  return "Location is not available here";
}
