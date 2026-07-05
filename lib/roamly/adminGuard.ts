import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/server";

export function getRoamlyAdminEmails() {
  return (process.env.ROAMLY_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireRoamlyAdmin() {
  const current = await getCurrentUser();
  const adminEmails = getRoamlyAdminEmails();
  const email = (current.user?.email || "").toLowerCase();

  if (!current.configured) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 })
    };
  }

  if (!current.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Admin login required." }, { status: 401 })
    };
  }

  if (!adminEmails.includes(email)) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Admin access denied." }, { status: 403 })
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 })
    };
  }

  return { ok: true as const, user: current.user, admin };
}

export async function getRoamlyAdminPageState() {
  const current = await getCurrentUser();
  const adminEmails = getRoamlyAdminEmails();
  const email = (current.user?.email || "").toLowerCase();
  const admin = createSupabaseAdminClient();

  return {
    configured: current.configured,
    user: current.user,
    isAdmin: Boolean(current.user && adminEmails.includes(email)),
    admin,
    missingAdminEmail: !adminEmails.length
  };
}
