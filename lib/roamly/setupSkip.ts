/*
 * Setup-gate skip persistence (Roamly UX repair ROUND 2, builder C).
 *
 * Round-1 law, unchanged: the gate is never a wall — skip-for-now
 * reveals the itinerary with limited features, and skipping NEVER
 * completes a setup step (see lib/roamly/setupGate.ts). What round 1
 * got wrong was the memory: skip was per-visit only (?skipSetupGate=1
 * in the URL), so a traveler who skipped, left, and came back met the
 * gate again on every return.
 *
 * This module persists ONLY the skip choice, per trip, in a cookie:
 *   - name: roamly_setup_skipped_<tripId> (trip id validated, so a
 *     crafted id can never inject a header or collide with another
 *     trip's skip — a Toronto skip never reveals a Montreal gate);
 *   - value: "1", nothing else (no user id, no account data, no step
 *     state — the gate still reads setup completion from the server
 *     state in lib/roamly/setupState.ts, never from this cookie);
 *   - scope: Path=/ so both /trip/<id> and /trip/<id>/live read it;
 *     SameSite=Lax, 1-year Max-Age (a skipped trip stays skipped for
 *     its life; finishing setup removes the gate entirely anyway).
 *
 * Why a cookie and not the existing server-verifiable mechanism:
 * the only existing per-account persistence is the setup memory in
 * user_metadata (lib/roamly/setupState.ts), and writing there would
 * mean "skipped" reads as a completed step — exactly what the law
 * forbids. There is no skip column on roamly_trips, and adding a
 * migration is out of this lane's scope. A cookie is sent to the
 * server on every return, so the server gate (not just client JS)
 * honors it — a return visit reveals without re-skipping even before
 * any client code runs. Deleting cookies, or finishing setup, ends
 * the skip; neither breaks billing or entitlements.
 *
 * Pure module: no imports, so the round-2 check script can import it
 * directly under node --experimental-strip-types.
 */

export const SETUP_SKIP_COOKIE_PREFIX = "roamly_setup_skipped_";
export const SETUP_SKIP_COOKIE_MAX_AGE_SECONDS = 31536000; // 1 year

/** Trip ids in this app are UUIDs; accept only that safe alphabet. */
export function isSafeTripId(tripId: string | null | undefined): tripId is string {
  return typeof tripId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(tripId);
}

/** Cookie name for this trip's skip, or null when the id is unsafe. */
export function setupSkipCookieName(tripId: string | null | undefined): string | null {
  return isSafeTripId(tripId) ? `${SETUP_SKIP_COOKIE_PREFIX}${tripId}` : null;
}

/** True only for the exact stored value — anything else is "not skipped". */
export function isSetupSkipCookieValue(value: string | null | undefined): boolean {
  return value === "1";
}

/**
 * Parse a Cookie header (or a single cookie value) for this trip's
 * skip. Accepts either the full header string ("a=1; roamly_…=1") or
 * a bare value ("1"), so server code (cookie store value) and tests
 * share one reader.
 */
export function hasSetupSkip(
  cookieHeaderOrValue: string | null | undefined,
  tripId: string | null | undefined
): boolean {
  const name = setupSkipCookieName(tripId);
  if (!name || !cookieHeaderOrValue) return false;
  const trimmed = cookieHeaderOrValue.trim();
  if (trimmed === "1") {
    // A bare value can only come from a store already keyed by name;
    // the caller resolved the name, so "1" means skipped.
    return true;
  }
  for (const part of trimmed.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName.trim() === name && rest.join("=").trim() === "1") return true;
  }
  return false;
}

/** document.cookie assignment the gate screen writes on skip. */
export function setupSkipCookieAssignment(tripId: string | null | undefined): string | null {
  const name = setupSkipCookieName(tripId);
  if (!name) return null;
  return `${name}=1; Max-Age=${SETUP_SKIP_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
