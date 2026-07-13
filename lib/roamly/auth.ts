import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { safeAuthNextPath } from "@/lib/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  getCurrentUser as getSupabaseCurrentUser,
  type CurrentUserResult
} from "@/lib/supabase/server";
import { getRoamlyAdminEmails, isRoamlyAdmin } from "@/lib/roamly/access";
import { headers } from "next/headers";
import { getUserFromRoamlySessionToken } from "@/lib/roamly/session-token";
import { getSupabaseAuthCookieDiagnostics, getSupabaseProjectHost, logAuthDiagnostic } from "@/lib/roamly/authDiagnostics";

export const AUTH_REQUIRED_MESSAGE = "Please log in to continue.";

export function authRequiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "AUTH_REQUIRED",
      message: AUTH_REQUIRED_MESSAGE
    },
    { status: 401 }
  );
}

export function getLoginRedirect(path: string) {
  return `/login?next=${encodeURIComponent(safeAuthNextPath(path, "/dashboard"))}`;
}

export { getRoamlyAdminEmails };

export function isAdminEmail(email: string | null | undefined) {
  return isRoamlyAdmin(email);
}

function safeRequestPath(value: string | null, fallback = "/admin") {
  if (!value) return fallback;
  try {
    const url = value.startsWith("http") ? new URL(value) : new URL(value, "https://roamlyhq.com");
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

function shouldLogAdminAuth(path: string) {
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/");
}

function authCookieDiagnosticsFromHeaders(requestHeaders: Headers) {
  return getSupabaseAuthCookieDiagnostics(requestHeaders.get("cookie") || "");
}

export async function getCurrentUser({ allowRoamlySessionToken = true }: { allowRoamlySessionToken?: boolean } = {}): Promise<CurrentUserResult> {
  const supabase = await createSupabaseServerClient();
  const requestHeaders = await headers();
  const requestPath = safeRequestPath(requestHeaders.get("x-roamly-path"), "/");
  const logAuth = shouldLogAdminAuth(requestPath);

  if (supabase) {
    const authorization = requestHeaders.get("authorization");
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;

    if (logAuth) {
      logAuthDiagnostic("get_current_user_start", {
        path: requestPath,
        ...authCookieDiagnosticsFromHeaders(requestHeaders),
        bearerPresent: Boolean(bearerToken),
        supabaseProjectHost: getSupabaseProjectHost()
      });
    }

    if (bearerToken) {
      const { data, error } = await supabase.auth.getUser(bearerToken);

      if (!error && data.user) {
        if (logAuth) {
          logAuthDiagnostic("get_current_user_bearer_ok", {
            path: requestPath,
            authenticatedEmail: data.user.email || null,
            supabaseProjectHost: getSupabaseProjectHost()
          });
        }
        return { configured: true, user: data.user };
      }

      if (logAuth) {
        logAuthDiagnostic("get_current_user_bearer_failed", {
          path: requestPath,
          getUserError: error ? error.name || "auth_error" : "missing_user",
          supabaseProjectHost: getSupabaseProjectHost()
        });
      }
    }
  }

  if (allowRoamlySessionToken) {
    const fallback = await getUserFromRoamlySessionToken(requestHeaders.get("x-roamly-session-token"));
    if (fallback) {
      return { configured: true, user: fallback.user };
    }
  }

  return getSupabaseCurrentUser();
}

type AuthenticatedServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

export async function requireUser(): Promise<
  | { ok: true; user: User; supabase: AuthenticatedServerClient }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const requestHeaders = await headers();

  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "SUPABASE_NOT_CONFIGURED", message: "Supabase is not configured." }, { status: 503 })
    };
  }

  const authorization = requestHeaders.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  if (bearerToken) {
    const { data: bearerData, error: bearerError } = await supabase.auth.getUser(bearerToken);

    if (!bearerError && bearerData.user) {
      return { ok: true, user: bearerData.user, supabase };
    }
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    const fallback = await getUserFromRoamlySessionToken(requestHeaders.get("x-roamly-session-token"));
    if (fallback) {
      return { ok: true, user: fallback.user, supabase: fallback.supabase };
    }

    return { ok: false, response: authRequiredResponse() };
  }

  return { ok: true, user: data.user, supabase };
}

export async function requireAdmin(path = "/admin"): Promise<
  | { ok: true; user: User; admin: SupabaseClient }
  | { ok: false; reason: "setup" | "auth" | "denied"; response: NextResponse; redirectTo?: string }
> {
  const requestHeaders = await headers();
  const requestPath = safeRequestPath(requestHeaders.get("x-roamly-path"), path);
  const current = await getCurrentUser({ allowRoamlySessionToken: false });
  const adminEmails = getRoamlyAdminEmails();
  const authenticatedEmail = current.user?.email || null;
  const adminMatch = isAdminEmail(authenticatedEmail);

  if (shouldLogAdminAuth(requestPath)) {
    logAuthDiagnostic("require_admin_result", {
      path: requestPath,
      ...authCookieDiagnosticsFromHeaders(requestHeaders),
      getUserOk: Boolean(current.user),
      authenticatedEmail,
      adminMatch,
      supportAllowlisted: adminEmails.includes("support@roamlyhq.com"),
      adminEmailCount: adminEmails.length,
      supabaseProjectHost: getSupabaseProjectHost()
    });
  }

  if (!current.configured) {
    return {
      ok: false,
      reason: "setup",
      response: NextResponse.json({ ok: false, error: "SUPABASE_NOT_CONFIGURED", message: "Supabase is not configured." }, { status: 503 })
    };
  }

  if (!current.user) {
    logAuthDiagnostic("admin_api_auth_required", {
      path: requestPath,
      ...authCookieDiagnosticsFromHeaders(requestHeaders),
      getUserOk: false,
      supabaseProjectHost: getSupabaseProjectHost()
    });

    return {
      ok: false,
      reason: "auth",
      redirectTo: getLoginRedirect(path),
      response: authRequiredResponse()
    };
  }

  if (!isAdminEmail(current.user.email)) {
    return {
      ok: false,
      reason: "denied",
      response: NextResponse.json({ ok: false, error: "ADMIN_ACCESS_DENIED", message: "Admin access denied." }, { status: 403 })
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      reason: "setup",
      response: NextResponse.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_MISSING", message: "Supabase service role is not configured." },
        { status: 503 }
      )
    };
  }

  return { ok: true, user: current.user, admin };
}
