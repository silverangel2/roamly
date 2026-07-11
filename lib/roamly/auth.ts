import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  getCurrentUser as getSupabaseCurrentUser,
  type CurrentUserResult
} from "@/lib/supabase/server";
import { getRoamlyAdminEmails, isRoamlyAdmin } from "@/lib/roamly/access";

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
  return `/login?next=${encodeURIComponent(safeNextPath(path, "/dashboard"))}`;
}

export { getRoamlyAdminEmails };

export function isAdminEmail(email: string | null | undefined) {
  return isRoamlyAdmin(email);
}

export async function getCurrentUser(): Promise<CurrentUserResult> {
  return getSupabaseCurrentUser();
}

type AuthenticatedServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

export async function requireUser(): Promise<
  | { ok: true; user: User; supabase: AuthenticatedServerClient }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "SUPABASE_NOT_CONFIGURED", message: "Supabase is not configured." }, { status: 503 })
    };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { ok: false, response: authRequiredResponse() };
  }

  return { ok: true, user: data.user, supabase };
}

export async function requireAdmin(path = "/admin"): Promise<
  | { ok: true; user: User; admin: SupabaseClient }
  | { ok: false; reason: "setup" | "auth" | "denied"; response: NextResponse; redirectTo?: string }
> {
  const current = await getSupabaseCurrentUser();

  if (!current.configured) {
    return {
      ok: false,
      reason: "setup",
      response: NextResponse.json({ ok: false, error: "SUPABASE_NOT_CONFIGURED", message: "Supabase is not configured." }, { status: 503 })
    };
  }

  if (!current.user) {
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
