/*
 * sessionActivity — the app-side inactivity expiry
 * (consolidation 2026-11-06, Block D).
 *
 * The audit's finding: sign-out existed, but there was NO
 * inactivity expiry anywhere — no app-set cookie maxAge, so the
 * Supabase library default applied and a phone session
 * effectively lasted ~400 days, silently refreshed by middleware.
 * On a lost or shared phone that is a real exposure.
 *
 * The Supabase dashboard's JWT/refresh settings cannot be
 * changed from this codebase (no dashboard access from the
 * build seat), so the expiry is enforced app-side, in two
 * agreeing halves:
 *
 *   - CLIENT (AppShellClient): while a traveller is signed in,
 *     real activity (page loads, taps, keys, returning to the
 *     tab) stamps the `roamly_last_activity` cookie. The stamp is
 *     an ordinary cookie — the server reads the same value the
 *     client wrote, so the two halves cannot disagree about when
 *     the traveller was last here.
 *   - SERVER (middleware): a request carrying an auth session
 *     whose activity stamp is older than the limit is treated as
 *     signed out — the auth cookies are cleared on the response
 *     and protected pages redirect to /login with a plain
 *     "session expired" reason. No stamp at all (first load after
 *     this ships, or cookies partially cleared) is NOT expiry:
 *     the client stamps on load and the session continues.
 *
 * SHIP-TIME FOLLOW-UP (named, not hidden): set the Supabase
 * dashboard's refresh-token lifetime / JWT expiry to match this
 * policy when dashboard access is next available, so the
 * provider-side lifetime stops being the 400-day default.
 */

export const ROAMLY_LAST_ACTIVITY_COOKIE = "roamly_last_activity";

/** 30 days without activity ends the session on next load. */
export const ROAMLY_INACTIVITY_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

export function parseActivityStamp(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function activityStampExpired(value: string | undefined | null, nowMs: number): boolean {
  const stamp = parseActivityStamp(value);
  if (stamp == null) return false;
  return nowMs - stamp > ROAMLY_INACTIVITY_LIMIT_MS;
}
