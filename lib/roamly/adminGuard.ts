import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getRoamlyAdminEmails,
  requireAdmin
} from "@/lib/roamly/auth";
import {
  ROAMLY_ADMIN_COOKIE,
  verifyRoamlyAdminSessionValue
} from "@/lib/roamly/adminAccess";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";

async function resolveDedicatedRoamlyAdmin() {
  const cookieStore = await cookies();

  const sessionValid = await verifyRoamlyAdminSessionValue(
    cookieStore.get(ROAMLY_ADMIN_COOKIE)?.value
  );

  const admin = createSupabaseAdminClient();
  const adminEmails = getRoamlyAdminEmails();

  if (!sessionValid) {
    return {
      ok: false as const,
      reason: "ADMIN_SESSION_REQUIRED",
      admin,
      adminEmails,
      user: null
    };
  }

  if (!admin) {
    return {
      ok: false as const,
      reason: "SUPABASE_ADMIN_NOT_CONFIGURED",
      admin,
      adminEmails,
      user: null
    };
  }

  if (!adminEmails.length) {
    return {
      ok: false as const,
      reason: "ADMIN_EMAIL_NOT_CONFIGURED",
      admin,
      adminEmails,
      user: null
    };
  }

  /*
   * The admin UI is passcode-only, but existing Roamly admin operations
   * legitimately require a real auth.users UUID for ownership, audit,
   * Companion Demo data, system diagnostics, etc.
   *
   * Resolve the existing configured Roamly admin account internally.
   * The traveler session is NOT used as authorization.
   */
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });

  if (error) {
    console.error("[Roamly admin] Could not resolve configured admin user", {
      error: error.message
    });

    return {
      ok: false as const,
      reason: "ADMIN_USER_LOOKUP_FAILED",
      admin,
      adminEmails,
      user: null
    };
  }

  const normalizedAdminEmails = new Set(
    adminEmails.map((email) => email.trim().toLowerCase())
  );

  const user =
    data.users.find((candidate) =>
      normalizedAdminEmails.has(
        String(candidate.email || "").trim().toLowerCase()
      )
    ) || null;

  if (!user) {
    return {
      ok: false as const,
      reason: "ADMIN_USER_NOT_FOUND",
      admin,
      adminEmails,
      user: null
    };
  }

  return {
    ok: true as const,
    admin,
    adminEmails,
    user
  };
}

async function resolveRoamlyAdmin() {
  // Preserve the original, known-working Roamly Admin path as primary.
  const existing = await requireAdmin("/admin");

  if (existing.ok && existing.user && existing.admin) {
    return {
      ok: true as const,
      admin: existing.admin,
      adminEmails: getRoamlyAdminEmails(),
      user: existing.user
    };
  }

  // Dedicated passcode Admin Access is the compatibility fallback.
  // It must not interfere with an already-authenticated desktop Admin.
  return resolveDedicatedRoamlyAdmin();
}

export async function requireRoamlyAdmin() {
  const resolved = await resolveRoamlyAdmin();

  if (!resolved.ok || !resolved.user || !resolved.admin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "reason" in resolved ? resolved.reason : "ADMIN_AUTH_REQUIRED"
        },
        { status: 401 }
      )
    };
  }

  return {
    ok: true as const,
    user: resolved.user,
    admin: resolved.admin
  };
}

export async function getRoamlyAdminPageState() {
  const resolved = await resolveRoamlyAdmin();

  const user = resolved.user;
  const admin = resolved.admin;

  return {
    configured: Boolean(admin),
    user,
    isAdmin: Boolean(resolved.ok && user),
    access: getRoamlyAccessForUser(user?.email),
    admin,
    missingAdminEmail: !resolved.adminEmails.length
  };
}
