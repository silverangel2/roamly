import type { SupabaseClient, User } from "@supabase/supabase-js";

/*
 * Step-up authentication for the doors that move money or identity
 * (Stage 5, 2026-11-11; ASSESSMENT-C §1.4 found step-up ABSENT).
 *
 * A signed-in session can be hours old — cookies refresh silently, and
 * the 30-day inactivity clear is an app-side courtesy, not a proof of
 * presence. Before the Stripe billing portal opens (the surface that
 * can change a traveller's payment method or cancel their plan), the
 * session must prove the person authenticated RECENTLY: the
 * authentication instant must be inside STEP_UP_WINDOW_SECONDS.
 *
 * The authentication instant comes from the access token's `auth_time`
 * claim — the moment the person last proved who they are (a token
 * refresh does NOT move it, which is exactly the property step-up
 * needs). When no session token is available (Bearer-header callers
 * validated by requireUser), the user record's `last_sign_in_at` is
 * the fallback. When NEITHER exists the check fails closed: a door
 * this sensitive never proceeds on an unprovable sign-in time.
 *
 * Error shape follows the house pattern (lib/roamly/auth.ts): a stable
 * machine code plus a human message that says what to do next.
 */

export const STEP_UP_WINDOW_SECONDS = 600;

export const STEP_UP_ERROR_CODE = "STEP_UP_REQUIRED";

export const STEP_UP_REQUIRED_MESSAGE =
  "For your security, please sign in again to open billing management.";

export type StepUpVerdict =
  | { ok: true; authTimeSeconds: number }
  | { ok: false; reason: "stale" | "unknown"; authTimeSeconds: number | null };

function authTimeFromAccessToken(accessToken: string | undefined | null): number | null {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      auth_time?: unknown;
    };
    return typeof payload.auth_time === "number" && Number.isFinite(payload.auth_time)
      ? Math.floor(payload.auth_time)
      : null;
  } catch {
    return null;
  }
}

/** The last proven authentication instant (unix seconds), or null when unprovable. */
export function sessionAuthTimeSeconds(
  session: { access_token?: string | null } | null | undefined,
  user: User
): number | null {
  const fromToken = authTimeFromAccessToken(session?.access_token);
  if (fromToken !== null) return fromToken;
  const lastSignIn = user?.last_sign_in_at ? Date.parse(user.last_sign_in_at) : Number.NaN;
  return Number.isFinite(lastSignIn) ? Math.floor(lastSignIn / 1000) : null;
}

export function evaluateStepUp(params: {
  session: { access_token?: string | null } | null | undefined;
  user: User;
  nowSeconds?: number;
}): StepUpVerdict {
  const authTimeSeconds = sessionAuthTimeSeconds(params.session, params.user);
  if (authTimeSeconds === null) return { ok: false, reason: "unknown", authTimeSeconds: null };
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Fresh means strictly inside the window: an authentication exactly
  // STEP_UP_WINDOW_SECONDS old is already stale.
  if (now - authTimeSeconds >= STEP_UP_WINDOW_SECONDS) {
    return { ok: false, reason: "stale", authTimeSeconds };
  }
  return { ok: true, authTimeSeconds };
}

export async function requireFreshAuthentication(
  supabase: SupabaseClient,
  user: User
): Promise<StepUpVerdict> {
  let session: { access_token?: string | null } | null = null;
  try {
    const result = await supabase.auth.getSession();
    session = result?.data?.session ?? null;
  } catch {
    session = null;
  }
  return evaluateStepUp({ session, user });
}
